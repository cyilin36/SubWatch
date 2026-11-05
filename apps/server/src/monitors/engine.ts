import type {
  MetricValue,
  MonitorConfig,
  MonitorDto,
  MonitorRunDto,
  MonitorStatus,
  MonitorTestResult,
  RuleDto,
  RuleEvaluationDto,
  RuleInput,
  RunTrigger,
} from '@subwatch/shared';
import type { ModuleContext } from '../context.js';
import { withTransaction } from '../db/helpers.js';
import { BadRequestError } from '../lib/errors.js';
import * as repo from './repository.js';
import { runHttpRequest, validateRequestConfig } from './http-runner.js';
import { extractMetrics } from './sandbox.js';
import {
  AVAILABILITY_RULE_ID,
  collectMetricErrors,
  evaluateAvailability,
  evaluateInstant,
  evaluateMetricRules,
  worstStatus,
  type AlertLevel,
  type AlertStateSnapshot,
  type PendingNotification,
} from './rules.js';

export interface RunOptions {
  trigger: RunTrigger;
  /** Write monitor_runs / monitor / alert_states rows. */
  persist: boolean;
  /** Compute and store the next scheduled run (scheduler only). */
  scheduleNext: boolean;
}

export interface MonitorRunResult {
  ok: boolean;
  status: MonitorStatus;
  httpStatus: number | null;
  durationMs: number;
  metrics: Record<string, MetricValue>;
  rawBody: unknown;
  rawText: string;
  error: string | null;
  evaluations: RuleEvaluationDto[];
  logs: string[];
  run: MonitorRunDto | null;
  monitor: MonitorDto | null;
}

export interface PushReport {
  status?: 'up' | 'down';
  metrics?: Record<string, MetricValue>;
  message?: string;
  timestamp?: string;
}

interface RunSamples {
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  httpStatus: number | null;
  metrics: Record<string, MetricValue>;
  rawBody: unknown;
  rawText: string;
  logs: string[];
  ok: boolean;
  explicitDown: boolean;
  error: string | null;
}

function rowToSnapshot(row: repo.AlertStateRow): AlertStateSnapshot {
  const state = row.state === 'critical' ? 'critical' : row.state === 'warning' ? 'warning' : 'ok';
  return {
    ruleId: row.rule_id,
    kind: row.kind === 'availability' ? 'availability' : 'metric',
    state,
    severity: row.severity as AlertStateSnapshot['severity'],
    value: row.value,
    breachCount: Number(row.breach_count),
    since: row.since,
    lastNotifiedAt: row.last_notified_at,
  };
}

interface LoadedAlertStates {
  metric: Map<string, AlertStateSnapshot>;
  availability: AlertStateSnapshot | null;
}

function loadAlertStates(ctx: ModuleContext, monitorId: string): LoadedAlertStates {
  const rows = repo.listAlertStateRows(ctx, monitorId);
  const metric = new Map<string, AlertStateSnapshot>();
  let availability: AlertStateSnapshot | null = null;
  for (const row of rows) {
    if (row.kind === 'availability') availability = rowToSnapshot(row);
    else metric.set(row.rule_id, rowToSnapshot(row));
  }
  return { metric, availability };
}

function worstOfSnapshots(states: Iterable<AlertStateSnapshot>): AlertLevel {
  let worst: AlertLevel = 'ok';
  for (const state of states) {
    if (state.state === 'critical') return 'critical';
    if (state.state === 'warning') worst = 'warning';
  }
  return worst;
}

function enqueueNotifications(ctx: ModuleContext, row: repo.MonitorRow, notifications: PendingNotification[]): void {
  if (notifications.length === 0) return;
  const channelIds = repo.parseChannelIds(row);
  for (const notification of notifications) {
    try {
      ctx.notifications.enqueue({
        eventType: notification.eventType,
        eventKey: notification.eventKey,
        channelIds,
        payload: notification.payload,
        monitorId: row.id,
      });
    } catch (error) {
      ctx.logger.error({ err: error, eventKey: notification.eventKey }, 'failed to enqueue monitor notification');
    }
  }
}

