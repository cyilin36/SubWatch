export const APP_VERSION = '0.1.0';

/**
 * Sentinel submitted by the UI when an already-stored secret must be kept
 * unchanged. The server replaces it with the previously stored value.
 */
export const SECRET_KEEP = '__SUBWATCH_KEEP__';

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';
export const DEFAULT_REMINDER_TIME = '09:00';
export const DEFAULT_REMINDER_OFFSETS: readonly number[] = [7, 3, 1, 0];
export const DEFAULT_LOCALE = 'zh-CN';
export const DEFAULT_CURRENCY = 'CNY';
export const DEFAULT_LOCALE_VALUES = ['zh-CN', 'en'] as const;
export type Locale = (typeof DEFAULT_LOCALE_VALUES)[number];

export const COOKIE_NAME = 'subwatch_session';
export const SESSION_TTL_DAYS = 7;

export const CYCLE_VALUES = ['day', 'week', 'month', 'quarter', 'year', 'custom_days'] as const;
export type Cycle = (typeof CYCLE_VALUES)[number];

export const OPERATOR_VALUES = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] as const;
export type Operator = (typeof OPERATOR_VALUES)[number];

export const MONITOR_TYPE_VALUES = ['http', 'push'] as const;
export type MonitorType = (typeof MONITOR_TYPE_VALUES)[number];

export const MONITOR_STATUS_VALUES = ['unknown', 'up', 'warning', 'critical', 'down', 'paused'] as const;
export type MonitorStatus = (typeof MONITOR_STATUS_VALUES)[number];

export const SUBSCRIPTION_STATUS_VALUES = ['active', 'expiring', 'expired', 'paused', 'archived'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS_VALUES)[number];

export const RUN_TRIGGER_VALUES = ['schedule', 'manual', 'test', 'push'] as const;
export type RunTrigger = (typeof RUN_TRIGGER_VALUES)[number];

export const FIELD_TYPE_VALUES = [
  'text',
  'textarea',
  'number',
  'date',
  'url',
  'select',
  'switch',
  'secret',
] as const;
export type FieldType = (typeof FIELD_TYPE_VALUES)[number];

export const THEME_VALUES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEME_VALUES)[number];

export const CHANNEL_TYPE_VALUES = ['email', 'webhook'] as const;
export type ChannelType = (typeof CHANNEL_TYPE_VALUES)[number];

export const NOTIFICATION_STATUS_VALUES = ['pending', 'sent', 'failed', 'skipped_no_channel'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUS_VALUES)[number];

export const EVENT_TYPES = [
  'monitor.firing',
  'monitor.resolved',
  'monitor.down',
  'monitor.recovered',
  'monitor.test',
  'subscription.expiring',
  'subscription.expired',
  'subscription.renewed',
  'subscription.test',
  'channel.test',
] as const;
export type NotificationEventType = (typeof EVENT_TYPES)[number];

export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
export const MAX_JS_CODE_BYTES = 20_000;
export const JS_EVAL_TIMEOUT_MS = 1_000;

export const DEFAULT_MONITOR_INTERVAL_SECONDS = 300;
export const MIN_MONITOR_INTERVAL_SECONDS = 30;

export const DEFAULT_TEMPLATE_FIELDS = [] as const;
