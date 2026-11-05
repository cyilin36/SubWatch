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
  templateFieldSchema,
  templateInputSchema,
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
export type TemplateField = z.infer<typeof templateFieldSchema>;
export type TemplateInput = z.infer<typeof templateInputSchema>;
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

export interface TemplateDto {
  id: string;
  builtinKey: string | null;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  fields: TemplateField[];
  defaultCycle: Cycle;
  defaultCycleDays: number | null;
  defaultAmountCents: number | null;
  defaultCurrency: string;
  defaultReminderOffsets: number[];
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RenewalDto {
  id: string;
  subscriptionId: string;
  fromDate: string;
  toDate: string;
  amountCents: number | null;
  currency: string | null;
  note: string;
  createdAt: string;
}

export interface SubscriptionDto {
  id: string;
  templateId: string | null;
  templateName: string | null;
  name: string;
  fields: Record<string, unknown>;
  startDate: string;
  expiryDate: string;
  cycle: Cycle;
  cycleDays: number | null;
  amountCents: number | null;
  currency: string;
  reminderOffsets: number[];
  channelIds: string[];
  linkedMonitorIds: string[];
  notes: string;
  paused: boolean;
  archived: boolean;
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

export interface DashboardAlert {
  monitorId: string;
  monitorName: string;
  metricKey: string | null;
  metricLabel: string | null;
  severity: 'warning' | 'critical';
  value: number | string | boolean | null;
  since: string;
}

export interface DashboardExpiring {
  id: string;
  name: string;
  templateName: string | null;
  expiryDate: string;
  daysLeft: number;
  amountCents: number | null;
  currency: string;
}

export interface DashboardMonitorCard {
  id: string;
  name: string;
  status: MonitorStatus;
  metrics: Record<string, MetricValue>;
  lastCheckedAt: string | null;
}

export interface DashboardDto {
  monitors: {
    total: number;
    up: number;
    warning: number;
    critical: number;
    down: number;
    unknown: number;
    paused: number;
  };
  subscriptions: {
    total: number;
    active: number;
    expiring: number;
    expired: number;
    monthlyCostCents: number;
    currency: string;
  };
  alerts: DashboardAlert[];
  expiring: DashboardExpiring[];
  recentNotifications: NotificationDto[];
  monitorCards: DashboardMonitorCard[];
}

export interface AppMeta {
  version: string;
  locale: Locale;
  timezone: string;
  appName: string;
  baseUrl: string;
}
