import { randomUUID } from 'node:crypto';
import {
  daysBetween,
  formatExpiry,
  isExpiredAt,
  reminderScheduledFor,
  todayInZone,
  type GeneralSettings,
  type NotificationEventType,
} from '@subwatch/shared';
import type { ModuleContext } from '../context.js';
import { all, nowIso, run, withTransaction } from '../db/helpers.js';
import { BadRequestError } from '../lib/errors.js';
import { parseChannelIds, parseReminderOffsets } from './parse.js';
import { resolveEffectiveOffsets, type SubscriptionReminderState } from './status.js';

export const REMINDER_SCAN_INTERVAL_MS = 30_000;

interface ReminderStateRow {
  id: string;
  expiry_date: string;
  expiry_time: string;
  reminder_offsets: string;
  paused: number;
}

interface DueReminderRow {
  reminder_id: string;
  subscription_id: string;
  expiry_date: string;
  expiry_time: string;
  offset_days: number;
  scheduled_for: string;
  name: string;
  channel_ids: string;
  paused: number;
}

interface ReminderSchedule {
  offsetDays: number;
  scheduledFor: string;
}

/** Absolute UTC schedule for every offset of one subscription expiry. */
export function computeReminderSchedules(
  offsets: number[],
  expiryDate: string,
  general: GeneralSettings,
): ReminderSchedule[] {
  return offsets
    .map((offsetDays) => ({
      offsetDays,
      scheduledFor: reminderScheduledFor({
        expiryDate,
        offsetDays,
        reminderTime: general.reminderTime,
        timezone: general.timezone,
      }),
    }))
    .filter((schedule) => Number.isFinite(Date.parse(schedule.scheduledFor)));
}

