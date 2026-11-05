import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  addCycle,
  renewInputSchema,
  subscriptionInputSchema,
  todayInZone,
  type SubscriptionDto,
  type SubscriptionInput,
} from '@subwatch/shared';
import type { ModuleContext } from '../context.js';
import { createRequireAuth } from '../auth/guard.js';
import { fromBool, nowIso, parseJson, run, toJson, withTransaction, type SqlValue } from '../db/helpers.js';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.js';
import { sanitizeFieldsForStorage } from './fields.js';
import {
  deleteSubscription,
  getSubscriptionRow,
  listRenewals,
  listSubscriptionRows,
  listSubscriptions,
  mapSubscriptionRow,
  parseSubscriptionStatus,
  storedFields,
  type SubscriptionRowWithTemplate,
} from './repository.js';
import {
  enqueueRenewedNotification,
  enqueueTestReminder,
  rebuildPendingReminders,
} from './reminders.js';
import { getTemplateRow, parseTemplateFields, type TemplateRow } from './templates.js';

const SUBSCRIPTION_COLUMNS = `id, template_id, name, fields, start_date, expiry_date, cycle, cycle_days,
  amount_cents, currency, reminder_offsets, channel_ids, linked_monitor_ids, notes, paused, archived,
  created_at, updated_at`;

function requireSubscriptionRow(ctx: ModuleContext, id: string): SubscriptionRowWithTemplate {
  const row = getSubscriptionRow(ctx, id);
  if (!row) throw new NotFoundError('Subscription not found');
  return row;
}

function templateForInput(ctx: ModuleContext, templateId: string | null): TemplateRow | null {
  if (!templateId) return null;
  const row = getTemplateRow(ctx.db, templateId);
  if (!row) throw new BadRequestError('Selected template does not exist');
  return row;
}

function fieldsSchemaForTemplate(template: TemplateRow | null) {
  return parseTemplateFields(template?.fields ?? null);
}

function hasOwn(body: unknown, key: string): boolean {
  return Boolean(body && typeof body === 'object' && key in (body as Record<string, unknown>));
}

/**
 * When the client omits cycle/amount/reminder defaults, inherit them from the
 * selected template instead of the generic schema defaults.
 */
