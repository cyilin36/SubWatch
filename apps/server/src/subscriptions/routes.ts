import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  addCycle,
  renewInputSchema,
  subscriptionInputSchema,
  todayInZone,
  type Cycle,
  type SubscriptionDto,
} from '@subwatch/shared';
import type { ModuleContext } from '../context.js';
import { createRequireAuth } from '../auth/guard.js';
import { nowIso, run, toJson, withTransaction } from '../db/helpers.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { parseChannelIds, parseReminderOffsets } from './parse.js';
import {
  deleteSubscription,
  getSubscriptionRow,
  listRenewals,
  listSubscriptions,
  mapSubscriptionRow,
  type SubscriptionRow,
} from './repository.js';
import {
  enqueueRenewedNotification,
  enqueueTestReminder,
  rebuildPendingReminders,
} from './reminders.js';
import type { SubscriptionReminderState } from './status.js';

const SUBSCRIPTION_COLUMNS = `id, name, url, expiry_date, expiry_time, cycle, reminder_offsets,
  channel_ids, notes, paused, created_at, updated_at`;

function requireSubscriptionRow(ctx: ModuleContext, id: string): SubscriptionRow {
  const row = getSubscriptionRow(ctx, id);
  if (!row) throw new NotFoundError('Subscription not found');
  return row;
}

/** Empty URL input is stored as NULL so the DTO exposes `url: null`. */
function storedUrl(url: string): string | null {
  return url.trim() === '' ? null : url;
}

function reminderStateFor(row: SubscriptionRow): SubscriptionReminderState {
  return {
    subscriptionId: row.id,
    expiryDate: row.expiry_date,
    expiryTime: row.expiry_time,
    reminderOffsets: parseReminderOffsets(row.reminder_offsets),
    paused: Number(row.paused) === 1,
  };
}

function channelIdsFor(row: SubscriptionRow): string[] {
  return parseChannelIds(row.channel_ids);
}

/** Detail-shaped response: always carries the renewal history. */
function toSubscriptionDto(ctx: ModuleContext, row: SubscriptionRow): SubscriptionDto {
  return mapSubscriptionRow(ctx, row, listRenewals(ctx, row.id));
}

