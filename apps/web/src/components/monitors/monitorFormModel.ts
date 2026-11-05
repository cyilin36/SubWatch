import { z } from 'zod';
import { monitorInputSchema } from '@subwatch/shared';
import type {
  MonitorConfig,
  MonitorDto,
  MonitorInput,
  MonitorType,
  Operator,
} from '@subwatch/shared';

export interface HeaderRow {
  key: string;
  value: string;
  secret: boolean;
}

export interface QueryRow {
  key: string;
  value: string;
}

export interface MetricRow {
  key: string;
  label: string;
  path: string;
  unit: string;
  scale: string;
  offset: string;
}

export interface RuleRow {
  id?: string;
  metricKey: string;
  label: string;
  unit: string;
  operator: Operator;
  warningValue: string;
  criticalValue: string;
  durationChecks: string;
  cooldownSeconds: string;
  repeatIntervalSeconds: string;
  recoveryOperator: Operator | 'none';
  recoveryValue: string;
  recoveryChecks: string;
  enabled: boolean;
}

export type AuthFormType = 'none' | 'basic' | 'bearer';

export interface MonitorRequestForm {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  url: string;
  headers: HeaderRow[];
  query: QueryRow[];
  bodyType: 'none' | 'json' | 'raw' | 'form';
  body: string;
  authType: AuthFormType;
  username: string;
  password: string;
  token: string;
  timeoutMs: string;
  followRedirects: boolean;
  verifyTls: boolean;
  maxResponseBytes: string;
}

export interface MonitorFormValues {
  name: string;
  description: string;
  type: MonitorType;
  intervalSeconds: string;
  failureThreshold: string;
  staleAfterSeconds: string;
  channelIds: string[];
  tags: string[];
  enabled: boolean;
  request: MonitorRequestForm;
  extractMode: 'json' | 'javascript';
  metrics: MetricRow[];
  code: string;
  rules: RuleRow[];
}

export function blankMetricRow(): MetricRow {
  return { key: '', label: '', path: '', unit: '', scale: '', offset: '' };
}

export function blankRequestForm(): MonitorRequestForm {
  return {
    method: 'GET',
    url: '',
    headers: [],
    query: [],
    bodyType: 'none',
    body: '',
    authType: 'none',
    username: '',
    password: '',
    token: '',
    timeoutMs: '10000',
    followRedirects: true,
    verifyTls: true,
    maxResponseBytes: '1048576',
  };
}

export function blankRuleRow(): RuleRow {
  return {
    metricKey: '',
    label: '',
    unit: '',
    operator: 'lt',
    warningValue: '',
    criticalValue: '',
    durationChecks: '1',
    cooldownSeconds: '3600',
    repeatIntervalSeconds: '0',
    recoveryOperator: 'none',
    recoveryValue: '',
    recoveryChecks: '1',
    enabled: true,
  };
}

export function blankMonitorFormValues(): MonitorFormValues {
  return {
    name: '',
    description: '',
    type: 'http',
    intervalSeconds: '300',
    failureThreshold: '2',
    staleAfterSeconds: '3600',
    channelIds: [],
    tags: [],
    enabled: true,
    request: blankRequestForm(),
    extractMode: 'json',
    metrics: [blankMetricRow()],
    code: '',
    rules: [],
  };
}