function insertScheduleRows(
  db: ModuleContext['db'],
  general: GeneralSettings,
  state: SubscriptionReminderState,
): void {
  if (state.paused) return;
  const offsets = resolveEffectiveOffsets(state.reminderOffsets, general);
  if (offsets.length === 0) return;
  let schedules: ReminderSchedule[];
  try {
    schedules = computeReminderSchedules(offsets, state.expiryDate, general);
  } catch (error) {
    throw new BadRequestError(
      `Unable to schedule reminders: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const schedule of schedules) {
    run(
      db,
      `INSERT INTO subscription_reminders (id, subscription_id, expiry_date, offset_days, scheduled_for, status)
       VALUES (?, ?, ?, ?, ?, 'pending')
       ON CONFLICT(subscription_id, expiry_date, offset_days) DO NOTHING`,
      [
        randomUUID(),
        state.subscriptionId,
        state.expiryDate,
        schedule.offsetDays,
        schedule.scheduledFor,
      ],
    );
  }
}

/**
 * Drop pending rows for one subscription and regenerate the absolute schedule
 * for its current expiry. Already sent/suppressed rows are kept as history, so
 * the unique key prevents re-notifying an offset that already fired. Callers are
 * expected to run inside a transaction when they change the subscription row.
 */
export function rebuildPendingReminders(
  db: ModuleContext['db'],
  general: GeneralSettings,
  state: SubscriptionReminderState,
): void {
  run(db, "DELETE FROM subscription_reminders WHERE subscription_id = ? AND status = 'pending'", [
    state.subscriptionId,
  ]);
  insertScheduleRows(db, general, state);
}

/** Rebuild pending schedules for every subscription (settings changed). */
export function rebuildAllPendingReminders(ctx: ModuleContext): void {
  const general = ctx.settings.getGeneral();
  withTransaction(ctx.db, () => {
    run(ctx.db, "DELETE FROM subscription_reminders WHERE status = 'pending'");
    const rows = all<ReminderStateRow>(
      ctx.db,
      'SELECT id, expiry_date, expiry_time, reminder_offsets, paused FROM subscriptions',
    );
    for (const row of rows) {
      insertScheduleRows(ctx.db, general, {
        subscriptionId: row.id,
        expiryDate: row.expiry_date,
        expiryTime: row.expiry_time,
        reminderOffsets: parseReminderOffsets(row.reminder_offsets),
        paused: Number(row.paused) === 1,
      });
    }
  });
}

function appUrlFor(ctx: ModuleContext, subscriptionId: string): string {
  return `${ctx.settings.getBaseUrl()}/subscriptions/${subscriptionId}`;
}

function buildReminderCopy(
  general: GeneralSettings,
  name: string,
  expiryDate: string,
  expiryTime: string,
  daysRemaining: number,
  expired: boolean,
): { title: string; message: string } {
  const expiry = formatExpiry(expiryDate, expiryTime);
  if (general.locale === 'en') {
    if (expired) {
      const overdue = -daysRemaining;
      return {
        title: `Subscription expired: ${name}`,
        message:
          overdue > 0
            ? `Expired at ${expiry} (${overdue} day(s) ago)`
            : `Expired at ${expiry}`,
      };
    }
    if (daysRemaining === 0) {
      return { title: `Subscription expires today: ${name}`, message: `Expires today (${expiry})` };
    }
    return {
      title: `Subscription expiring soon: ${name}`,
      message: `${daysRemaining} day(s) left until ${expiry}`,
    };
  }
  if (expired) {
    const overdue = -daysRemaining;
    return {
      title: `订阅已过期：${name}`,
      message: overdue > 0 ? `已于 ${expiry} 到期（已过期 ${overdue} 天）` : `已于 ${expiry} 到期`,
    };
  }
  if (daysRemaining === 0) {
    return { title: `订阅今天到期：${name}`, message: `今天到期（${expiry}）` };
  }
  return {
    title: `订阅即将到期：${name}`,
    message: `还有 ${daysRemaining} 天到期（${expiry}）`,
  };
}

/**
 * Send one reminder per (subscription, expiry) group for all rows that are due.
 * The most urgent offset (smallest remaining days) wins; less urgent due rows
 * are marked `suppressed` so a long outage does not fan out into a notification
 * storm. Paused subscriptions have their pending rows dropped.
 */
export function scanDueReminders(ctx: ModuleContext): void {
  const general = ctx.settings.getGeneral();
  const today = todayInZone(general.timezone);
  const now = nowIso();
  const rows = all<DueReminderRow>(
    ctx.db,
    `SELECT r.id AS reminder_id, r.subscription_id, r.expiry_date, r.offset_days, r.scheduled_for,
            s.expiry_time, s.name, s.channel_ids, s.paused
       FROM subscription_reminders r
       JOIN subscriptions s ON s.id = r.subscription_id
      WHERE r.status = 'pending' AND r.scheduled_for <= ?
      ORDER BY r.subscription_id ASC, r.expiry_date ASC, r.offset_days ASC`,
    [now],
  );
  if (rows.length === 0) return;

  const groups = new Map<string, DueReminderRow[]>();
  for (const row of rows) {
    const key = `${row.subscription_id}\u0000${row.expiry_date}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  for (const group of groups.values()) {
    const chosen = group[0];
    if (!chosen) continue;
    if (Number(chosen.paused) === 1) {
      run(ctx.db, "DELETE FROM subscription_reminders WHERE subscription_id = ? AND status = 'pending'", [
        chosen.subscription_id,
      ]);
      continue;
    }

    const expired = isExpiredAt(chosen.expiry_date, chosen.expiry_time, general.timezone);
    const daysRemaining = daysBetween(today, chosen.expiry_date);
    const eventType: NotificationEventType = expired ? 'subscription.expired' : 'subscription.expiring';
    const copy = buildReminderCopy(
      general,
      chosen.name,
      chosen.expiry_date,
      chosen.expiry_time,
      daysRemaining,
      expired,
    );
    const payload = {
      title: copy.title,
      message: copy.message,
      severity: expired ? ('critical' as const) : ('warning' as const),
      data: {
        subscriptionId: chosen.subscription_id,
        expiryDate: chosen.expiry_date,
        expiryTime: chosen.expiry_time,
        daysLeft: daysRemaining,
        offsetDays: chosen.offset_days,
      },
      appUrl: appUrlFor(ctx, chosen.subscription_id),
    };

    try {
      ctx.notifications.enqueue({
        eventType,
        eventKey: `sub-reminder:${chosen.subscription_id}:${chosen.expiry_date}:${chosen.offset_days}`,
        channelIds: parseChannelIds(chosen.channel_ids),
        payload,
        subscriptionId: chosen.subscription_id,
      });
    } catch (error) {
      ctx.logger.error(
        { err: error, subscriptionId: chosen.subscription_id, expiryDate: chosen.expiry_date },
        'failed to enqueue subscription reminder; will retry',
      );
      continue;
    }

    const sentAt = nowIso();
    run(ctx.db, "UPDATE subscription_reminders SET status = 'sent', sent_at = ? WHERE id = ?", [
      sentAt,
      chosen.reminder_id,
    ]);
    for (const duplicate of group.slice(1)) {
      run(ctx.db, "UPDATE subscription_reminders SET status = 'suppressed' WHERE id = ?", [
        duplicate.reminder_id,
      ]);
    }
    ctx.logger.info(
      {
        subscriptionId: chosen.subscription_id,
        expiryDate: chosen.expiry_date,
        offsetDays: chosen.offset_days,
        suppressed: group.length - 1,
        eventType,
      },
      'subscription reminder enqueued',
    );
  }
}

/** Notification for the explicit "test reminder" admin action. */
export function enqueueTestReminder(ctx: ModuleContext, subscription: {
  id: string;
  name: string;
  expiryDate: string;
  expiryTime: string;
  channelIds: string[];
}): void {
  const general = ctx.settings.getGeneral();
  const expired = isExpiredAt(subscription.expiryDate, subscription.expiryTime, general.timezone);
  const daysRemaining = daysBetween(todayInZone(general.timezone), subscription.expiryDate);
  const copy = buildReminderCopy(
    general,
    subscription.name,
    subscription.expiryDate,
    subscription.expiryTime,
    daysRemaining,
    expired,
  );
  ctx.notifications.enqueue({
    eventType: 'subscription.test',
    eventKey: `sub-test:${subscription.id}:${Date.now()}:${randomUUID().slice(0, 8)}`,
    channelIds: subscription.channelIds,
    payload: {
      title: general.locale === 'en' ? `Test reminder: ${subscription.name}` : `测试提醒：${subscription.name}`,
      message: copy.message,
      severity: 'info',
      data: {
        subscriptionId: subscription.id,
        expiryDate: subscription.expiryDate,
        expiryTime: subscription.expiryTime,
        daysLeft: daysRemaining,
      },
      appUrl: appUrlFor(ctx, subscription.id),
    },
    subscriptionId: subscription.id,
  });
}

/** Renewal confirmation notification (subscription.renewed). */
export function enqueueRenewedNotification(
  ctx: ModuleContext,
  input: {
    subscriptionId: string;
    name: string;
    fromDate: string;
    toDate: string;
    channelIds: string[];
  },
): void {
  const general = ctx.settings.getGeneral();
  const title = general.locale === 'en' ? `Subscription renewed: ${input.name}` : `订阅已续期：${input.name}`;
  const message =
    general.locale === 'en'
      ? `Renewed from ${input.fromDate} to ${input.toDate}`
      : `已从 ${input.fromDate} 续期至 ${input.toDate}`;
  ctx.notifications.enqueue({
    eventType: 'subscription.renewed',
    eventKey: `sub-renewed:${input.subscriptionId}:${input.toDate}`,
    channelIds: input.channelIds,
    payload: {
      title,
      message,
      severity: 'success',
      data: {
        subscriptionId: input.subscriptionId,
        fromDate: input.fromDate,
        toDate: input.toDate,
        expiryDate: input.toDate,
      },
      appUrl: appUrlFor(ctx, input.subscriptionId),
    },
    subscriptionId: input.subscriptionId,
  });
}