function applyTemplateDefaults(body: SubscriptionInput, rawBody: unknown, template: TemplateRow | null): void {
  if (!template) return;
  if (!hasOwn(rawBody, 'cycle')) body.cycle = template.default_cycle as SubscriptionInput['cycle'];
  if (!hasOwn(rawBody, 'cycleDays')) body.cycleDays = template.default_cycle_days;
  if (!hasOwn(rawBody, 'amountCents')) body.amountCents = template.default_amount_cents;
  if (!hasOwn(rawBody, 'currency')) body.currency = template.default_currency;
  if (!hasOwn(rawBody, 'reminderOffsets')) {
    const offsets = parseJson<unknown>(template.default_reminder_offsets, []);
    if (Array.isArray(offsets)) {
      body.reminderOffsets = offsets.filter(
        (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0,
      );
    }
  }
}

function reminderStateFor(row: SubscriptionRowWithTemplate) {
  const offsets = parseJson<unknown>(row.reminder_offsets, []);
  return {
    subscriptionId: row.id,
    expiryDate: row.expiry_date,
    reminderOffsets: Array.isArray(offsets)
      ? offsets.filter((value): value is number => typeof value === 'number' && Number.isInteger(value))
      : [],
    paused: fromBool(row.paused),
    archived: fromBool(row.archived),
  };
}

function channelIdsFor(row: SubscriptionRowWithTemplate): string[] {
  const ids = parseJson<unknown>(row.channel_ids, []);
  return Array.isArray(ids) ? ids.filter((value): value is string => typeof value === 'string') : [];
}

function insertSubscriptionRow(
  ctx: ModuleContext,
  values: {
    id: string;
    templateId: string | null;
    body: SubscriptionInput;
    fields: Record<string, unknown>;
    createdAt: string;
  },
): void {
  const { body } = values;
  run(
    ctx.db,
    `INSERT INTO subscriptions (${SUBSCRIPTION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.id,
      values.templateId,
      body.name,
      toJson(values.fields),
      body.startDate,
      body.expiryDate,
      body.cycle,
      body.cycleDays,
      body.amountCents,
      body.currency,
      toJson(body.reminderOffsets),
      toJson(body.channelIds),
      toJson(body.linkedMonitorIds),
      body.notes,
      body.paused ? 1 : 0,
      body.archived ? 1 : 0,
      values.createdAt,
      values.createdAt,
    ],
  );
}

function toSubscriptionDto(ctx: ModuleContext, row: SubscriptionRowWithTemplate, withRenewals: boolean): SubscriptionDto {
  return mapSubscriptionRow(ctx, row, withRenewals ? listRenewals(ctx, row.id) : undefined);
}

export function registerSubscriptionRoutes(app: FastifyInstance, ctx: ModuleContext): void {
  const requireAuth = createRequireAuth(ctx);

  app.get('/api/subscriptions', { preHandler: requireAuth }, async (request): Promise<SubscriptionDto[]> => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return listSubscriptions(ctx, {
      status: parseSubscriptionStatus(query.status),
      templateId: query.templateId || undefined,
      search: query.search || undefined,
      limit: parsePositiveInt(query.limit, 500),
      offset: parsePositiveInt(query.offset, 1_000_000),
    });
  });

  app.get('/api/subscriptions/upcoming', { preHandler: requireAuth }, async (request): Promise<SubscriptionDto[]> => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const parsed = Number(query.days ?? 30);
    const days = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 1), 365) : 30;
    return listSubscriptionRows(ctx)
      .map((row) => mapSubscriptionRow(ctx, row))
      .filter((dto) => !dto.paused && !dto.archived && dto.daysLeft >= 0 && dto.daysLeft <= days);
  });

  app.post('/api/subscriptions', { preHandler: requireAuth }, async (request, reply): Promise<SubscriptionDto> => {
    const rawBody = request.body ?? {};
    const body = subscriptionInputSchema.parse(rawBody);
    const template = templateForInput(ctx, body.templateId);
    applyTemplateDefaults(body, rawBody, template);
    const fields = sanitizeFieldsForStorage({
      input: body.fields,
      templateFields: fieldsSchemaForTemplate(template),
      existingStored: {},
      secretBox: ctx.secretBox,
    });
    const id = randomUUID();
    const now = nowIso();
    const general = ctx.settings.getGeneral();
    withTransaction(ctx.db, () => {
      insertSubscriptionRow(ctx, { id, templateId: body.templateId, body, fields, createdAt: now });
      rebuildPendingReminders(ctx.db, general, {
        subscriptionId: id,
        expiryDate: body.expiryDate,
        reminderOffsets: body.reminderOffsets,
        paused: body.paused,
        archived: body.archived,
      });
    });
    reply.code(201);
    return toSubscriptionDto(ctx, requireSubscriptionRow(ctx, id), true);
  });

  app.get('/api/subscriptions/:id', { preHandler: requireAuth }, async (request): Promise<SubscriptionDto> => {
    const { id } = request.params as { id: string };
    return toSubscriptionDto(ctx, requireSubscriptionRow(ctx, id), true);
  });

  app.put('/api/subscriptions/:id', { preHandler: requireAuth }, async (request): Promise<SubscriptionDto> => {
    const { id } = request.params as { id: string };
    const existing = requireSubscriptionRow(ctx, id);
    const body = subscriptionInputSchema.parse(request.body ?? {});
    const template = templateForInput(ctx, body.templateId);
    const fields = sanitizeFieldsForStorage({
      input: body.fields,
      templateFields: fieldsSchemaForTemplate(template),
      existingStored: storedFields(existing),
      secretBox: ctx.secretBox,
    });
    const now = nowIso();
    const general = ctx.settings.getGeneral();
    withTransaction(ctx.db, () => {
      run(
        ctx.db,
        `UPDATE subscriptions SET
           template_id = ?, name = ?, fields = ?, start_date = ?, expiry_date = ?, cycle = ?, cycle_days = ?,
           amount_cents = ?, currency = ?, reminder_offsets = ?, channel_ids = ?, linked_monitor_ids = ?,
           notes = ?, paused = ?, archived = ?, updated_at = ?
         WHERE id = ?`,
        [
          body.templateId,
          body.name,
          toJson(fields),
          body.startDate,
          body.expiryDate,
          body.cycle,
          body.cycleDays,
          body.amountCents,
          body.currency,
          toJson(body.reminderOffsets),
          toJson(body.channelIds),
          toJson(body.linkedMonitorIds),
          body.notes,
          body.paused ? 1 : 0,
          body.archived ? 1 : 0,
          now,
          id,
        ],
      );
      rebuildPendingReminders(ctx.db, general, {
        subscriptionId: id,
        expiryDate: body.expiryDate,
        reminderOffsets: body.reminderOffsets,
        paused: body.paused,
        archived: body.archived,
      });
    });
    return toSubscriptionDto(ctx, requireSubscriptionRow(ctx, id), true);
  });

  app.delete('/api/subscriptions/:id', { preHandler: requireAuth }, async (request): Promise<{ ok: true }> => {
    const { id } = request.params as { id: string };
    requireSubscriptionRow(ctx, id);
    deleteSubscription(ctx, id);
    return { ok: true };
  });

  app.get('/api/subscriptions/:id/renewals', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    requireSubscriptionRow(ctx, id);
    return listRenewals(ctx, id);
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
    const baseDate = body.base === 'today' && today > existing.expiry_date ? today : existing.expiry_date;
    let nextExpiry: string;
    if (body.mode === 'custom') {
      if (!body.date) throw new BadRequestError('Custom renewal mode requires a date');
      nextExpiry = body.date;
    } else {
      nextExpiry = addCycle(baseDate, existing.cycle as SubscriptionInput['cycle'], existing.cycle_days);
    }
    if (nextExpiry <= existing.expiry_date) {
      throw new BadRequestError('Renewed expiry must be after the current expiry date');
    }

    const renewalAmount = body.amountCents !== undefined ? body.amountCents : existing.amount_cents;
    const renewalCurrency = body.currency ?? existing.currency;
    const reminderState = reminderStateFor(existing);
    const renewalId = randomUUID();
    const now = nowIso();

    withTransaction(ctx.db, () => {
      const sets: string[] = ['expiry_date = ?', 'updated_at = ?'];
      const params: SqlValue[] = [nextExpiry, now];
      if (body.amountCents !== undefined) {
        sets.push('amount_cents = ?');
        params.push(body.amountCents);
      }
      if (body.currency !== undefined) {
        sets.push('currency = ?');
        params.push(body.currency);
      }
      params.push(id, existing.expiry_date);
      const update = run(
        ctx.db,
        `UPDATE subscriptions SET ${sets.join(', ')} WHERE id = ? AND expiry_date = ?`,
        params,
      );
      if (Number(update.changes) === 0) {
        throw new ConflictError('Subscription expiry changed while renewing', {
          currentExpiryDate: existing.expiry_date,
        });
      }
      run(
        ctx.db,
        `INSERT INTO renewals (id, subscription_id, from_date, to_date, amount_cents, currency, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [renewalId, id, existing.expiry_date, nextExpiry, renewalAmount, renewalCurrency, body.note, now],
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
        amountCents: renewalAmount,
        currency: renewalCurrency,
        channelIds: channelIdsFor(existing),
      });
    } catch (error) {
      ctx.logger.error({ err: error, subscriptionId: id }, 'failed to enqueue subscription.renewed notification');
    }

    return toSubscriptionDto(ctx, requireSubscriptionRow(ctx, id), true);
  });

  app.post('/api/subscriptions/:id/pause', { preHandler: requireAuth }, async (request): Promise<SubscriptionDto> => {
    const { id } = request.params as { id: string };
    const existing = requireSubscriptionRow(ctx, id);
    const general = ctx.settings.getGeneral();
    withTransaction(ctx.db, () => {
      run(ctx.db, 'UPDATE subscriptions SET paused = 1, updated_at = ? WHERE id = ?', [nowIso(), id]);
      rebuildPendingReminders(ctx.db, general, { ...reminderStateFor(existing), paused: true });
    });
    return toSubscriptionDto(ctx, requireSubscriptionRow(ctx, id), true);
  });

  app.post('/api/subscriptions/:id/resume', { preHandler: requireAuth }, async (request): Promise<SubscriptionDto> => {
    const { id } = request.params as { id: string };
    const existing = requireSubscriptionRow(ctx, id);
    const general = ctx.settings.getGeneral();
    withTransaction(ctx.db, () => {
      run(ctx.db, 'UPDATE subscriptions SET paused = 0, updated_at = ? WHERE id = ?', [nowIso(), id]);
      rebuildPendingReminders(ctx.db, general, { ...reminderStateFor(existing), paused: false });
    });
    return toSubscriptionDto(ctx, requireSubscriptionRow(ctx, id), true);
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
        channelIds: channelIdsFor(existing),
      });
      return { ok: true };
    },
  );
}

function parsePositiveInt(raw: string | undefined, max: number): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(Math.trunc(parsed), 0), max);
}
