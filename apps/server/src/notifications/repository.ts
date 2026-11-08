import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  SECRET_KEEP,
  type ChannelDto,
  type ChannelInput,
  type ChannelType,
  type EmailChannelConfig,
  type NotificationDto,
  type NotificationEventType,
  type NotificationStatus,
  type WebhookChannelConfig,
} from '@subwatch/shared';
import type { SecretBox } from '../lib/crypto.js';
import {
  all,
  fromBool,
  nowIso,
  one,
  parseJson,
  run,
  toBool,
  toJson,
  type SqlValue,
} from '../db/helpers.js';

/** Maximum delivery attempts before a notification is parked as `failed`. */
export const MAX_ATTEMPTS = 6;

/**
 * Backoff applied after the 1st..5th failed attempt (1m / 5m / 15m / 1h / 6h).
 * The 6th failure parks the notification as `failed` instead of retrying.
 */
export const RETRY_BACKOFF_SECONDS: readonly number[] = [60, 300, 900, 3600, 21_600];

const MAX_LAST_ERROR_CHARS = 1000;

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface ChannelRow {
  id: string;
  name: string;
  type: string;
  config: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  event_type: string;
  event_key: string;
  channel_id: string | null;
  payload: string;
  status: string;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

interface NotificationRowWithChannel extends NotificationRow {
  channel_name: string | null;
}

/** Internal, fully decrypted view of a channel. Never exposed through the API. */
export interface ChannelRecord {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueNotificationInput {
  eventType: NotificationEventType;
  eventKey: string;
  channelId: string | null;
  payload: unknown;
  status: NotificationStatus;
  nextAttemptAt: string;
}

export interface NotificationQuery {
  status?: NotificationStatus;
  eventType?: NotificationEventType;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function truncateError(message: string, max = MAX_LAST_ERROR_CHARS): string {
  const clean = message.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1))}…`;
}

function rowToChannelRecord(row: ChannelRow, secretBox: SecretBox): ChannelRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type as ChannelType,
    enabled: fromBool(row.enabled),
    config: decryptConfig(row, secretBox),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function decryptConfig(row: ChannelRow, secretBox: SecretBox): Record<string, unknown> {
  try {
    const config = secretBox.decryptJson<unknown>(row.config);
    return config && typeof config === 'object' && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  } catch {
    // A rotated/foreign secret key must not brick the channel list. Sends will
    // fail with "invalid channel configuration" instead.
    return {};
  }
}

function rowToNotificationDto(row: NotificationRowWithChannel): NotificationDto {
  return {
    id: row.id,
    eventType: row.event_type as NotificationEventType,
    eventKey: row.event_key,
    channelId: row.channel_id,
    channelName: row.channel_name ?? null,
    status: row.status as NotificationStatus,
    attempts: Number(row.attempts),
    lastError: row.last_error,
    payload: parseJson<unknown>(row.payload, null),
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

function readChannelRow(db: DatabaseSync, id: string): ChannelRow | undefined {
  return one<ChannelRow>(db, 'SELECT * FROM channels WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// Channel masking / secret preservation
// ---------------------------------------------------------------------------

function maskHeaders(headers: unknown): unknown[] {
  if (!Array.isArray(headers)) return [];
  return headers.map((header) => {
    if (!header || typeof header !== 'object') return header;
    const value = header as Record<string, unknown>;
    if (value.secret !== true) return value;
    const secretValue = typeof value.value === 'string' ? value.value : '';
    return { ...value, value: secretValue ? SECRET_KEEP : '' };
  });
}

/**
 * Public representation of a channel config: every stored secret is replaced
 * with `SECRET_KEEP` so the UI can round-trip a config without ever learning the
 * plaintext secret.
 */
export function maskChannelConfig(
  type: ChannelType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (type === 'email') {
    const password = typeof config.password === 'string' ? config.password : '';
    return { ...config, password: password ? SECRET_KEEP : '' };
  }
  const signingSecret = typeof config.signingSecret === 'string' ? config.signingSecret : '';
  return {
    ...config,
    signingSecret: signingSecret ? SECRET_KEEP : '',
    headers: maskHeaders(config.headers),
  };
}

function prepareNewConfig(
  type: ChannelType,
  config: EmailChannelConfig | WebhookChannelConfig,
): Record<string, unknown> {
  if (type === 'email') {
    const email = config as EmailChannelConfig;
    return { ...email, password: email.password === SECRET_KEEP ? '' : email.password };
  }
  const webhook = config as WebhookChannelConfig;
  return {
    ...webhook,
    signingSecret: webhook.signingSecret === SECRET_KEEP ? '' : webhook.signingSecret,
    headers: webhook.headers.map((header) =>
      header.secret && header.value === SECRET_KEEP ? { ...header, value: '' } : header,
    ),
  };
}

export function mergeSecretConfig(
  type: ChannelType,
  incoming: EmailChannelConfig | WebhookChannelConfig,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  if (type === 'email') {
    const email = incoming as EmailChannelConfig;
    const storedPassword = typeof existing.password === 'string' ? existing.password : '';
    return {
      ...email,
      password: email.password === SECRET_KEEP ? storedPassword : email.password,
    };
  }

  const webhook = incoming as WebhookChannelConfig;
  const storedSigningSecret =
    typeof existing.signingSecret === 'string' ? existing.signingSecret : '';
  const storedHeaders = Array.isArray(existing.headers)
    ? (existing.headers as Array<{ key?: unknown; value?: unknown; secret?: unknown }>)
    : [];
  const headers = webhook.headers.map((header) => {
    if (!header.secret || header.value !== SECRET_KEEP) return header;
    const match = storedHeaders.find(
      (candidate) => candidate && candidate.key === header.key && candidate.secret === true,
    );
    return {
      ...header,
      value: match && typeof match.value === 'string' ? match.value : '',
    };
  });
  return {
    ...webhook,
    signingSecret: webhook.signingSecret === SECRET_KEEP ? storedSigningSecret : webhook.signingSecret,
    headers,
  };
}

// ---------------------------------------------------------------------------
// Channel repository
// ---------------------------------------------------------------------------

export function toChannelDto(record: ChannelRecord): ChannelDto {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    enabled: record.enabled,
    config: maskChannelConfig(record.type, record.config),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function listChannels(db: DatabaseSync, secretBox: SecretBox): ChannelRecord[] {
  const rows = all<ChannelRow>(db, 'SELECT * FROM channels ORDER BY created_at ASC, name ASC');
  return rows.map((row) => rowToChannelRecord(row, secretBox));
}

export function getChannel(
  db: DatabaseSync,
  secretBox: SecretBox,
  id: string,
): ChannelRecord | undefined {
  const row = readChannelRow(db, id);
  return row ? rowToChannelRecord(row, secretBox) : undefined;
}

/** Channels among `ids`, enabled only, preserving the requested order. */
export function getEnabledChannels(
  db: DatabaseSync,
  secretBox: SecretBox,
  ids: readonly string[],
): ChannelRecord[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = all<ChannelRow>(
    db,
    `SELECT * FROM channels WHERE enabled = 1 AND id IN (${placeholders})`,
    ids as SqlValue[],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is ChannelRow => Boolean(row))
    .map((row) => rowToChannelRecord(row, secretBox));
}

export function createChannel(
  db: DatabaseSync,
  secretBox: SecretBox,
  input: ChannelInput,
): ChannelRecord {
  const id = randomUUID();
  const now = nowIso();
  const config = prepareNewConfig(input.type, input.config);
  run(
    db,
    `INSERT INTO channels (id, name, type, config, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.type, secretBox.encryptJson(config), toBool(input.enabled), now, now],
  );
  return {
    id,
    name: input.name,
    type: input.type,
    enabled: input.enabled,
    config,
    createdAt: now,
    updatedAt: now,
  };
}