export function registerSubscriptionRoutes(app: FastifyInstance, ctx: ModuleContext): void {
  const requireAuth = createRequireAuth(ctx);

  app.get('/api/subscriptions', { preHandler: requireAuth }, async (request): Promise<SubscriptionDto[]> => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return listSubscriptions(ctx, { search: query.search || undefined });
  });

  app.get('/api/subscriptions/:id', { preHandler: requireAuth }, async (request): Promise<SubscriptionDto> => {
    const { id } = request.params as { id: string };
    return toSubscriptionDto(ctx, requireSubscriptionRow(ctx, id));
  });

  app.post('/api/subscriptions', { preHandler: requireAuth }, async (request, reply): Promise<SubscriptionDto> => {
    const body = subscriptionInputSchema.parse(request.body ?? {});
    const id = randomUUID();
    const now = nowIso();
    const general = ctx.settings.getGeneral();
    withTransaction(ctx.db, () => {
      run(
        ctx.db,
        `INSERT INTO subscriptions (${SUBSCRIPTION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          body.name,
          storedUrl(body.url),
          body.expiryDate,
          body.expiryTime,
          body.cycle,
          toJson(body.reminderOffsets),
          toJson(body.channelIds),
          body.notes,
          body.paused ? 1 : 0,
          now,
          now,
        ],
      );
      rebuildPendingReminders(ctx.db, general, {
        subscriptionId: id,
        expiryDate: body.expiryDate,
        expiryTime: body.expiryTime,
        reminderOffsets: body.reminderOffsets,
        paused: body.paused,
      });
    });
    reply.code(201);
    return toSubscriptionDto(ctx, requireSubscriptionRow(ctx, id));
  });

  app.put('/api/subscriptions/:id', { preHandler: requireAuth }, async (request): Promise<SubscriptionDto> => {
    const { id } = request.params as { id: string };
    requireSubscriptionRow(ctx, id);
    const body = subscriptionInputSchema.parse(request.body ?? {});
    const now = nowIso();
    const general = ctx.settings.getGeneral();
    withTransaction(ctx.db, () => {
      run(
        ctx.db,
        `UPDATE subscriptions SET
           name = ?, url = ?, expiry_date = ?, expiry_time = ?, cycle = ?, reminder_offsets = ?,
           channel_ids = ?, notes = ?, paused = ?, updated_at = ?
         WHERE id = ?`,
        [
          body.name,
          storedUrl(body.url),
          body.expiryDate,
          body.expiryTime,
          body.cycle,
          toJson(body.reminderOffsets),
          toJson(body.channelIds),
          body.notes,
          body.paused ? 1 : 0,
          now,
          id,
        ],
      );
      rebuildPendingReminders(ctx.db, general, {
        subscriptionId: id,
        expiryDate: body.expiryDate,
        expiryTime: body.expiryTime,
        reminderOffsets: body.reminderOffsets,
        paused: body.paused,
      });
    });
    return toSubscriptionDto(ctx, requireSubscriptionRow(ctx, id));
  });

  app.delete('/api/subscriptions/:id', { preHandler: requireAuth }, async (request): Promise<{ ok: true }> => {
    const { id } = request.params as { id: string };
    requireSubscriptionRow(ctx, id);
    deleteSubscription(ctx, id);
    return { ok: true };
  });

  app.post('/api/subscriptions/:id/renew', { preHandler: requireAuth }, async (request): Promise<SubscriptionDto> => {
    const { id } = request.params as { id: string };
    const body = renewInputSchema.parse(request.body ?? {});
    const existing = requireSubscriptionRow(ctx, id);
    if (body.expectedExpiryDate !== existing.expiry_date) {
      throw new ConflictError('Subscription expiry changed since it was loaded', {
        expectedExpiryDate: body.expectedExpiryDate,
        currentExpiryDate: existing.expiry_date,
      });
    }

    const general = ctx.settings.getGeneral();
    const today = todayInZone(general.timezone);
    const baseDate = today > existing.expiry_date ? today : existing.expiry_date;
    const nextExpiry = body.date ?? addCycle(baseDate, existing.cycle as Cycle);
    if (nextExpiry <= existing.expiry_date) {
      throw new BadRequestError('Renewed expiry must be after the current expiry date');
    }

    const reminderState = reminderStateFor(existing);
    const now = nowIso();
    withTransaction(ctx.db, () => {
      const update = run(
        ctx.db,
        'UPDATE subscriptions SET expiry_date = ?, updated_at = ? WHERE id = ? AND expiry_date = ?',
        [nextExpiry, now, id, existing.expiry_date],
      );
      if (Number(update.changes) === 0) {
        throw new ConflictError('Subscription expiry changed while renewing', {
          currentExpiryDate: existing.expiry_date,
        });
      }
      run(
        ctx.db,
        `INSERT INTO renewals (id, subscription_id, from_date, to_date, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), id, existing.expiry_date, nextExpiry, now],
      );
      rebuildPendingReminders(ctx.db, general, {
        ...reminderState,
        expiryDate: nextExpiry,
      });
    });

    try {
      enqueueRenewedNotification(ctx, {
        subscriptionId: id,
        name: existing.name,
        fromDate: existing.expiry_date,
        toDate: nextExpiry,
        channelIds: channelIdsFor(existing),
      });
    } catch (error) {
      ctx.logger.error({ err: error, subscriptionId: id }, 'failed to enqueue subscription.renewed notification');
    }

    return toSubscriptionDto(ctx, requireSubscriptionRow(ctx, id));
  });

  app.post('/api/subscriptions/:id/pause', { preHandler: requireAuth }, async (request): Promise<SubscriptionDto> => {
    const { id } = request.params as { id: string };
    const existing = requireSubscriptionRow(ctx, id);
    const general = ctx.settings.getGeneral();
    withTransaction(ctx.db, () => {
      run(ctx.db, 'UPDATE subscriptions SET paused = 1, updated_at = ? WHERE id = ?', [nowIso(), id]);
      rebuildPendingReminders(ctx.db, general, { ...reminderStateFor(existing), paused: true });
    });
    return toSubscriptionDto(ctx, requireSubscriptionRow(ctx, id));
  });

  app.post('/api/subscriptions/:id/resume', { preHandler: requireAuth }, async (request): Promise<SubscriptionDto> => {
    const { id } = request.params as { id: string };
    const existing = requireSubscriptionRow(ctx, id);
    const general = ctx.settings.getGeneral();
    withTransaction(ctx.db, () => {
      run(ctx.db, 'UPDATE subscriptions SET paused = 0, updated_at = ? WHERE id = ?', [nowIso(), id]);
      rebuildPendingReminders(ctx.db, general, { ...reminderStateFor(existing), paused: false });
    });
    return toSubscriptionDto(ctx, requireSubscriptionRow(ctx, id));
  });

  app.post(
    '/api/subscriptions/:id/test-reminder',
    { preHandler: requireAuth },
    async (request): Promise<{ ok: true }> => {
      const { id } = request.params as { id: string };
      const existing = requireSubscriptionRow(ctx, id);
      enqueueTestReminder(ctx, {
        id: existing.id,
        name: existing.name,
        expiryDate: existing.expiry_date,
        expiryTime: existing.expiry_time,
        channelIds: channelIdsFor(existing),
      });
      return { ok: true };
    },
  );
}
