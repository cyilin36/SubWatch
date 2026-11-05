import type {
  Locale,
  MetricValue,
  MonitorStatus,
  NotificationEventType,
  Operator,
  RuleDto,
  RuleEvaluationDto,
} from '@subwatch/shared';
import type { NotificationPayload, NotificationSeverity } from '../context.js';

export type AlertLevel = 'ok' | 'warning' | 'critical';
export type AlertKind = 'metric' | 'availability';

export const AVAILABILITY_RULE_ID = 'availability';

export interface AlertStateSnapshot {
  ruleId: string;
  kind: AlertKind;
  state: AlertLevel;
  severity: 'warning' | 'critical' | 'down' | null;
  value: number | null;
  breachCount: number;
  /** ISO timestamp of when the current state started. */
  since: string;
  lastNotifiedAt: string | null;
}

export interface PendingNotification {
  eventType: NotificationEventType;
  eventKey: string;
  payload: NotificationPayload;
}

export interface MonitorRef {
  id: string;
  name: string;
}

export function createEmptyAlertState(ruleId: string, kind: AlertKind, since: string): AlertStateSnapshot {
  return {
    ruleId,
    kind,
    state: 'ok',
    severity: null,
    value: null,
    breachCount: 0,
    since,
    lastNotifiedAt: null,
  };
}

export function compareValues(value: number, operator: Operator, threshold: number): boolean {
  switch (operator) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    case 'eq':
      return value === threshold;
    case 'neq':
      return value !== threshold;
    default:
      return false;
  }
}

/** Instantaneous threshold evaluation (critical takes precedence over warning). */
export function levelForRule(rule: RuleDto, value: number): AlertLevel {
  if (rule.criticalValue !== null && compareValues(value, rule.operator, rule.criticalValue)) return 'critical';
  if (rule.warningValue !== null && compareValues(value, rule.operator, rule.warningValue)) return 'warning';
  return 'ok';
}

function numericMetricValue(metrics: Record<string, MetricValue>, key: string): number | null {
  const metric = metrics[key];
  if (!metric) return null;
  if (typeof metric.value === 'number' && Number.isFinite(metric.value)) return metric.value;
  return null;
}

/**
 * Verify that every enabled rule has a finite numeric metric. Missing or
 * non-numeric metrics turn the run into an explicit failure instead of being
 * silently skipped.
 */