export function updateChannel(
  db: DatabaseSync,
  secretBox: SecretBox,
  id: string,
  input: ChannelInput,
): ChannelRecord | undefined {
  const row = readChannelRow(db, id);
  if (!row) return undefined;
  const existingConfig = decryptConfig(row, secretBox);
  const config = mergeSecretConfig(input.type, input.config, existingConfig);
  const now = nowIso();
  run(
    db,
    `UPDATE channels SET name = ?, type = ?, config = ?, enabled = ?, updated_at = ? WHERE id = ?`,
    [input.name, input.type, secretBox.encryptJson(config), toBool(input.enabled), now, id],
  );
  return {
    id,
    name: input.name,
    type: input.type,
    enabled: input.enabled,
    config,
    createdAt: row.created_at,
    updatedAt: now,
  };
}

export function deleteChannel(db: DatabaseSync, id: string): boolean {
  const result = run(db, 'DELETE FROM channels WHERE id = ?', [id]);
  return Number(result.changes) > 0;
}

// ---------------------------------------------------------------------------
// Notification queue repository
// ---------------------------------------------------------------------------

/**
 * Whether a delivery row already exists for this (eventKey, channel). SQLite
 * unique constraints treat NULL channel ids as distinct, so the
 * `skipped_no_channel` row needs an explicit existence check.
 */
export function notificationExists(
  db: DatabaseSync,
  eventKey: string,
  channelId: string | null,
): boolean {
  const row =
    channelId === null
      ? one<{ id: string }>(
          db,
          'SELECT id FROM notification_queue WHERE event_key = ? AND channel_id IS NULL LIMIT 1',
          [eventKey],
        )
      : one<{ id: string }>(
          db,
          'SELECT id FROM notification_queue WHERE event_key = ? AND channel_id = ? LIMIT 1',
          [eventKey, channelId],
        );
  return Boolean(row);
}

