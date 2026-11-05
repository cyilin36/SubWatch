import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { DateTime, Duration } from 'luxon';
import type { MetricValue, MonitorStatus, NotificationStatus, SubscriptionStatus } from '@subwatch/shared';
import { ApiError } from './api';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const INTL_LOCALES: Record<string, string> = {
  'zh-CN': 'zh-CN',
  en: 'en-US',
};

export function intlLocale(locale: string): string {
  return INTL_LOCALES[locale] ?? 'en-US';
}

/** Format an integer amount of cents with the given ISO-4217 currency. */
export function formatMoney(
  cents: number | null | undefined,
  currency: string,
  locale: string,
): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Parse a user-entered money amount (major units) into integer cents. */
export function parseMoneyToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function formatCentsInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

export function formatDateTime(
  iso: string | null | undefined,
  timezone: string,
  locale: string,
): string {
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso, { zone: timezone }).setLocale(intlLocale(locale));
  if (!dt.isValid) return iso;
  return dt.toFormat('yyyy-LL-dd HH:mm');
}

export function formatDateOnly(date: string | null | undefined): string {
  return date ? date : '—';
}

export function formatRelativeTime(
  iso: string | null | undefined,
  timezone: string,
  locale: string,
): string {
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso, { zone: timezone });
  if (!dt.isValid) return formatDateTime(iso, timezone, locale);
  return dt.toRelative({ base: DateTime.now(), locale: intlLocale(locale) }) ?? formatDateTime(iso, timezone, locale);
}

export function formatDurationSeconds(seconds: number | null | undefined, locale: string): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const duration = Duration.fromObject({ seconds: Math.round(seconds) }, { locale: intlLocale(locale) })
    .shiftTo('days', 'hours', 'minutes')
    .normalize()
    .toHuman({ unitDisplay: 'short' });
  return duration;
}

export function formatInterval(seconds: number, locale: string): string {
  return formatDurationSeconds(seconds, locale);
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Today's date (YYYY-MM-DD) in an IANA timezone. */
export function todayInZone(timezone: string): string {
  const now = DateTime.now().setZone(timezone);
  if (!now.isValid) return DateTime.now().toISODate() as string;
  return now.toISODate() as string;
}

/** Add calendar months to a date-only string, clamping to the end of month. */
export function addMonthsToDate(dateOnly: string, months: number): string {
  const dt = DateTime.fromISO(dateOnly, { zone: 'utc' });
  if (!dt.isValid) return dateOnly;
  return dt.plus({ months }).toISODate() as string;
}

export function daysBetweenDates(from: string, to: string): number {
  const start = DateTime.fromISO(from, { zone: 'utc' });
  const end = DateTime.fromISO(to, { zone: 'utc' });
  if (!start.isValid || !end.isValid) return 0;
  return Math.round(end.diff(start, 'days').days);
}

export function formatMetricValue(
  value: MetricValue | number | string | boolean | null | undefined,
): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    const unit = value.unit ? ` ${value.unit}` : '';
    if (typeof value.value === 'boolean') return `${value.value ? 'true' : 'false'}${unit}`;
    if (typeof value.value === 'number') {
      const rounded = Number.isInteger(value.value) ? value.value : Number(value.value.toFixed(2));
      return `${rounded}${unit}`;
    }
    return `${value.value}${unit}`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'neutral';

const STATUS_TONES: Record<string, Tone> = {
  up: 'success',
  active: 'success',
  sent: 'success',
  recovered: 'success',
  warning: 'warning',
  expiring: 'warning',
  pending: 'warning',
  critical: 'danger',
  down: 'danger',
  expired: 'danger',
  failed: 'danger',
  unknown: 'muted',
  skipped_no_channel: 'muted',
  paused: 'info',
  archived: 'muted',
};

export function statusTone(status: MonitorStatus | SubscriptionStatus | NotificationStatus | string): Tone {
  return STATUS_TONES[status] ?? 'neutral';
}

export function severityTone(severity: string | null | undefined): Tone {
  switch (severity) {
    case 'critical':
    case 'danger':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'success':
      return 'success';
    default:
      return 'info';
  }
}

export function truncate(value: string, max = 120): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Normalize list endpoints that may return `T[]` or a paginated envelope. */
export function normalizeList<T>(
  value: T[] | { items?: T[]; points?: T[] } | null | undefined,
): T[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.points)) return value.points;
  return [];
}

/** Human-friendly error text for an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // Surface the backend error code alongside the human readable message so the
    // UI can distinguish e.g. validation_error / conflict / unauthorized.
    const hasCode = error.code && error.code !== `http_${error.status}` && error.code !== 'network_error';
    return hasCode ? `${error.message} (${error.code})` : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Translate the most common zod validation messages coming from shared schemas. */
export function localizeFieldError(message: string | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!message) return '';
  // i18n keys passed directly as zod messages (e.g. 'auth.passwordMismatch').
  const translated = t(message);
  if (translated !== message) return translated;
  const exact: Record<string, string> = {
    Required: 'validation.required',
    'Invalid url': 'validation.invalidUrl',
    'Expected a valid YYYY-MM-DD date': 'validation.invalidDate',
    'At least one warning or critical threshold is required': 'validation.thresholdRequired',
    'Critical threshold must be more severe than the warning threshold': 'validation.thresholdOrder',
    'expiryDate must be after startDate': 'validation.expiryAfterStart',
    'Custom day cycles require cycleDays': 'validation.cycleDaysRequired',
    'Custom renewal mode requires a date': 'validation.renewDateRequired',
    'Password must be at least 8 characters': 'validation.passwordTooShort',
    'Expected ISO-4217 currency code': 'validation.invalidCurrency',
    'Field key must start with a letter or underscore': 'validation.fieldKey',
    'Metric key must start with a letter or underscore': 'validation.metricKey',
    'Select fields require at least one option': 'validation.selectOptionsRequired',
    'Expected HH:mm': 'validation.invalidTime',
    'baseUrl must be empty or start with http(s)://': 'validation.invalidBaseUrl',
    'Recovery condition must be set together with recovery value': 'validation.recoveryTogether',
    'recoveryOperator and recoveryValue must be set together': 'validation.recoveryTogether',
    'String must contain at least 1 character(s)': 'validation.required',
    'Invalid email': 'validation.invalidEmail',
    'Number must be greater than or equal to 1000': 'validation.numberTooSmall',
  };
  if (exact[message]) return t(exact[message]);
  const duplicate = /^Duplicate field key: (.+)$/.exec(message);
  if (duplicate) return t('validation.duplicateFieldKey', { key: duplicate[1] });
  const minString = /^String must contain at least (\d+) character\(s\)$/.exec(message);
  if (minString) return t('validation.minLength', { count: minString[1] });
  const minNumber = /^Number must be greater than or equal to (.+)$/.exec(message);
  if (minNumber) return t('validation.numberMin', { value: minNumber[1] });
  const maxNumber = /^Number must be less than or equal to (.+)$/.exec(message);
  if (maxNumber) return t('validation.numberMax', { value: maxNumber[1] });
  return message;
}

/** Option helper for selects. */
export interface SelectOption {
  value: string;
  label: string;
}
