import { DateTime } from 'luxon';
import type { Cycle } from './constants.js';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True when `value` is a real calendar date in `YYYY-MM-DD` form. */
export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const dt = DateTime.fromISO(value, { zone: 'utc' });
  return dt.isValid && dt.toISODate() === value;
}

/** True when `value` is a 24h wall-clock time in `HH:mm` form. */
export function isTimeOfDay(value: string): boolean {
  return TIME_OF_DAY_RE.test(value);
}

function utcDate(value: string): DateTime {
  const dt = DateTime.fromISO(value, { zone: 'utc' });
  if (!dt.isValid) throw new Error(`Invalid date: ${value}`);
  return dt;
}

/** Today's calendar date in the given IANA timezone. */
export function todayInZone(timezone: string): string {
  const now = DateTime.now().setZone(timezone);
  if (!now.isValid) throw new Error(`Invalid timezone: ${timezone}`);
  return now.toISODate() as string;
}

export function addDays(date: string, days: number): string {
  return utcDate(date).plus({ days }).toISODate() as string;
}

export function daysBetween(from: string, to: string): number {
  return Math.round(utcDate(to).diff(utcDate(from), 'days').days);
}

/**
 * Add a subscription cycle to a date-only value. Calendar months clamp to the
 * end of the target month (2026-01-31 + 1 month => 2026-02-28, leap-aware).
 */
export function addCycle(date: string, cycle: Cycle): string {
  const base = utcDate(date);
  let next: DateTime;
  switch (cycle) {
    case 'day':
      next = base.plus({ days: 1 });
      break;
    case 'week':
      next = base.plus({ weeks: 1 });
      break;
    case 'month':
      next = base.plus({ months: 1 });
      break;
    case 'quarter':
      next = base.plus({ months: 3 });
      break;
    case 'year':
      next = base.plus({ years: 1 });
      break;
    default:
      next = base.plus({ months: 1 });
  }
  return next.toISODate() as string;
}

/** Whole days from today until expiry; negative when already expired. */
export function daysLeft(expiryDate: string, timezone: string): number {
  return daysBetween(todayInZone(timezone), expiryDate);
}

export interface ReminderScheduleInput {
  expiryDate: string;
  offsetDays: number;
  reminderTime: string;
  timezone: string;
}

/**
 * Absolute UTC timestamp for "reminderTime" on (expiryDate - offsetDays) in
 * the configured timezone. Subscription dates are date-only, so this is the
 * only place a local wall-clock time is attached.
 */
export function reminderScheduledFor(input: ReminderScheduleInput): string {
  const { expiryDate, offsetDays, reminderTime, timezone } = input;
  const [hourRaw, minuteRaw] = reminderTime.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid reminder time: ${reminderTime}`);
  }
  const localDate = addDays(expiryDate, -offsetDays);
  const local = DateTime.fromISO(localDate, { zone: timezone }).set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });
  if (!local.isValid) {
    throw new Error(`Invalid reminder schedule: ${local.invalidExplanation ?? 'unknown error'}`);
  }
  return local.toUTC().toISO() as string;
}

/** Format an ISO timestamp in a target timezone, fallback to raw input. */
export function formatDateTime(iso: string, timezone: string, locale: string): string {
  const dt = DateTime.fromISO(iso, { zone: timezone });
  if (!dt.isValid) return iso;
  return dt.setLocale(locale === 'zh-CN' ? 'zh-CN' : 'en-US').toFormat('yyyy-LL-dd HH:mm');
}

/** Format a date-only value; keeps the value unambiguous for both locales. */
export function formatDateOnly(date: string): string {
  return isDateOnly(date) ? date : String(date);
}

/** Human-facing expiry label, e.g. `2027-01-09 18:30`. */
export function formatExpiry(expiryDate: string, expiryTime: string): string {
  return `${expiryDate} ${expiryTime}`;
}

/**
 * Wall-clock instant of a subscription expiry (date + HH:mm) in the given
 * timezone. Expiry times are stored as local wall-clock values on purpose, so
 * the same date+time means the same local moment regardless of DST arithmetic.
 */
export function expiryInstant(expiryDate: string, expiryTime: string, timezone: string): DateTime {
  if (!isTimeOfDay(expiryTime)) throw new Error(`Invalid expiry time: ${expiryTime}`);
  const local = DateTime.fromISO(`${expiryDate}T${expiryTime}`, { zone: timezone });
  if (!local.isValid) throw new Error(`Invalid expiry: ${expiryDate} ${expiryTime}`);
  return local;
}

/** True once the local expiry instant (in the app timezone) has been reached. */
export function isExpiredAt(expiryDate: string, expiryTime: string, timezone: string): boolean {
  return DateTime.now().setZone(timezone) >= expiryInstant(expiryDate, expiryTime, timezone);
}

/** Last N calendar dates (oldest first) ending today in the given timezone. */
export function recentDates(timezone: string, count: number): string[] {
  const today = todayInZone(timezone);
  return Array.from({ length: count }, (_, index) => addDays(today, index - (count - 1)));
}
