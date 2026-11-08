import type { z } from 'zod';
import type {
  ChannelType,
  Cycle,
  Locale,
  MonitorStatus,
  MonitorType,
  NotificationEventType,
  NotificationStatus,
  Operator,
  RunTrigger,
  SubscriptionStatus,
} from './constants.js';
import type {
  channelInputSchema,
  emailChannelConfigSchema,
  extractorSchema,
  generalSettingsSchema,
  httpMonitorConfigSchema,
  monitorConfigSchema,
  monitorInputSchema,
  pushMonitorConfigSchema,
  ruleInputSchema,
  subscriptionInputSchema,
  webhookChannelConfigSchema,
} from './schemas.js';

// Re-export constants-derived types used widely by the UI.
export type { Theme } from './constants.js';

export type MonitorConfig = z.infer<typeof monitorConfigSchema>;
export type HttpMonitorConfig = z.infer<typeof httpMonitorConfigSchema>;
export type PushMonitorConfig = z.infer<typeof pushMonitorConfigSchema>;
export type HttpExtractor = z.infer<typeof extractorSchema>;
export type MonitorInput = z.infer<typeof monitorInputSchema>;
export type RuleInput = z.infer<typeof ruleInputSchema>;
export type SubscriptionInput = z.infer<typeof subscriptionInputSchema>;
export type EmailChannelConfig = z.infer<typeof emailChannelConfigSchema>;
export type WebhookChannelConfig = z.infer<typeof webhookChannelConfigSchema>;
export type ChannelInput = z.infer<typeof channelInputSchema>;
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;

export interface MetricValue {
  value: number | string | boolean;
  label?: string;
  unit?: string;
}

export interface RuleDto {
  id: string;
  metricKey: string;
  label: string;
  unit: string;
  operator: Operator;
  warningValue: number | null;
  criticalValue: number | null;
  durationChecks: number;
  cooldownSeconds: number;
  repeatIntervalSeconds: number;
  recoveryOperator: Operator | null;
  recoveryValue: number | null;
  recoveryChecks: number;
  enabled: boolean;
}

export interface MonitorDto {
  id: string;
  name: string;
  description: string;
  type: MonitorType;
  config: MonitorConfig;
  intervalSeconds: number;
  failureThreshold: number;
  staleAfterSeconds: number;
  channelIds: string[];
  tags: string[];
  enabled: boolean;
  lastStatus: MonitorStatus;
  lastMetrics: Record<string, MetricValue>;
  lastCheckedAt: string | null;
  lastError: string | null;
  nextRunAt: string | null;
  consecutiveFailures: number;
  pushTokenPrefix: string | null;
  rules: RuleDto[];
  createdAt: string;
  updatedAt: string;
}

export interface MonitorRunDto {
  id: string;
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

export interface RuleEvaluationDto {
  ruleId: string;
  metricKey: string;
  level: 'ok' | 'warning' | 'critical';
  value: number | string | boolean | null;
  message?: string;
}

export interface MonitorTestResult {
  ok: boolean;
  status: MonitorStatus;
  httpStatus?: number | null;
  durationMs: number;
  metrics: Record<string, MetricValue>;
  rawBody?: unknown;
  rawText?: string;
  error?: string;
  evaluations: RuleEvaluationDto[];
  logs: string[];
}

export interface RenewalDto {
  id: string;
  subscriptionId: string;
  fromDate: string;
  toDate: string;
  createdAt: string;
}

/**
 * A simple reminder / subscription record. The single built-in template means
 * there are no custom template fields here: name, optional link, expiry date
 * and time (to the minute), a renewal cycle, reminder offsets and channels.
 */
export interface SubscriptionDto {
  id: string;
  name: string;
  url: string | null;
  expiryDate: string;
  /** `HH:mm` wall-clock expiry time in the instance timezone. */
  expiryTime: string;
  cycle: Cycle;
  reminderOffsets: number[];
  channelIds: string[];
  notes: string;
  paused: boolean;
  status: SubscriptionStatus;
  daysLeft: number;
  renewals?: RenewalDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ChannelDto {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDto {
  id: string;
  eventType: NotificationEventType;
  eventKey: string;
  channelId: string | null;
  channelName: string | null;
  status: NotificationStatus;
  attempts: number;
  lastError: string | null;
  payload: unknown;
  createdAt: string;
  sentAt: string | null;
}

export interface MaskedSmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  rejectUnauthorized: boolean;
  user: string;
  from: string;
  fromName: string;
  to: string[];
  passwordSet: boolean;
}

export interface SettingsDto {
  general: GeneralSettings;
  smtp: MaskedSmtpSettings | null;
  version: string;
  timezone: string;
}

export interface AuthStatusDto {
  setupRequired: boolean;
  authenticated: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface AppMeta {
  version: string;
  locale: Locale;
  timezone: string;
  appName: string;
  baseUrl: string;
}