function draftRules(rules: RuleInput[]): RuleDto[] {
  return rules.map((rule, index) => ({
    id: rule.id ?? `draft-${index + 1}`,
    metricKey: rule.metricKey,
    label: rule.label,
    unit: rule.unit,
    operator: rule.operator,
    warningValue: rule.warningValue,
    criticalValue: rule.criticalValue,
    durationChecks: rule.durationChecks,
    cooldownSeconds: rule.cooldownSeconds,
    repeatIntervalSeconds: rule.repeatIntervalSeconds,
    recoveryOperator: rule.recoveryOperator,
    recoveryValue: rule.recoveryValue,
    recoveryChecks: rule.recoveryChecks,
    enabled: rule.enabled,
  }));
}

/**
 * Apply the rule state machines to one finished run, persist the outcome and
 * enqueue notifications. Shared by HTTP runs, push reports and manual runs.
 */
function finishRun(
  ctx: ModuleContext,
  row: repo.MonitorRow,
  rules: RuleDto[],
  options: RunOptions,
  samples: RunSamples,
): MonitorRunResult {
  const general = ctx.settings.getGeneral();
  const locale = general.locale;
  const baseUrl = ctx.settings.getBaseUrl();
  const now = samples.finishedAt;
  const finishedAtIso = now.toISOString();
  const previousStates = options.persist
    ? loadAlertStates(ctx, row.id)
    : { metric: new Map<string, AlertStateSnapshot>(), availability: null };

  let ok = samples.ok;
  let error = samples.error;
  if (ok) {
    const metricErrors = collectMetricErrors(rules, samples.metrics);
    if (metricErrors.length > 0) {
      ok = false;
      error = metricErrors.join('; ');
    }
  }

  const previousFailures = options.persist ? Math.max(0, Number(row.consecutive_failures) || 0) : 0;
  const consecutiveFailures = ok ? 0 : previousFailures + 1;

  let metricNotifications: PendingNotification[] = [];
  let metricStates: AlertStateSnapshot[] = [];
  let removedRuleIds: string[] = [];
  let metricEvaluations: RuleEvaluationDto[] = [];
  let metricWorst: AlertLevel;

  if (ok) {
    const outcome = evaluateMetricRules({
      monitor: { id: row.id, name: row.name },
      channelIds: repo.parseChannelIds(row),
      rules,
      metrics: samples.metrics,
      previous: previousStates.metric,
      locale,
      baseUrl,
      now,
    });
    metricNotifications = outcome.notifications;
    metricStates = outcome.states;
    removedRuleIds = outcome.removedRuleIds;
    metricEvaluations = outcome.evaluations;
    metricWorst = outcome.worst;
  } else {
    const enabledRuleIds = new Set(rules.filter((rule) => rule.enabled).map((rule) => rule.id));
    removedRuleIds = [...previousStates.metric.keys()].filter((ruleId) => !enabledRuleIds.has(ruleId));
    const removedSet = new Set(removedRuleIds);
    const remaining = [...previousStates.metric.values()].filter((state) => !removedSet.has(state.ruleId));
    metricWorst = worstOfSnapshots(remaining);
  }

  const availability = evaluateAvailability({
    monitor: {
      id: row.id,
      name: row.name,
      failureThreshold: Math.max(1, Number(row.failure_threshold) || 1),
      consecutiveFailures,
    },
    channelIds: repo.parseChannelIds(row),
    previous: previousStates.availability,
    runOk: ok,
    explicitDown: samples.explicitDown,
    error,
    locale,
    baseUrl,
    now,
  });

  const status = worstStatus(metricWorst, availability.state.state === 'critical');
  const notifications = [...metricNotifications, ...availability.notifications];

  let runDto: MonitorRunDto | null = null;
  let monitorDto: MonitorDto | null = null;

  if (options.persist) {
    const update: repo.MonitorRunUpdate = {
      lastStatus: status,
      lastMetrics: samples.metrics,
      lastCheckedAt: finishedAtIso,
      lastError: error,
      consecutiveFailures,
    };
    if (options.scheduleNext) {
      update.nextRunAt = repo.computeNextRunAt(Math.max(30, Number(row.interval_seconds) || 300), now.getTime());
    }
    if (notifications.length > 0) update.lastNotifiedAt = finishedAtIso;

    withTransaction(ctx.db, () => {
      runDto = repo.insertMonitorRun(ctx, {
        monitorId: row.id,
        startedAt: samples.startedAt.toISOString(),
        finishedAt: finishedAtIso,
        ok,
        status,
        httpStatus: samples.httpStatus,
        durationMs: samples.durationMs,
        metrics: samples.metrics,
        error,
        trigger: options.trigger,
      });
      repo.applyMonitorRunUpdate(ctx, row.id, update);
      repo.saveAlertStates(ctx, row.id, [...metricStates, availability.state]);
      repo.deleteMetricAlertStates(ctx, row.id, removedRuleIds);
    });

    enqueueNotifications(ctx, row, notifications);

    const updatedRow = repo.getMonitorRow(ctx.db, row.id);
    if (updatedRow) monitorDto = repo.getMonitorDto(ctx, updatedRow);
  }

  return {
    ok,
    status,
    httpStatus: samples.httpStatus,
    durationMs: samples.durationMs,
    metrics: samples.metrics,
    rawBody: samples.rawBody,
    rawText: samples.rawText,
    error,
    evaluations: [...metricEvaluations, availability.evaluation],
    logs: samples.logs,
    run: runDto,
    monitor: monitorDto,
  };
}

