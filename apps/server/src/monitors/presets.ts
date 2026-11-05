import type { MonitorConfig, RuleInput } from '@subwatch/shared';
import { DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_MONITOR_INTERVAL_SECONDS } from '@subwatch/shared';

/**
 * Reusable example configurations shown in the monitor editor. Nothing here is
 * created automatically; the values are meant to be copied into a draft.
 */
export interface MonitorPreset {
  key: string;
  name: string;
  description: string;
  config: MonitorConfig;
  intervalSeconds: number;
  failureThreshold: number;
  staleAfterSeconds: number;
  rules: RuleInput[];
}

const defaultHttpRequest = {
  method: 'GET' as const,
  headers: [],
  query: [],
  bodyType: 'none' as const,
  body: '',
  auth: { type: 'none' as const },
  timeoutMs: 10_000,
  followRedirects: true,
  verifyTls: true,
  maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
};

function rule(overrides: Partial<RuleInput> & Pick<RuleInput, 'metricKey' | 'operator'>): RuleInput {
  return {
    id: undefined,
    metricKey: overrides.metricKey,
    label: overrides.label ?? '',
    unit: overrides.unit ?? '',
    operator: overrides.operator,
    warningValue: overrides.warningValue ?? null,
    criticalValue: overrides.criticalValue ?? null,
    durationChecks: overrides.durationChecks ?? 2,
    cooldownSeconds: overrides.cooldownSeconds ?? 1800,
    repeatIntervalSeconds: overrides.repeatIntervalSeconds ?? 0,
    recoveryOperator: overrides.recoveryOperator ?? null,
    recoveryValue: overrides.recoveryValue ?? null,
    recoveryChecks: overrides.recoveryChecks ?? 2,
    enabled: overrides.enabled ?? true,
  };
}

/** Generic quota/usage JSON API (dotted JSON path extraction). */
const genericQuotaPreset: MonitorPreset = {
  key: 'generic-json-quota',
  name: '通用 JSON 额度监控',
  description: '从任意返回 JSON 的服务读取剩余额度并按百分比告警',
  intervalSeconds: DEFAULT_MONITOR_INTERVAL_SECONDS,
  failureThreshold: 2,
  staleAfterSeconds: 3600,
  config: {
    type: 'http',
    request: {
      ...defaultHttpRequest,
      url: 'https://api.example.com/usage',
      headers: [{ key: 'Authorization', value: '', secret: true }],
    },
    extract: {
      mode: 'json',
      metrics: [
        { key: 'remaining', label: '剩余额度', path: 'data.remaining', unit: '%' },
        { key: 'used', label: '已用额度', path: 'data.used', unit: '' },
      ],
    },
  },
  rules: [
    rule({ metricKey: 'remaining', label: '剩余额度', unit: '%', operator: 'lt', warningValue: 20, criticalValue: 5 }),
  ],
};

/** DeepSeek balance API (balance_infos[0].total_balance is a string amount). */
const deepseekBalancePreset: MonitorPreset = {
  key: 'deepseek-balance',
  name: 'DeepSeek 余额监控',
  description: '读取 DeepSeek 开放平台余额，低于阈值时提醒充值',
  intervalSeconds: 6 * 3600,
  failureThreshold: 3,
  staleAfterSeconds: 24 * 3600,
  config: {
    type: 'http',
    request: {
      ...defaultHttpRequest,
      url: 'https://api.deepseek.com/user/balance',
      headers: [{ key: 'Authorization', value: 'Bearer ', secret: true }],
    },
    extract: {
      mode: 'json',
      metrics: [
        { key: 'balance', label: '账户余额', path: 'balance_infos.0.total_balance', unit: 'CNY' },
        { key: 'available', label: '是否可用', path: 'is_available', unit: '' },
      ],
    },
  },
  rules: [
    rule({
      metricKey: 'balance',
      label: '账户余额',
      unit: 'CNY',
      operator: 'lt',
      warningValue: 10,
      criticalValue: 2,
    }),
  ],
};

/** Plain HTTP health check (any 2xx/3xx response counts as up). */
const healthCheckPreset: MonitorPreset = {
  key: 'http-health',
  name: 'HTTP 健康检查',
  description: '定期请求健康检查端点，连续失败时告警',
  intervalSeconds: 60,
  failureThreshold: 3,
  staleAfterSeconds: 3600,
  config: {
    type: 'http',
    request: {
      ...defaultHttpRequest,
      url: 'https://example.com/healthz',
      timeoutMs: 5_000,
    },
    extract: {
      mode: 'javascript',
      code: [
        "// 健康检查端点没有 JSON 指标时，直接根据 HTTP 状态判断。",
        "if (status >= 200 && status < 400) {",
        "  return { metrics: {}, status: 'up' };",
        "}",
        "log('unexpected status', status);",
        "return { metrics: {}, status: 'down' };",
      ].join('\n'),
    },
  },
  rules: [],
};

/** Push monitor driven by cron/CLI/another service. */
const pushPreset: MonitorPreset = {
  key: 'push-heartbeat',
  name: 'Push 心跳监控',
  description: '外部脚本定时 POST 上报指标，超过 staleAfterSeconds 未上报会判定异常',
  intervalSeconds: 300,
  failureThreshold: 2,
  staleAfterSeconds: 3600,
  config: { type: 'push' },
  rules: [rule({ metricKey: 'remaining', label: '剩余额度', unit: '%', operator: 'lt', warningValue: 20, criticalValue: 5 })],
};

export const MONITOR_PRESETS: readonly MonitorPreset[] = [
  genericQuotaPreset,
  deepseekBalancePreset,
  healthCheckPreset,
  pushPreset,
];

export function findMonitorPreset(key: string): MonitorPreset | undefined {
  return MONITOR_PRESETS.find((preset) => preset.key === key);
}
