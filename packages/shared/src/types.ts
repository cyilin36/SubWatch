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
  TemplateKind,
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
import type { TemplateField } from './templates.js';

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
  templateId: string | null;
  templateName: string | null;
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
  /** Template the subscription was created from, if any. */
  templateId: string | null;
  /** Snapshot of the template name so the UI still works after the template is deleted. */
  templateName: string | null;
  /** Snapshot of the template field definitions used by this subscription. */
  fieldDefs: TemplateField[];
  /** Values for `fieldDefs`; secret values are masked with SECRET_KEEP. */
  fields: Record<string, unknown>;
  renewals?: RenewalDto[];
  createdAt: string;
  updatedAt: string;
}

/** Lightweight template row used by lists and pickers. */
export interface TemplateSummaryDto {
  id: string;
  kind: TemplateKind;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  /** Author-declared template version, or empty string. */
  version: string;
  fieldCount: number;
  /** Number of subscriptions/monitors currently referencing this template. */
  usageCount: number;
  /** Git repository URL this template was imported from, or `null` for manual templates. */
  sourceUrl: string | null;
  /** Short repository label (e.g. `owner/repo`) for display, or `null`. */
  sourceLabel: string | null;
  updatedAt: string;
}

/** Full template including its field definitions and payload. */
export interface TemplateDto {
  id: string;
  kind: TemplateKind;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  /** Author-declared template version, or empty string. */
  version: string;
  fields: TemplateField[];
  payload: Record<string, unknown>;
  /** Git repository URL this template was imported from, or `null`. */
  sourceUrl: string | null;
  /** Git branch the template was imported from (empty string = default branch). */
  sourceBranch: string;
  /** Path of the template file inside the source repository. */
  sourcePath: string | null;
  /** Git commit the template was last imported/updated from. */
  sourceRevision: string | null;
  /** Short repository label (e.g. `owner/repo`) for display. */
  sourceLabel: string | null;
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