export function collectMetricErrors(rules: RuleDto[], metrics: Record<string, MetricValue>): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!rule.enabled || seen.has(rule.metricKey)) continue;
    seen.add(rule.metricKey);
    const metric = metrics[rule.metricKey];
    if (!metric) {
      errors.push(`Metric "${rule.metricKey}" is missing from the extractor output`);
      continue;
    }
    if (numericMetricValue(metrics, rule.metricKey) === null) {
      errors.push(`Metric "${rule.metricKey}" is not numeric and cannot be threshold-checked`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Text rendering (bilingual by instance locale)
// ---------------------------------------------------------------------------

function operatorSymbol(operator: Operator): string {
  switch (operator) {
    case 'gt':
      return '>';
    case 'gte':
      return '≥';
    case 'lt':
      return '<';
    case 'lte':
      return '≤';
    case 'eq':
      return '=';
    case 'neq':
      return '≠';
    default:
      return operator;
  }
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

function formatMetric(value: number, unit: string): string {
  return `${formatNumber(value)}${unit}`;
}

function metricLabel(rule: RuleDto): string {
  return rule.label || rule.metricKey;
}

function monitorUrl(baseUrl: string, monitorId: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/monitors/${encodeURIComponent(monitorId)}`;
}

function metricFiringPayload(input: {
  locale: Locale;
  monitor: MonitorRef;
  rule: RuleDto;
  level: 'warning' | 'critical';
  value: number;
  baseUrl: string;
  since: string;
  repeat: boolean;
}): NotificationPayload {
  const { locale, monitor, rule, level, value, baseUrl, since, repeat } = input;
  const valueText = formatMetric(value, rule.unit);
  const threshold = level === 'critical' ? rule.criticalValue : rule.warningValue;
  const thresholdText = threshold === null ? '-' : formatMetric(threshold, rule.unit);
  const comparison = `${operatorSymbol(rule.operator)} ${thresholdText}`;
  const severity: NotificationSeverity = level;
  const data: Record<string, unknown> = {
    monitorId: monitor.id,
    monitorName: monitor.name,
    ruleId: rule.id,
    metricKey: rule.metricKey,
    metricLabel: metricLabel(rule),
    value,
    unit: rule.unit,
    state: level,
    severity: level,
    since,
    repeat,
  };
  if (locale === 'en') {
    return {
      title: `Monitor ${level}: ${monitor.name}`,
      message: `Metric "${metricLabel(rule)}" is ${valueText} (${comparison})${
        repeat ? ' — still firing' : ''
      }`,
      severity,
      data,
      appUrl: monitorUrl(baseUrl, monitor.id),
    };
  }
  return {
    title: `监控${level === 'critical' ? '严重告警' : '预警'}：${monitor.name}`,
    message: `指标「${metricLabel(rule)}」当前值 ${valueText}，${level === 'critical' ? '超过严重阈值' : '超过预警阈值'}（${comparison}）${
      repeat ? '，持续告警中' : ''
    }`,
    severity,
    data,
    appUrl: monitorUrl(baseUrl, monitor.id),
  };
}

function metricResolvedPayload(input: {
  locale: Locale;
  monitor: MonitorRef;
  rule: RuleDto;
  value: number | null;
  baseUrl: string;
  since: string;
}): NotificationPayload {
  const { locale, monitor, rule, value, baseUrl, since } = input;
  const valueText = value === null ? '-' : formatMetric(value, rule.unit);
  const data: Record<string, unknown> = {
    monitorId: monitor.id,
    monitorName: monitor.name,
    ruleId: rule.id,
    metricKey: rule.metricKey,
    metricLabel: metricLabel(rule),
    value,
    unit: rule.unit,
    state: 'ok',
    severity: 'success',
    since,
  };
  if (locale === 'en') {
    return {
      title: `Monitor recovered: ${monitor.name}`,
      message: `Metric "${metricLabel(rule)}" is back to normal (current ${valueText})`,
      severity: 'success',
      data,
      appUrl: monitorUrl(baseUrl, monitor.id),
    };
  }
  return {
    title: `监控恢复：${monitor.name}`,
    message: `指标「${metricLabel(rule)}」已恢复正常（当前值 ${valueText}）`,
    severity: 'success',
    data,
    appUrl: monitorUrl(baseUrl, monitor.id),
  };
}

function availabilityDownPayload(input: {
  locale: Locale;
  monitor: MonitorRef;
  failures: number;
  failureThreshold: number;
  error: string | null;
  baseUrl: string;
  since: string;
}): NotificationPayload {
  const { locale, monitor, failures, failureThreshold, error, baseUrl, since } = input;
  const data: Record<string, unknown> = {
    monitorId: monitor.id,
    monitorName: monitor.name,
    state: 'down',
    severity: 'down',
    status: 'down',
    consecutiveFailures: failures,
    failureThreshold,
    error,
    since,
  };
  if (locale === 'en') {
    return {
      title: `Monitor down: ${monitor.name}`,
      message: `${failures} consecutive checks failed (threshold ${failureThreshold})${error ? `: ${error}` : ''}`,
      severity: 'critical',
      data,
      appUrl: monitorUrl(baseUrl, monitor.id),
    };
  }
  return {
    title: `监控不可用：${monitor.name}`,
    message: `连续 ${failures} 次检查失败（阈值 ${failureThreshold}）${error ? `：${error}` : ''}`,
    severity: 'critical',
    data,
    appUrl: monitorUrl(baseUrl, monitor.id),
  };
}

function availabilityRecoveredPayload(input: {
  locale: Locale;
  monitor: MonitorRef;
  baseUrl: string;
  since: string;
}): NotificationPayload {
  const { locale, monitor, baseUrl, since } = input;
  const data: Record<string, unknown> = {
    monitorId: monitor.id,
    monitorName: monitor.name,
    state: 'ok',
    severity: 'success',
    status: 'up',
    since,
  };
  if (locale === 'en') {
    return {
      title: `Monitor recovered: ${monitor.name}`,
      message: 'Monitor is healthy again.',
      severity: 'success',
      data,
      appUrl: monitorUrl(baseUrl, monitor.id),
    };
  }
  return {
    title: `监控已恢复：${monitor.name}`,
    message: '监控已恢复正常。',
    severity: 'success',
    data,
    appUrl: monitorUrl(baseUrl, monitor.id),
  };
}

// ---------------------------------------------------------------------------
// Metric rule state machine
// ---------------------------------------------------------------------------

export interface MetricRuleEvaluationInput {
  monitor: MonitorRef;
  channelIds: string[];
  rules: RuleDto[];
  metrics: Record<string, MetricValue>;
  previous: Map<string, AlertStateSnapshot>;
  locale: Locale;
  baseUrl: string;
  now: Date;
}

export interface MetricRuleOutcome {
  evaluations: RuleEvaluationDto[];
  /** Snapshot for every enabled rule (full replacement for metric alert rows). */
  states: AlertStateSnapshot[];
  /** Rule ids whose alert row should be deleted (rule deleted or disabled). */
  removedRuleIds: string[];
  notifications: PendingNotification[];
  worst: AlertLevel;
}

/**
 * Minimum spacing between two *firing* notifications for the same rule. Recovery
 * notifications intentionally bypass the cooldown so an incident is always
 * closed out visibly.
 */
function cooldownBlocks(rule: RuleDto, lastNotifiedAt: string | null, nowMs: number): boolean {
  if (rule.cooldownSeconds <= 0 || !lastNotifiedAt) return false;
  const last = Date.parse(lastNotifiedAt);
  if (!Number.isFinite(last)) return false;
  return nowMs - last < rule.cooldownSeconds * 1000;
}

function recoveryIsMet(rule: RuleDto, value: number, level: AlertLevel): boolean {
  if (rule.recoveryOperator !== null && rule.recoveryValue !== null) {
    return compareValues(value, rule.recoveryOperator, rule.recoveryValue);
  }
  return level === 'ok';
}

export function evaluateMetricRules(input: MetricRuleEvaluationInput): MetricRuleOutcome {
  const { monitor, rules, metrics, previous, locale, baseUrl, now } = input;
  const nowIsoValue = now.toISOString();
  const nowMs = now.getTime();
  const states: AlertStateSnapshot[] = [];
  const notifications: PendingNotification[] = [];
  const evaluations: RuleEvaluationDto[] = [];
  const enabledRuleIds = new Set<string>();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    enabledRuleIds.add(rule.id);
    const value = numericMetricValue(metrics, rule.metricKey);
    if (value === null) continue; // The run is already marked failed by collectMetricErrors.
    const level = levelForRule(rule, value);
    evaluations.push({ ruleId: rule.id, metricKey: rule.metricKey, level, value });

    // breachCount tracks the consecutive-check progress of the *active* edge:
    // while ok it counts consecutive breaches (durationChecks), while firing it
    // counts consecutive recovery-condition hits (recoveryChecks).
    const prior = previous.get(rule.id) ?? createEmptyAlertState(rule.id, 'metric', nowIsoValue);
    let next: AlertStateSnapshot = {
      ...prior,
      ruleId: rule.id,
      kind: 'metric',
      value,
    };

    if (prior.state === 'ok') {
      if (level === 'ok') {
        next = { ...next, state: 'ok', severity: null, breachCount: 0, since: prior.since };
      } else {
        const breachCount = prior.breachCount + 1;
        if (breachCount >= rule.durationChecks) {
          const since = nowIsoValue;
          next = { ...next, state: level, severity: level, breachCount: 0, since };
          if (!cooldownBlocks(rule, prior.lastNotifiedAt, nowMs)) {
            const eventKey = `alert:${monitor.id}:${rule.id}:${level}:${since}`;
            next.lastNotifiedAt = nowIsoValue;
            notifications.push({
              eventType: 'monitor.firing',
              eventKey,
              payload: metricFiringPayload({
                locale,
                monitor,
                rule,
                level,
                value,
                baseUrl,
                since,
                repeat: false,
              }),
            });
          }
        } else {
          next = { ...next, state: 'ok', severity: null, breachCount };
        }
      }
    } else if (recoveryIsMet(rule, value, level)) {
      const recoveryCount = prior.breachCount + 1;
      if (recoveryCount >= rule.recoveryChecks) {
        const since = nowIsoValue;
        next = { ...next, state: 'ok', severity: null, breachCount: 0, since, lastNotifiedAt: nowIsoValue };
        notifications.push({
          eventType: 'monitor.resolved',
          eventKey: `alert:${monitor.id}:${rule.id}:ok:${since}`,
          payload: metricResolvedPayload({ locale, monitor, rule, value, baseUrl, since }),
        });
      } else {
        next = { ...next, state: prior.state, severity: prior.severity, breachCount: recoveryCount };
      }
    } else if (level === 'critical' && prior.state === 'warning') {
      const since = nowIsoValue;
      next = { ...next, state: 'critical', severity: 'critical', breachCount: 0, since };
      if (!cooldownBlocks(rule, prior.lastNotifiedAt, nowMs)) {
        next.lastNotifiedAt = nowIsoValue;
        notifications.push({
          eventType: 'monitor.firing',
          eventKey: `alert:${monitor.id}:${rule.id}:critical:${since}`,
          payload: metricFiringPayload({
            locale,
            monitor,
            rule,
            level: 'critical',
            value,
            baseUrl,
            since,
            repeat: false,
          }),
        });
      }
    } else if (level === 'warning' && prior.state === 'critical') {
      const since = nowIsoValue;
      next = { ...next, state: 'warning', severity: 'warning', breachCount: 0, since };
      if (!cooldownBlocks(rule, prior.lastNotifiedAt, nowMs)) {
        next.lastNotifiedAt = nowIsoValue;
        notifications.push({
          eventType: 'monitor.firing',
          eventKey: `alert:${monitor.id}:${rule.id}:warning:${since}`,
          payload: metricFiringPayload({
            locale,
            monitor,
            rule,
            level: 'warning',
            value,
            baseUrl,
            since,
            repeat: false,
          }),
        });
      }
    } else {
      next = { ...next, state: prior.state, severity: prior.severity, breachCount: prior.breachCount };
      if (
        rule.repeatIntervalSeconds > 0 &&
        prior.lastNotifiedAt &&
        !cooldownBlocks(rule, prior.lastNotifiedAt, nowMs)
      ) {
        const lastNotifiedMs = Date.parse(prior.lastNotifiedAt);
        const sinceMs = Date.parse(prior.since);
        if (
          Number.isFinite(lastNotifiedMs) &&
          nowMs - lastNotifiedMs >= rule.repeatIntervalSeconds * 1000 &&
          rule.repeatIntervalSeconds > 0
        ) {
          const bucket = Number.isFinite(sinceMs)
            ? Math.floor((nowMs - sinceMs) / (rule.repeatIntervalSeconds * 1000))
            : 0;
          const repeatLevel = prior.state === 'critical' ? 'critical' : 'warning';
          next.lastNotifiedAt = nowIsoValue;
          notifications.push({
            eventType: 'monitor.firing',
            eventKey: `alert:${monitor.id}:${rule.id}:${repeatLevel}:${prior.since}:repeat:${bucket}`,
            payload: metricFiringPayload({
              locale,
              monitor,
              rule,
              level: repeatLevel,
              value,
              baseUrl,
              since: prior.since,
              repeat: true,
            }),
          });
        }
      }
    }

    states.push(next);
  }

  const removedRuleIds: string[] = [];
  for (const ruleId of previous.keys()) {
    if (!enabledRuleIds.has(ruleId)) removedRuleIds.push(ruleId);
  }

  let worst: AlertLevel = 'ok';
  for (const state of states) {
    if (state.state === 'critical') {
      worst = 'critical';
      break;
    }
    if (state.state === 'warning') worst = 'warning';
  }

  return { evaluations, states, removedRuleIds, notifications, worst };
}

/** Instantaneous evaluations used by the "test run" endpoint (no state machine). */
export function evaluateInstant(rules: RuleDto[], metrics: Record<string, MetricValue>): RuleEvaluationDto[] {
  const evaluations: RuleEvaluationDto[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const value = numericMetricValue(metrics, rule.metricKey);
    if (value === null) {
      evaluations.push({
        ruleId: rule.id,
        metricKey: rule.metricKey,
        level: 'ok',
        value: metrics[rule.metricKey]?.value ?? null,
        message: `Metric "${rule.metricKey}" is missing or not numeric`,
      });
      continue;
    }
    evaluations.push({ ruleId: rule.id, metricKey: rule.metricKey, level: levelForRule(rule, value), value });
  }
  return evaluations;
}

// ---------------------------------------------------------------------------
// Availability state machine
// ---------------------------------------------------------------------------

export interface AvailabilityEvaluationInput {
  monitor: MonitorRef & { failureThreshold: number; consecutiveFailures: number };
  channelIds: string[];
  previous: AlertStateSnapshot | null;
  runOk: boolean;
  /** Extractor explicitly reported `status: 'down'`. */
  explicitDown: boolean;
  error: string | null;
  locale: Locale;
  baseUrl: string;
  now: Date;
}

export interface AvailabilityOutcome {
  state: AlertStateSnapshot;
  evaluation: RuleEvaluationDto;
  notifications: PendingNotification[];
}

export function evaluateAvailability(input: AvailabilityEvaluationInput): AvailabilityOutcome {
  const { monitor, previous, runOk, explicitDown, error, locale, baseUrl, now } = input;
  const nowIsoValue = now.toISOString();
  const prior = previous ?? createEmptyAlertState(AVAILABILITY_RULE_ID, 'availability', nowIsoValue);
  const shouldBeDown = explicitDown || input.monitor.consecutiveFailures >= monitor.failureThreshold;
  const notifications: PendingNotification[] = [];
  let state: AlertStateSnapshot = {
    ...prior,
    ruleId: AVAILABILITY_RULE_ID,
    kind: 'availability',
    breachCount: input.monitor.consecutiveFailures,
    value: input.monitor.consecutiveFailures,
  };

  if (shouldBeDown) {
    if (prior.state !== 'critical') {
      const since = nowIsoValue;
      state = { ...state, state: 'critical', severity: 'down', since, lastNotifiedAt: nowIsoValue };
      notifications.push({
        eventType: 'monitor.down',
        eventKey: `monitor-down:${monitor.id}:${since}`,
        payload: availabilityDownPayload({
          locale,
          monitor,
          failures: input.monitor.consecutiveFailures,
          failureThreshold: monitor.failureThreshold,
          error,
          baseUrl,
          since,
        }),
      });
    } else {
      state = { ...state, state: 'critical', severity: 'down' };
    }
  } else if (runOk) {
    if (prior.state !== 'ok') {
      const since = nowIsoValue;
      state = { ...state, state: 'ok', severity: null, since, lastNotifiedAt: nowIsoValue };
      notifications.push({
        eventType: 'monitor.recovered',
        eventKey: `monitor-recovered:${monitor.id}:${since}`,
        payload: availabilityRecoveredPayload({ locale, monitor, baseUrl, since }),
      });
    } else {
      state = { ...state, state: 'ok', severity: null };
    }
  } else {
    // Failure below the threshold: keep the previous availability state.
    state = { ...state, state: prior.state, severity: prior.severity };
  }

  const evaluation: RuleEvaluationDto = {
    ruleId: AVAILABILITY_RULE_ID,
    metricKey: AVAILABILITY_RULE_ID,
    level: state.state === 'critical' ? 'critical' : 'ok',
    value: input.monitor.consecutiveFailures,
    message: state.state === 'critical' ? (error ?? 'monitor is down') : 'monitor is up',
  };

  return { state, evaluation, notifications };
}

export function worstStatus(metricWorst: AlertLevel, availabilityDown: boolean): MonitorStatus {
  if (availabilityDown) return 'down';
  if (metricWorst === 'critical') return 'critical';
  if (metricWorst === 'warning') return 'warning';
  return 'up';
}