/**
 * Insert one delivery row. Returns false when the (event_key, channel_id) pair
 * was already queued (idempotent enqueue) or skipped for a missing channel.
 */
export function enqueueNotification(
  db: DatabaseSync,
  input: EnqueueNotificationInput,
): boolean {
  if (notificationExists(db, input.eventKey, input.channelId)) return false;
  const result = run(
    db,
    `INSERT OR IGNORE INTO notification_queue
       (id, event_type, event_key, channel_id, payload, status, attempts, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      randomUUID(),
      input.eventType,
      input.eventKey,
      input.channelId,
      toJson(input.payload),
      input.status,
      input.nextAttemptAt,
      nowIso(),
    ],
  );
  return Number(result.changes) > 0;
}

export function listNotifications(
  db: DatabaseSync,
  query: NotificationQuery,
): { items: NotificationDto[]; total: number } {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (query.status) {
    where.push('n.status = ?');
    params.push(query.status);
  }
  if (query.eventType) {
    where.push('n.event_type = ?');
    params.push(query.eventType);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = one<{ count: number }>(
    db,
    `SELECT COUNT(*) AS count FROM notification_queue n ${whereSql}`,
    params,
  );
  const rows = all<NotificationRowWithChannel>(
    db,
    `SELECT n.*, c.name AS channel_name
       FROM notification_queue n
       LEFT JOIN channels c ON c.id = n.channel_id
       ${whereSql}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ? OFFSET ?`,
    [...params, query.limit, query.offset],
  );
  return {
    items: rows.map((row) => rowToNotificationDto(row)),
    total: Number(totalRow?.count ?? 0),
  };
}

export function getNotificationDto(db: DatabaseSync, id: string): NotificationDto | undefined {
  const row = one<NotificationRowWithChannel>(
    db,
    `SELECT n.*, c.name AS channel_name
       FROM notification_queue n
       LEFT JOIN channels c ON c.id = n.channel_id
      WHERE n.id = ?`,
    [id],
  );
  return row ? rowToNotificationDto(row) : undefined;
}

export function getNotificationRow(
  db: DatabaseSync,
  id: string,
): NotificationRow | undefined {
  return one<NotificationRow>(db, 'SELECT * FROM notification_queue WHERE id = ?', [id]);
}

export function listDueNotifications(
  db: DatabaseSync,
  now: string,
  limit: number,
): NotificationRow[] {
  return all<NotificationRow>(
    db,
    `SELECT * FROM notification_queue
      WHERE next_attempt_at <= ?
        AND (status = 'pending' OR (status = 'failed' AND attempts < ?))
      ORDER BY next_attempt_at ASC, created_at ASC
      LIMIT ?`,
    [now, MAX_ATTEMPTS, limit],
  );
}

export function markNotificationSent(db: DatabaseSync, id: string): boolean {
  const result = run(
    db,
    `UPDATE notification_queue
        SET status = 'sent', sent_at = ?, last_error = NULL
      WHERE id = ?`,
    [nowIso(), id],
  );
  return Number(result.changes) > 0;
}

/**
 * Record a failed delivery attempt. The caller decides whether a retry is
 * scheduled (`nextAttemptAt`) or the row is parked as `failed` (null).
 */
export function markNotificationFailure(
  db: DatabaseSync,
  id: string,
  error: string,
  nextAttemptAt: string | null,
): boolean {
  const row = one<{ attempts: number }>(
    db,
    'SELECT attempts FROM notification_queue WHERE id = ?',
    [id],
  );
  if (!row) return false;
  const attempts = Number(row.attempts) + 1;
  const failed = nextAttemptAt === null || attempts >= MAX_ATTEMPTS;
  run(
    db,
    `UPDATE notification_queue
        SET attempts = ?, last_error = ?, status = ?, next_attempt_at = ?
      WHERE id = ?`,
    [
      attempts,
      truncateError(error),
      failed ? 'failed' : 'pending',
      nextAttemptAt ?? nowIso(),
      id,
    ],
  );
  return true;
}

/** Manual retry: reset the attempt counter and make the row due immediately. */
export function retryNotification(db: DatabaseSync, id: string): boolean {
  const result = run(
    db,
    `UPDATE notification_queue
        SET status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = ?, sent_at = NULL
      WHERE id = ?`,
    [nowIso(), id],
  );
  return Number(result.changes) > 0;
}

/** Delete delivered/failed/skipped rows older than the retention window. */
export function deleteOldNotifications(db: DatabaseSync, retentionDays: number): number {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = run(
    db,
    `DELETE FROM notification_queue WHERE created_at < ? AND status <> 'pending'`,
    [cutoff],
  );
  return Number(result.changes);
}
