import {
  SUBSCRIPTION_STATUS_VALUES,
  daysLeft,
  type RenewalDto,
  type SubscriptionDto,
  type SubscriptionStatus,
  type TemplateField,
} from '@subwatch/shared';
import type { CoreContext } from '../context.js';
import { all, fromBool, one, parseJson, run } from '../db/helpers.js';
import { BadRequestError } from '../lib/errors.js';
import { deriveSubscriptionStatus, maskFieldsForOutput } from './fields.js';
import { parseTemplateFields } from './templates.js';

export interface SubscriptionRow {
  id: string;
  template_id: string | null;
  name: string;
  fields: string;
  start_date: string;
  expiry_date: string;
  cycle: string;
  cycle_days: number | null;
  amount_cents: number | null;
  currency: string;
  reminder_offsets: string;
  channel_ids: string;
  linked_monitor_ids: string;
  notes: string;
  paused: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionRowWithTemplate extends SubscriptionRow {
  template_name: string | null;
  template_fields: string | null;
}

export interface RenewalRow {
  id: string;
  subscription_id: string;
  from_date: string;
  to_date: string;
  amount_cents: number | null;
  currency: string | null;
  note: string;
  created_at: string;
}

function parseOffsets(raw: string): number[] {
  const values = parseJson<unknown>(raw, []);
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function parseIds(raw: string): string[] {
  const values = parseJson<unknown>(raw, []);
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export function storedFields(row: SubscriptionRow): Record<string, unknown> {
  const parsed = parseJson<unknown>(row.fields, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

export function mapRenewalRow(row: RenewalRow): RenewalDto {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    fromDate: row.from_date,
    toDate: row.to_date,
    amountCents: row.amount_cents,
    currency: row.currency,
    note: row.note,
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

export function mapSubscriptionRow(
  ctx: CoreContext,
  row: SubscriptionRowWithTemplate,
  renewals?: RenewalDto[],
): SubscriptionDto {
  const general = ctx.settings.getGeneral();
  const templateFields = parseTemplateFields(row.template_fields);
  const reminderOffsets = parseOffsets(row.reminder_offsets);
  const fields = maskFieldsForOutput(storedFields(row), templateFields);
  const paused = fromBool(row.paused);
  const archived = fromBool(row.archived);
  const status = deriveSubscriptionStatus(
    { paused, archived, expiryDate: row.expiry_date, reminderOffsets },
    general,
    general.timezone,
  );
  const dto: SubscriptionDto = {
    id: row.id,
    templateId: row.template_id,
    templateName: row.template_name,
    name: row.name,
    fields,
    startDate: row.start_date,
    expiryDate: row.expiry_date,
    cycle: row.cycle as SubscriptionDto['cycle'],
    cycleDays: row.cycle_days,
    amountCents: row.amount_cents,
    currency: row.currency,
    reminderOffsets,
    channelIds: parseIds(row.channel_ids),
    linkedMonitorIds: parseIds(row.linked_monitor_ids),
    notes: row.notes,
    paused,
    archived,
    status,
    daysLeft: daysLeft(row.expiry_date, general.timezone),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (renewals) dto.renewals = renewals;
  return dto;
}

const SUBSCRIPTION_SELECT = `SELECT s.*, t.name AS template_name, t.fields AS template_fields
  FROM subscriptions s
  LEFT JOIN templates t ON t.id = s.template_id`;

export function getSubscriptionRow(ctx: CoreContext, id: string): SubscriptionRowWithTemplate | undefined {
  return one<SubscriptionRowWithTemplate>(ctx.db, `${SUBSCRIPTION_SELECT} WHERE s.id = ?`, [id]);
}

export function listSubscriptionRows(ctx: CoreContext): SubscriptionRowWithTemplate[] {
  return all<SubscriptionRowWithTemplate>(
    ctx.db,
    `${SUBSCRIPTION_SELECT} ORDER BY s.expiry_date ASC, s.created_at ASC`,
  );
}

export function parseSubscriptionStatus(raw: string | undefined): SubscriptionStatus | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (!(SUBSCRIPTION_STATUS_VALUES as readonly string[]).includes(raw)) {
    throw new BadRequestError(`Invalid subscription status filter: ${raw}`);
  }
  return raw as SubscriptionStatus;
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export interface SubscriptionListFilters {
  status?: SubscriptionStatus;
  templateId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * List subscriptions with optional SQL-side filters. `status` is derived from
 * dates/pause flags, so that filter (and pagination) is applied after mapping.
 */
export function listSubscriptions(ctx: CoreContext, filters: SubscriptionListFilters): SubscriptionDto[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (filters.templateId !== undefined) {
    if (filters.templateId === 'none' || filters.templateId === 'null') {
      conditions.push('s.template_id IS NULL');
    } else {
      conditions.push('s.template_id = ?');
      params.push(filters.templateId);
    }
  }
  if (filters.search && filters.search.trim() !== '') {
    const pattern = `%${escapeLike(filters.search.trim())}%`;
    conditions.push("(s.name LIKE ? ESCAPE '\\' OR s.notes LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const rows = all<SubscriptionRowWithTemplate>(
    ctx.db,
    `${SUBSCRIPTION_SELECT}${where} ORDER BY s.expiry_date ASC, s.created_at ASC`,
    params,
  );
  let dtos = rows.map((row) => mapSubscriptionRow(ctx, row));
  if (filters.status) {
    dtos = dtos.filter((dto) => dto.status === filters.status);
  }
  const offset = filters.offset && filters.offset > 0 ? filters.offset : 0;
  if (offset > 0) dtos = dtos.slice(offset);
  if (filters.limit !== undefined) dtos = dtos.slice(0, filters.limit);
  return dtos;
}

export function deleteSubscription(ctx: CoreContext, id: string): void {
  run(ctx.db, 'DELETE FROM subscriptions WHERE id = ?', [id]);
}

/** Field schema of the template attached to a stored subscription. */
export function templateFieldsForRow(row: SubscriptionRowWithTemplate): TemplateField[] | null {
  return parseTemplateFields(row.template_fields);
}

export type { TemplateField };