function failureResult(
  ctx: ModuleContext,
  row: repo.MonitorRow,
  rules: RuleDto[],
  options: RunOptions,
  message: string,
): MonitorRunResult {
  const now = new Date();
  return finishRun(ctx, row, rules, options, {
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    httpStatus: null,
    metrics: {},
    rawBody: undefined,
    rawText: '',
    logs: [],
    ok: false,
    explicitDown: false,
    error: message,
  });
}

/** Execute one HTTP monitor and apply rules/persistence. */
export async function executeMonitorRun(
  ctx: ModuleContext,
  row: repo.MonitorRow,
  rules: RuleDto[],
  options: RunOptions,
): Promise<MonitorRunResult> {
  let config: MonitorConfig;
  try {
    config = repo.loadMonitorConfig(ctx, row);
  } catch (error) {
    return failureResult(
      ctx,
      row,
      rules,
      options,
      `Stored monitor config is unreadable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (config.type !== 'http') {
    throw new BadRequestError('Push monitors cannot be executed manually; send a report to the push endpoint');
  }

  const startedAt = new Date();
  const http = await runHttpRequest(config.request);
  const finishedAt = new Date();
  if (!http.ok) {
    return finishRun(ctx, row, rules, options, {
      startedAt,
      finishedAt,
      durationMs: http.durationMs,
      httpStatus: http.httpStatus,
      metrics: {},
      rawBody: http.bodyJson,
      rawText: http.bodyText,
      logs: [],
      ok: false,
      explicitDown: false,
      error: http.error,
    });
  }

  const extract = extractMetrics(config.extract, {
    data: http.bodyJson,
    text: http.bodyText,
    headers: http.headers,
    status: http.httpStatus ?? 0,
    durationMs: http.durationMs,
    now: finishedAt.toISOString(),
  });

  return finishRun(ctx, row, rules, options, {
    startedAt,
    finishedAt,
    durationMs: http.durationMs,
    httpStatus: http.httpStatus,
    metrics: extract.metrics,
    rawBody: http.bodyJson,
    rawText: http.bodyText,
    logs: extract.logs,
    ok: extract.ok,
    explicitDown: extract.status === 'down',
    error: extract.error,
  });
}

/** Apply an inbound push report for a push monitor. */
export function executePushReport(
  ctx: ModuleContext,
  row: repo.MonitorRow,
  rules: RuleDto[],
  report: PushReport,
): MonitorRunResult {
  const now = new Date();
  const metrics: Record<string, MetricValue> = { ...(report.metrics ?? {}) };
  return finishRun(ctx, row, rules, { trigger: 'push', persist: true, scheduleNext: false }, {
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    httpStatus: null,
    metrics,
    rawBody: report,
    rawText: JSON.stringify(report),
    logs: [],
    ok: true,
    explicitDown: report.status === 'down',
    error: null,
  });
}

/**
 * Mark a push monitor as down because it stopped reporting. Returns true when a
 * new down state (and notification) was produced.
 */
export function markPushStaleDown(ctx: ModuleContext, row: repo.MonitorRow): boolean {
  const { availability } = loadAlertStates(ctx, row.id);
  if (availability?.state === 'critical') return false;
  const general = ctx.settings.getGeneral();
  const locale = general.locale;
  const lastSeen = row.last_checked_at ?? row.created_at;
  const message =
    locale === 'en' ? `No push report received since ${lastSeen}` : `自 ${lastSeen} 起未收到推送`;
  const now = new Date();
  const outcome = evaluateAvailability({
    monitor: {
      id: row.id,
      name: row.name,
      failureThreshold: Math.max(1, Number(row.failure_threshold) || 1),
      consecutiveFailures: Math.max(1, Number(row.failure_threshold) || 1),
    },
    channelIds: repo.parseChannelIds(row),
    previous: availability,
    runOk: false,
    explicitDown: false,
    error: message,
    locale,
    baseUrl: ctx.settings.getBaseUrl(),
    now,
  });

  withTransaction(ctx.db, () => {
    repo.applyMonitorRunUpdate(ctx, row.id, { lastStatus: 'down', lastError: message });
    repo.saveAlertStates(ctx, row.id, [outcome.state]);
  });
  enqueueNotifications(ctx, row, outcome.notifications);
  return outcome.notifications.length > 0;
}

function availabilityTestEvaluation(down: boolean, message: string | null, failures: number): RuleEvaluationDto {
  return {
    ruleId: AVAILABILITY_RULE_ID,
    metricKey: AVAILABILITY_RULE_ID,
    level: down ? 'critical' : 'ok',
    value: failures,
    message: down ? (message ?? 'monitor is down') : 'monitor is up',
  };
}

function worstEvaluationLevel(evaluations: RuleEvaluationDto[]): AlertLevel {
  let worst: AlertLevel = 'ok';
  for (const evaluation of evaluations) {
    if (evaluation.level === 'critical') return 'critical';
    if (evaluation.level === 'warning') worst = 'warning';
  }
  return worst;
}

/** Run a draft config + rules without writing anything or notifying. */
export async function testMonitorDraft(
  ctx: ModuleContext,
  input: { config: MonitorConfig; rules: RuleInput[] },
): Promise<MonitorTestResult> {
  const rules = draftRules(input.rules);
  if (input.config.type === 'push') {
    return {
      ok: true,
      status: 'up',
      durationMs: 0,
      metrics: {},
      evaluations: [],
      logs: [],
    };
  }

  const configError = validateRequestConfig(input.config);
  if (configError) throw new BadRequestError(configError);

  const http = await runHttpRequest(input.config.request);
  if (!http.ok) {
    return {
      ok: false,
      status: 'down',
      httpStatus: http.httpStatus,
      durationMs: http.durationMs,
      metrics: {},
      rawBody: http.bodyJson,
      rawText: http.bodyText,
      error: http.error ?? 'Request failed',
      evaluations: [availabilityTestEvaluation(true, http.error, 1)],
      logs: [],
    };
  }

  const extract = extractMetrics(input.config.extract, {
    data: http.bodyJson,
    text: http.bodyText,
    headers: http.headers,
    status: http.httpStatus ?? 0,
    durationMs: http.durationMs,
    now: new Date().toISOString(),
  });
  const evaluations = evaluateInstant(rules, extract.metrics);

  if (!extract.ok) {
    return {
      ok: false,
      status: 'down',
      httpStatus: http.httpStatus,
      durationMs: http.durationMs,
      metrics: extract.metrics,
      rawBody: http.bodyJson,
      rawText: http.bodyText,
      error: extract.error ?? 'Extraction failed',
      evaluations: [...evaluations, availabilityTestEvaluation(true, extract.error, 1)],
      logs: extract.logs,
    };
  }

  const metricErrors = collectMetricErrors(rules, extract.metrics);
  if (metricErrors.length > 0) {
    return {
      ok: false,
      status: 'down',
      httpStatus: http.httpStatus,
      durationMs: http.durationMs,
      metrics: extract.metrics,
      rawBody: http.bodyJson,
      rawText: http.bodyText,
      error: metricErrors.join('; '),
      evaluations,
      logs: extract.logs,
    };
  }

  const down = extract.status === 'down';
  const level = worstEvaluationLevel(evaluations);
  const status: MonitorStatus = down
    ? 'down'
    : level === 'critical'
      ? 'critical'
      : level === 'warning'
        ? 'warning'
        : 'up';

  return {
    ok: true,
    status,
    httpStatus: http.httpStatus,
    durationMs: http.durationMs,
    metrics: extract.metrics,
    rawBody: http.bodyJson,
    rawText: http.bodyText,
    evaluations: [...evaluations, availabilityTestEvaluation(down, down ? 'service reported down' : null, 0)],
    logs: extract.logs,
  };
}
