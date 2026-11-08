import { daysLeft, type Cycle, type RenewalDto, type SubscriptionDto } from '@subwatch/shared';
import type { CoreContext } from '../context.js';
import { all, fromBool, one, run } from '../db/helpers.js';
import { parseChannelIds, parseReminderOffsets } from './parse.js';
import { deriveSubscriptionStatus } from './status.js';

export interface SubscriptionRow {
  id: string;
  name: string;
  url: string | null;
  expiry_date: string;
  expiry_time: string;
  cycle: string;
  reminder_offsets: string;
  channel_ids: string;
  notes: string;
  paused: number;
  created_at: string;
  updated_at: string;
}

export interface RenewalRow {
  id: string;
  subscription_id: string;
  from_date: string;
  to_date: string;
  created_at: string;
}

export function mapRenewalRow(row: RenewalRow): RenewalDto {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    fromDate: row.from_date,
    toDate: row.to_date,
    createdAt: row.created_at,
  };
}

export function listRenewals(ctx: CoreContext, subscriptionId: string): RenewalDto[] {
  return all<RenewalRow>(
    ctx.db,
    'SELECT * FROM renewals WHERE subscription_id = ? ORDER BY created_at DESC, rowid DESC',
    [subscriptionId],
  ).map(mapRenewalRow);
}

/**
 * Map one stored subscription to its DTO. Renewals are deliberately opt-in so
 * the list endpoint does not pay for one query per subscription; only the
 * detail view (GET /api/subscriptions/:id) asks for them.
 */
export function mapSubscriptionRow(
  ctx: CoreContext,
  row: SubscriptionRow,
  renewals?: RenewalDto[],
): SubscriptionDto {
  const general = ctx.settings.getGeneral();
  const reminderOffsets = parseReminderOffsets(row.reminder_offsets);
  const paused = fromBool(row.paused);
  const status = deriveSubscriptionStatus(
    { paused, expiryDate: row.expiry_date, expiryTime: row.expiry_time, reminderOffsets },
    general,
    general.timezone,
  );
  const dto: SubscriptionDto = {
    id: row.id,
    name: row.name,
    url: row.url && row.url !== '' ? row.url : null,
    expiryDate: row.expiry_date,
    expiryTime: row.expiry_time,
    cycle: row.cycle as Cycle,
    reminderOffsets,
    channelIds: parseChannelIds(row.channel_ids),
    notes: row.notes,
    paused,
    status,
    daysLeft: daysLeft(row.expiry_date, general.timezone),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (renewals) dto.renewals = renewals;
  return dto;
}

export function getSubscriptionRow(ctx: CoreContext, id: string): SubscriptionRow | undefined {
  return one<SubscriptionRow>(ctx.db, 'SELECT * FROM subscriptions WHERE id = ?', [id]);
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export interface SubscriptionListFilters {
  search?: string;
}

export function listSubscriptions(ctx: CoreContext, filters: SubscriptionListFilters = {}): SubscriptionDto[] {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filters.search && filters.search.trim() !== '') {
    const pattern = `%${escapeLike(filters.search.trim())}%`;
    conditions.push("(name LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const rows = all<SubscriptionRow>(
    ctx.db,
    `SELECT * FROM subscriptions${where} ORDER BY expiry_date ASC, expiry_time ASC, created_at ASC`,
    params,
  );
  return rows.map((row) => mapSubscriptionRow(ctx, row));
}

export function deleteSubscription(ctx: CoreContext, id: string): void {
  run(ctx.db, 'DELETE FROM subscriptions WHERE id = ?', [id]);
}