function numberString(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export function monitorToFormValues(monitor: MonitorDto): MonitorFormValues {
  const base = blankMonitorFormValues();
  const values: MonitorFormValues = {
    ...base,
    name: monitor.name,
    description: monitor.description,
    type: monitor.type,
    intervalSeconds: String(monitor.intervalSeconds),
    failureThreshold: String(monitor.failureThreshold),
    staleAfterSeconds: String(monitor.staleAfterSeconds),
    channelIds: [...monitor.channelIds],
    tags: [...monitor.tags],
    enabled: monitor.enabled,
    rules: monitor.rules.map((rule) => ({
      id: rule.id,
      metricKey: rule.metricKey,
      label: rule.label,
      unit: rule.unit,
      operator: rule.operator,
      warningValue: numberString(rule.warningValue),
      criticalValue: numberString(rule.criticalValue),
      durationChecks: String(rule.durationChecks),
      cooldownSeconds: String(rule.cooldownSeconds),
      repeatIntervalSeconds: String(rule.repeatIntervalSeconds),
      recoveryOperator: rule.recoveryOperator ?? 'none',
      recoveryValue: numberString(rule.recoveryValue),
      recoveryChecks: String(rule.recoveryChecks),
      enabled: rule.enabled,
    })),
  };

  const config: MonitorConfig = monitor.config;
  if (config.type === 'http') {
    const request = config.request;
    values.request = {
      method: request.method,
      url: request.url,
      headers: request.headers.map((header) => ({ ...header })),
      query: request.query.map((entry) => ({ ...entry })),
      bodyType: request.bodyType,
      body: request.body,
      authType: request.auth.type,
      username: request.auth.type === 'basic' ? request.auth.username : '',
      password: request.auth.type === 'basic' ? request.auth.password : '',
      token: request.auth.type === 'bearer' ? request.auth.token : '',
      timeoutMs: String(request.timeoutMs),
      followRedirects: request.followRedirects,
      verifyTls: request.verifyTls,
      maxResponseBytes: String(request.maxResponseBytes),
    };
    values.extractMode = config.extract.mode;
    if (config.extract.mode === 'json') {
      values.metrics = config.extract.metrics.map((metric) => ({
        key: metric.key,
        label: metric.label,
        path: metric.path,
        unit: metric.unit,
        scale: metric.scale === undefined ? '' : String(metric.scale),
        offset: metric.offset === undefined ? '' : String(metric.offset),
      }));
      if (values.metrics.length === 0) values.metrics = [blankMetricRow()];
    } else {
      values.code = config.extract.code;
    }
  }
  return values;
}

function trimOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function optionalNumberField(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function buildCandidate(values: MonitorFormValues): unknown {
  const metrics = values.metrics
    .filter((metric) => metric.key.trim() !== '' || metric.path.trim() !== '')
    .map((metric) => {
      const scale = optionalNumberField(metric.scale);
      const offset = optionalNumberField(metric.offset);
      return {
        key: metric.key.trim(),
        label: metric.label,
        path: metric.path.trim(),
        unit: metric.unit,
        ...(scale === undefined ? {} : { scale }),
        ...(offset === undefined ? {} : { offset }),
      };
    });

  const extract =
    values.extractMode === 'json'
      ? { mode: 'json' as const, metrics }
      : { mode: 'javascript' as const, code: values.code };

  const auth =
    values.request.authType === 'basic'
      ? {
          type: 'basic' as const,
          username: values.request.username,
          password: values.request.password,
        }
      : values.request.authType === 'bearer'
        ? { type: 'bearer' as const, token: values.request.token }
        : { type: 'none' as const };

  const request = {
    url: values.request.url.trim(),
    method: values.request.method,
    headers: values.request.headers
      .filter((header) => header.key.trim() !== '')
      .map((header) => ({ key: header.key.trim(), value: header.value, secret: header.secret })),
    query: values.request.query
      .filter((entry) => entry.key.trim() !== '')
      .map((entry) => ({ key: entry.key.trim(), value: entry.value })),
    bodyType: values.request.bodyType,
    body: values.request.bodyType === 'none' ? '' : values.request.body,
    auth,
    timeoutMs: Number(values.request.timeoutMs),
    followRedirects: values.request.followRedirects,
    verifyTls: values.request.verifyTls,
    maxResponseBytes: Number(values.request.maxResponseBytes),
  };

  const config =
    values.type === 'push' ? { type: 'push' as const } : { type: 'http' as const, request, extract };

  const rules = values.rules.map((rule) => ({
    ...(rule.id ? { id: rule.id } : {}),
    metricKey: rule.metricKey.trim(),
    label: rule.label,
    unit: rule.unit,
    operator: rule.operator,
    warningValue: trimOrNull(rule.warningValue),
    criticalValue: trimOrNull(rule.criticalValue),
    durationChecks: Number(rule.durationChecks),
    cooldownSeconds: Number(rule.cooldownSeconds),
    repeatIntervalSeconds: Number(rule.repeatIntervalSeconds),
    recoveryOperator: rule.recoveryOperator === 'none' ? null : rule.recoveryOperator,
    recoveryValue: rule.recoveryOperator === 'none' ? null : trimOrNull(rule.recoveryValue),
    recoveryChecks: Number(rule.recoveryChecks),
    enabled: rule.enabled,
  }));

  return {
    name: values.name,
    description: values.description,
    config,
    intervalSeconds: Number(values.intervalSeconds),
    failureThreshold: Number(values.failureThreshold),
    staleAfterSeconds: Number(values.staleAfterSeconds),
    channelIds: values.channelIds,
    tags: values.tags,
    enabled: values.enabled,
    rules,
  };
}

export type MonitorBuildResult =
  | { success: true; input: MonitorInput }
  | { success: false; error: z.ZodError };

/** Build a validated MonitorInput from the form-local shape. */
export function buildMonitorInput(values: MonitorFormValues): MonitorBuildResult {
  const parsed = monitorInputSchema.safeParse(buildCandidate(values));
  if (!parsed.success) return { success: false, error: parsed.error };
  return { success: true, input: parsed.data };
}

/** Map a zod issue path onto the form-local path used by RHF. */
export function zodPathToFormPath(path: (string | number)[]): string | null {
  const [root, second, ...rest] = path;
  if (root === 'config') {
    if (second === 'type') return 'type';
    if (second === 'request') {
      if (rest[0] === 'auth') {
        const field = rest[1];
        if (field === 'type') return 'request.authType';
        if (typeof field === 'string') return `request.${field}`;
        return 'request.authType';
      }
      return ['request', ...rest].join('.');
    }
    if (second === 'extract') {
      if (rest[0] === 'mode') return 'extractMode';
      if (rest[0] === 'code') return 'code';
      if (rest[0] === 'metrics') return ['metrics', ...rest.slice(1)].join('.');
      return 'extractMode';
    }
    return null;
  }
  return path.map(String).join('.');
}

export type MonitorFormTab = 'basic' | 'request' | 'extract' | 'rules';

export function tabForFormPath(path: string): MonitorFormTab {
  if (path.startsWith('request.') || path === 'request') return 'request';
  if (path.startsWith('metrics') || path === 'code' || path === 'extractMode') return 'extract';
  if (path.startsWith('rules')) return 'rules';
  return 'basic';
}
