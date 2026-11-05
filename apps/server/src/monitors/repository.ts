import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  MONITOR_STATUS_VALUES,
  SECRET_KEEP,
  monitorConfigSchema,
  type HttpMonitorConfig,
  type MetricValue,
  type MonitorConfig,
  type MonitorDto,
  type MonitorInput,
  type MonitorRunDto,
  type MonitorStatus,
  type MonitorType,
  type RuleDto,
  type RuleInput,
  type RunTrigger,
} from '@subwatch/shared';
import type { CoreContext } from '../context.js';
import { hashToken, randomToken } from '../lib/crypto.js';
import { all, fromBool, nowIso, one, parseJson, run, toBool, toJson, withTransaction, type SqlValue } from '../db/helpers.js';

// ---------------------------------------------------------------------------
// Row shapes (mirrors db/migrations.ts)
// ---------------------------------------------------------------------------

export interface MonitorRow {
  id: string;
  name: string;
  description: string;
  type: string;
  config: string;
  interval_seconds: number;
  failure_threshold: number;
  stale_after_seconds: number;
  channel_ids: string;
  tags: string;
  enabled: number;
  last_status: string;
  last_metrics: string;
  last_checked_at: string | null;
  last_error: string | null;
  last_notified_at: string | null;
  consecutive_failures: number;
  next_run_at: string | null;
  push_token_hash: string | null;
  push_token_prefix: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuleRow {
  id: string;
  monitor_id: string;
  metric_key: string;
  label: string;
  unit: string;
  operator: string;
  warning_value: number | null;
  critical_value: number | null;
  duration_checks: number;
  cooldown_seconds: number;
  repeat_interval_seconds: number;
  recovery_operator: string | null;
  recovery_value: number | null;
  recovery_checks: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface MonitorRunRow {
  id: string;
  monitor_id: string;
  started_at: string;
  finished_at: string;
  ok: number;
  status: string;
  http_status: number | null;
  duration_ms: number;
  metrics: string;
  error: string | null;
  trigger_kind: string;
}

export interface AlertStateRow {
  id: string;
  monitor_id: string;
  rule_id: string;
  kind: string;
  state: string;
  severity: string | null;
  value: number | null;
  breach_count: number;
  since: string;
  last_notified_at: string | null;
  updated_at: string;
}

/** Row written by the rules engine for a single alert state. */
export interface AlertStateWrite {
  ruleId: string;
  kind: 'metric' | 'availability';
  state: 'ok' | 'warning' | 'critical';
  severity: 'warning' | 'critical' | 'down' | null;
  value: number | null;
  breachCount: number;
  since: string;
  lastNotifiedAt: string | null;
}

export interface MonitorCursor {
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseChannelIds(row: MonitorRow): string[] {
  return parseJson<string[]>(row.channel_ids, []).filter((id) => typeof id === 'string');
}

export function parseTags(row: MonitorRow): string[] {
  return parseJson<string[]>(row.tags, []).filter((tag) => typeof tag === 'string');
}

export function parseLastMetrics(row: MonitorRow): Record<string, MetricValue> {
  return parseJson<Record<string, MetricValue>>(row.last_metrics, {});
}

export function rowToRuleDto(row: RuleRow): RuleDto {
  return {
    id: row.id,
    metricKey: row.metric_key,
    label: row.label,
    unit: row.unit,
    operator: row.operator as RuleDto['operator'],
    warningValue: row.warning_value,
    criticalValue: row.critical_value,
    durationChecks: Number(row.duration_checks),
    cooldownSeconds: Number(row.cooldown_seconds),
    repeatIntervalSeconds: Number(row.repeat_interval_seconds),
    recoveryOperator: (row.recovery_operator as RuleDto['operator'] | null) ?? null,
    recoveryValue: row.recovery_value,
    recoveryChecks: Number(row.recovery_checks),
    enabled: fromBool(row.enabled),
  };
}

function normalizeStatus(raw: string): MonitorStatus {
  return (MONITOR_STATUS_VALUES as readonly string[]).includes(raw) ? (raw as MonitorStatus) : 'unknown';
}

export function rowToRunDto(row: MonitorRunRow): MonitorRunDto {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    ok: fromBool(row.ok),
    status: normalizeStatus(row.status),
    httpStatus: row.http_status,
    durationMs: Number(row.duration_ms),
    metrics: parseJson<Record<string, MetricValue>>(row.metrics, {}),
    error: row.error,
    trigger: row.trigger_kind as RunTrigger,
  };
}

/** Decrypt the stored monitor config. Throws when the envelope is unreadable. */
export function loadMonitorConfig(ctx: CoreContext, row: MonitorRow): MonitorConfig {
  const decrypted = ctx.secretBox.decryptJson<unknown>(row.config);
  const parsed = monitorConfigSchema.safeParse(decrypted);
  if (!parsed.success) {
    throw new Error(`Stored monitor config for ${row.id} is invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  return parsed.data;
}

function maskAuth(auth: HttpMonitorConfig['request']['auth']): HttpMonitorConfig['request']['auth'] {
  switch (auth.type) {
    case 'basic':
      return { ...auth, password: auth.password === '' ? '' : SECRET_KEEP };
    case 'bearer':
      return { ...auth, token: auth.token === '' ? '' : SECRET_KEEP };
    default:
      return auth;
  }
}

/**
 * Return a copy of the config safe to hand to the browser: secret header values
 * and auth credentials are replaced by the SECRET_KEEP sentinel.
 */
export function maskMonitorConfig(config: MonitorConfig): MonitorConfig {
  if (config.type === 'push') return config;
  const headers = config.request.headers.map((header) =>
    header.secret && header.value !== '' ? { ...header, value: SECRET_KEEP } : { ...header },
  );
  return {
    ...config,
    request: { ...config.request, headers, auth: maskAuth(config.request.auth) },
  };
}

/**
 * Apply SECRET_KEEP sentinels from an update payload by copying the previous
 * values from the stored config (headers match by key, auth by type).
 */
export function restoreConfigSecrets(incoming: MonitorConfig, existing: MonitorConfig | null): MonitorConfig {
  if (incoming.type !== 'http') return incoming;
  const previous = existing && existing.type === 'http' ? existing.request : null;
  const headers = incoming.request.headers.map((header, index) => {
    if (header.value !== SECRET_KEEP) return header;
    const match = previous?.headers.find((candidate) => candidate.key === header.key) ?? previous?.headers[index];
    return { ...header, value: match?.value ?? '' };
  });
  let auth = incoming.request.auth;
  const previousAuth = previous?.auth;
  if (auth.type === 'basic' && auth.password === SECRET_KEEP) {
    auth = { type: 'basic', username: auth.username, password: previousAuth?.type === 'basic' ? previousAuth.password : '' };
  } else if (auth.type === 'bearer' && auth.token === SECRET_KEEP) {
    auth = { type: 'bearer', token: previousAuth?.type === 'bearer' ? previousAuth.token : '' };
  }
  return { ...incoming, request: { ...incoming.request, headers, auth } };
}

/** Random push token; only the SHA-256 hash is persisted. */
export function generatePushToken(): { token: string; hash: string; prefix: string } {
  const token = randomToken(32);
  return { token, hash: hashToken(token), prefix: token.slice(0, 12) };
}

/** Compute the next run timestamp with 0.9–1.1 jitter around the interval. */
export function computeNextRunAt(intervalSeconds: number, fromMs = Date.now()): string {
  const jitter = 0.9 + Math.random() * 0.2;
  const seconds = Math.max(5, intervalSeconds * jitter);
  return new Date(fromMs + seconds * 1000).toISOString();
}

function ruleParams(monitorId: string, rule: RuleInput, timestamp: string): SqlValue[] {
  return [
    monitorId,
    rule.metricKey,
    rule.label ?? '',
    rule.unit ?? '',
    rule.operator,
    rule.warningValue ?? null,
    rule.criticalValue ?? null,
    rule.durationChecks,
    rule.cooldownSeconds,
    rule.repeatIntervalSeconds,
    rule.recoveryOperator ?? null,
    rule.recoveryValue ?? null,
    rule.recoveryChecks,
    toBool(rule.enabled),
    timestamp,
    timestamp,
  ];
}

function insertRuleRow(db: DatabaseSync, monitorId: string, rule: RuleInput): string {
  const id = randomUUID();
  const timestamp = nowIso();
  run(
    db,
    `INSERT INTO monitor_rules (
       id, monitor_id, metric_key, label, unit, operator, warning_value, critical_value,
       duration_checks, cooldown_seconds, repeat_interval_seconds, recovery_operator,
       recovery_value, recovery_checks, enabled, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ...ruleParams(monitorId, rule, timestamp)],
  );
  return id;
}

function updateRuleRow(db: DatabaseSync, ruleId: string, monitorId: string, rule: RuleInput): void {
  run(
    db,
    `UPDATE monitor_rules SET
       metric_key = ?, label = ?, unit = ?, operator = ?, warning_value = ?, critical_value = ?,
       duration_checks = ?, cooldown_seconds = ?, repeat_interval_seconds = ?, recovery_operator = ?,
       recovery_value = ?, recovery_checks = ?, enabled = ?, updated_at = ?
     WHERE id = ? AND monitor_id = ?`,
    [
      rule.metricKey,
      rule.label ?? '',
      rule.unit ?? '',
      rule.operator,
      rule.warningValue ?? null,
      rule.criticalValue ?? null,
      rule.durationChecks,
      rule.cooldownSeconds,
      rule.repeatIntervalSeconds,
      rule.recoveryOperator ?? null,
      rule.recoveryValue ?? null,
      rule.recoveryChecks,
      toBool(rule.enabled),
      nowIso(),
      ruleId,
      monitorId,
    ],
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function listRuleRows(db: DatabaseSync, monitorId: string): RuleRow[] {
  return all<RuleRow>(db, 'SELECT * FROM monitor_rules WHERE monitor_id = ? ORDER BY created_at ASC, rowid ASC', [
    monitorId,
  ]);
}

export function listRuleDtos(db: DatabaseSync, monitorId: string): RuleDto[] {
  return listRuleRows(db, monitorId).map(rowToRuleDto);
}

export function getMonitorRow(db: DatabaseSync, id: string): MonitorRow | undefined {
  return one<MonitorRow>(db, 'SELECT * FROM monitors WHERE id = ?', [id]);
}

export function findMonitorByPushToken(ctx: CoreContext, token: string): MonitorRow | undefined {
  if (!token) return undefined;
  return one<MonitorRow>(ctx.db, 'SELECT * FROM monitors WHERE push_token_hash = ? AND type = ?', [
    hashToken(token),
    'push',
  ]);
}

function toMonitorDto(ctx: CoreContext, row: MonitorRow, rules: RuleDto[]): MonitorDto {
  const enabled = fromBool(row.enabled);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as MonitorType,
    config: maskMonitorConfig(loadMonitorConfig(ctx, row)),
    intervalSeconds: Number(row.interval_seconds),
    failureThreshold: Number(row.failure_threshold),
    staleAfterSeconds: Number(row.stale_after_seconds),
    channelIds: parseChannelIds(row),
    tags: parseTags(row),
    enabled,
    lastStatus: enabled ? normalizeStatus(row.last_status) : 'paused',
    lastMetrics: parseLastMetrics(row),
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    nextRunAt: row.next_run_at,
    consecutiveFailures: Number(row.consecutive_failures),
    pushTokenPrefix: row.push_token_prefix,
    rules,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getMonitorDto(ctx: CoreContext, row: MonitorRow): MonitorDto {
  return toMonitorDto(ctx, row, listRuleDtos(ctx.db, row.id));
}

export function listMonitors(ctx: CoreContext): MonitorDto[] {
  const rows = all<MonitorRow>(ctx.db, 'SELECT * FROM monitors ORDER BY created_at ASC, rowid ASC');
  if (rows.length === 0) return [];
  const ruleRows = all<RuleRow>(ctx.db, 'SELECT * FROM monitor_rules ORDER BY created_at ASC, rowid ASC');
  const rulesByMonitor = new Map<string, RuleDto[]>();
  for (const ruleRow of ruleRows) {
    const bucket = rulesByMonitor.get(ruleRow.monitor_id);
    if (bucket) bucket.push(rowToRuleDto(ruleRow));
    else rulesByMonitor.set(ruleRow.monitor_id, [rowToRuleDto(ruleRow)]);
  }
  return rows.map((row) => toMonitorDto(ctx, row, rulesByMonitor.get(row.id) ?? []));
}

export function getMonitorWithDto(ctx: CoreContext, id: string): { row: MonitorRow; dto: MonitorDto } | undefined {
  const row = getMonitorRow(ctx.db, id);
  if (!row) return undefined;
  return { row, dto: getMonitorDto(ctx, row) };
}

export function listDueHttpMonitors(ctx: CoreContext, nowIsoValue: string, limit: number): MonitorRow[] {
  return all<MonitorRow>(
    ctx.db,
    `SELECT * FROM monitors
      WHERE enabled = 1 AND type = 'http'
        AND (next_run_at IS NULL OR next_run_at <= ?)
      ORDER BY next_run_at ASC
      LIMIT ?`,
    [nowIsoValue, limit],
  );
}

export function listEnabledPushMonitors(ctx: CoreContext): MonitorRow[] {
  return all<MonitorRow>(ctx.db, "SELECT * FROM monitors WHERE enabled = 1 AND type = 'push'");
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface CreatedMonitor {
  row: MonitorRow;
  dto: MonitorDto;
  pushToken?: string;
}

export function createMonitor(ctx: CoreContext, input: MonitorInput): CreatedMonitor {
  const id = randomUUID();
  const timestamp = nowIso();
  const type: MonitorType = input.config.type;
  const encryptedConfig = ctx.secretBox.encryptJson(input.config);
  const push = type === 'push' ? generatePushToken() : null;
  const nextRunAt = input.enabled && type === 'http' ? timestamp : null;

  withTransaction(ctx.db, () => {
    run(
      ctx.db,
      `INSERT INTO monitors (
         id, name, description, type, config, interval_seconds, failure_threshold, stale_after_seconds,
         channel_ids, tags, enabled, last_status, last_metrics, last_checked_at, last_error,
         last_notified_at, consecutive_failures, next_run_at, push_token_hash, push_token_prefix,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', '{}', NULL, NULL, NULL, 0, ?, ?, ?, ?, ?)`,
      [
        id,
        input.name,
        input.description,
        type,
        encryptedConfig,
        input.intervalSeconds,
        input.failureThreshold,
        input.staleAfterSeconds,
        toJson(input.channelIds),
        toJson(input.tags),
        toBool(input.enabled),
        nextRunAt,
        push?.hash ?? null,
        push?.prefix ?? null,
        timestamp,
        timestamp,
      ],
    );
    for (const rule of input.rules) insertRuleRow(ctx.db, id, rule);
  });

  const row = getMonitorRow(ctx.db, id);
  if (!row) throw new Error('Failed to read back the created monitor');
  return { row, dto: getMonitorDto(ctx, row), ...(push ? { pushToken: push.token } : {}) };
}

export interface UpdatedMonitor {
  row: MonitorRow;
  dto: MonitorDto;
  pushToken?: string;
  rescheduled: boolean;
}

export function updateMonitor(ctx: CoreContext, existing: MonitorRow, input: MonitorInput): UpdatedMonitor {
  const previousConfig = (() => {
    try {
      return loadMonitorConfig(ctx, existing);
    } catch {
      return null;
    }
  })();
  const config = restoreConfigSecrets(input.config, previousConfig);
  const type: MonitorType = config.type;
  const typeChanged = type !== existing.type;
  const configChanged = typeChanged || JSON.stringify(config) !== JSON.stringify(previousConfig);
  const intervalChanged = Number(existing.interval_seconds) !== input.intervalSeconds;
  const wasEnabled = fromBool(existing.enabled);
  const rescheduled = (configChanged || intervalChanged || (!wasEnabled && input.enabled)) && input.enabled;

  let pushToken: string | undefined;
  let pushHash: string | null = existing.push_token_hash;
  let pushPrefix: string | null = existing.push_token_prefix;
  if (type === 'push') {
    if (typeChanged || !pushHash) {
      const generated = generatePushToken();
      pushToken = generated.token;
      pushHash = generated.hash;
      pushPrefix = generated.prefix;
    }
  } else {
    pushHash = null;
    pushPrefix = null;
  }

  const timestamp = nowIso();
  const nextRunAt = !input.enabled ? null : rescheduled ? timestamp : existing.next_run_at;

  withTransaction(ctx.db, () => {
    run(
      ctx.db,
      `UPDATE monitors SET
         name = ?, description = ?, type = ?, config = ?, interval_seconds = ?, failure_threshold = ?,
         stale_after_seconds = ?, channel_ids = ?, tags = ?, enabled = ?, next_run_at = ?,
         push_token_hash = ?, push_token_prefix = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.name,
        input.description,
        type,
        ctx.secretBox.encryptJson(config),
        input.intervalSeconds,
        input.failureThreshold,
        input.staleAfterSeconds,
        toJson(input.channelIds),
        toJson(input.tags),
        toBool(input.enabled),
        nextRunAt,
        pushHash,
        pushPrefix,
        timestamp,
        existing.id,
      ],
    );

    // Diff rules: keep ids that still exist, update them, insert new ones and
    // drop the ones the client no longer sends.
    const existingRules = listRuleRows(ctx.db, existing.id);
    const byId = new Map(existingRules.map((rule) => [rule.id, rule]));
    const kept = new Set<string>();
    for (const rule of input.rules) {
      const reusableId = rule.id && byId.has(rule.id) ? rule.id : undefined;
      if (reusableId) {
        updateRuleRow(ctx.db, reusableId, existing.id, rule);
        kept.add(reusableId);
      } else {
        insertRuleRow(ctx.db, existing.id, rule);
      }
    }
    for (const removed of existingRules) {
      if (kept.has(removed.id)) continue;
      run(ctx.db, 'DELETE FROM monitor_rules WHERE id = ? AND monitor_id = ?', [removed.id, existing.id]);
      run(ctx.db, "DELETE FROM alert_states WHERE monitor_id = ? AND kind = 'metric' AND rule_id = ?", [
        existing.id,
        removed.id,
      ]);
    }
  });

  const row = getMonitorRow(ctx.db, existing.id);
  if (!row) throw new Error('Monitor disappeared during update');
  return {
    row,
    dto: getMonitorDto(ctx, row),
    rescheduled,
    ...(pushToken ? { pushToken } : {}),
  };
}

export function deleteMonitor(ctx: CoreContext, id: string): boolean {
  const result = run(ctx.db, 'DELETE FROM monitors WHERE id = ?', [id]);
  return Number(result.changes) > 0;
}

export function rotatePushToken(ctx: CoreContext, id: string): { pushToken: string; pushTokenPrefix: string } | undefined {
  const row = getMonitorRow(ctx.db, id);
  if (!row) return undefined;
  if (row.type !== 'push') return undefined;
  const generated = generatePushToken();
  run(
    ctx.db,
    'UPDATE monitors SET push_token_hash = ?, push_token_prefix = ?, updated_at = ?, next_run_at = NULL WHERE id = ?',
    [generated.hash, generated.prefix, nowIso(), id],
  );
  return { pushToken: generated.token, pushTokenPrefix: generated.prefix };
}

export interface MonitorRunWrite {
  monitorId: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  status: MonitorStatus;
  httpStatus: number | null;
  durationMs: number;
  metrics: Record<string, MetricValue>;
  error: string | null;
  trigger: RunTrigger;
}

export function insertMonitorRun(ctx: CoreContext, input: MonitorRunWrite): MonitorRunDto {
  const id = randomUUID();
  run(
    ctx.db,
    `INSERT INTO monitor_runs (
       id, monitor_id, started_at, finished_at, ok, status, http_status, duration_ms, metrics, error, trigger_kind
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.monitorId,
      input.startedAt,
      input.finishedAt,
      toBool(input.ok),
      input.status,
      input.httpStatus,
      Math.max(0, Math.round(input.durationMs)),
      toJson(input.metrics),
      input.error,
      input.trigger,
    ],
  );
  return {
    id,
    monitorId: input.monitorId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    ok: input.ok,
    status: input.status,
    httpStatus: input.httpStatus,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    metrics: input.metrics,
    error: input.error,
    trigger: input.trigger,
  };
}

export interface MonitorRunUpdate {
  lastStatus?: MonitorStatus;
  lastMetrics?: Record<string, MetricValue>;
  lastCheckedAt?: string | null;
  lastError?: string | null;
  consecutiveFailures?: number;
  nextRunAt?: string | null;
  lastNotifiedAt?: string | null;
}

export function applyMonitorRunUpdate(ctx: CoreContext, monitorId: string, update: MonitorRunUpdate): void {
  const sets: string[] = [];
  const params: SqlValue[] = [];
  if (update.lastStatus !== undefined) {
    sets.push('last_status = ?');
    params.push(update.lastStatus);
  }
  if (update.lastMetrics !== undefined) {
    sets.push('last_metrics = ?');
    params.push(toJson(update.lastMetrics));
  }
  if (update.lastCheckedAt !== undefined) {
    sets.push('last_checked_at = ?');
    params.push(update.lastCheckedAt);
  }
  if (update.lastError !== undefined) {
    sets.push('last_error = ?');
    params.push(update.lastError);
  }
  if (update.consecutiveFailures !== undefined) {
    sets.push('consecutive_failures = ?');
    params.push(update.consecutiveFailures);
  }
  if (update.nextRunAt !== undefined) {
    sets.push('next_run_at = ?');
    params.push(update.nextRunAt);
  }
  if (update.lastNotifiedAt !== undefined) {
    sets.push('last_notified_at = ?');
    params.push(update.lastNotifiedAt);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  params.push(nowIso());
  params.push(monitorId);
  run(ctx.db, `UPDATE monitors SET ${sets.join(', ')} WHERE id = ?`, params);
}

export function listAlertStateRows(ctx: CoreContext, monitorId: string): AlertStateRow[] {
  return all<AlertStateRow>(ctx.db, 'SELECT * FROM alert_states WHERE monitor_id = ?', [monitorId]);
}

export function saveAlertStates(ctx: CoreContext, monitorId: string, states: AlertStateWrite[]): void {
  for (const state of states) {
    run(
      ctx.db,
      `INSERT INTO alert_states (
         id, monitor_id, rule_id, kind, state, severity, value, breach_count, since, last_notified_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(monitor_id, kind, rule_id) DO UPDATE SET
         state = excluded.state,
         severity = excluded.severity,
         value = excluded.value,
         breach_count = excluded.breach_count,
         since = excluded.since,
         last_notified_at = excluded.last_notified_at,
         updated_at = excluded.updated_at`,
      [
        randomUUID(),
        monitorId,
        state.ruleId,
        state.kind,
        state.state,
        state.severity,
        state.value,
        state.breachCount,
        state.since,
        state.lastNotifiedAt,
        nowIso(),
      ],
    );
  }
}

export function deleteMetricAlertStates(ctx: CoreContext, monitorId: string, ruleIds: string[]): void {
  for (const ruleId of ruleIds) {
    run(ctx.db, "DELETE FROM alert_states WHERE monitor_id = ? AND kind = 'metric' AND rule_id = ?", [
      monitorId,
      ruleId,
    ]);
  }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export function listRuns(
  ctx: CoreContext,
  monitorId: string,
  cursor: MonitorCursor,
): { items: MonitorRunDto[]; total: number; limit: number; offset: number } {
  const countRow = one<{ total: number }>(ctx.db, 'SELECT COUNT(*) AS total FROM monitor_runs WHERE monitor_id = ?', [
    monitorId,
  ]);
  const rows = all<MonitorRunRow>(
    ctx.db,
    'SELECT * FROM monitor_runs WHERE monitor_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ? OFFSET ?',
    [monitorId, cursor.limit, cursor.offset],
  );
  return {
    items: rows.map(rowToRunDto),
    total: Number(countRow?.total ?? 0),
    limit: cursor.limit,
    offset: cursor.offset,
  };
}

export function listRunPoints(
  ctx: CoreContext,
  monitorId: string,
  sinceIso: string,
  maxPoints: number,
): Array<{ at: string; metrics: Record<string, MetricValue> }> {
  // Bound the scan first (newest first) so a very chatty monitor cannot blow up
  // memory on a 30 day range, then restore chronological order for the chart.
  const rows = all<Pick<MonitorRunRow, 'finished_at' | 'metrics'>>(
    ctx.db,
    `SELECT finished_at, metrics FROM (
       SELECT finished_at, metrics, rowid FROM monitor_runs
        WHERE monitor_id = ? AND finished_at >= ?
        ORDER BY finished_at DESC, rowid DESC
        LIMIT 20000
     ) ORDER BY finished_at ASC, rowid ASC`,
    [monitorId, sinceIso],
  );
  const points = rows.map((row) => ({
    at: row.finished_at,
    metrics: parseJson<Record<string, MetricValue>>(row.metrics, {}),
  }));
  if (points.length <= maxPoints || maxPoints <= 0) return points;
  const step = Math.ceil(points.length / maxPoints);
  const sampled: typeof points = [];
  for (let index = 0; index < points.length; index += step) {
    const point = points[index];
    if (point) sampled.push(point);
  }
  const last = points[points.length - 1];
  if (last && sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

export function pruneRuns(ctx: CoreContext, retentionDays: number): number {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000).toISOString();
  const result = run(ctx.db, 'DELETE FROM monitor_runs WHERE started_at < ?', [cutoff]);
  return Number(result.changes);
}
