import {
  EVENT_TYPES,
  emailChannelConfigSchema,
  webhookChannelConfigSchema,
  type NotificationEventType,
} from '@subwatch/shared';
import type { CoreContext, NotificationEnqueueInput, NotificationPayload } from '../context.js';
import { nowIso, parseJson } from '../db/helpers.js';
import { sendEmail } from './email.js';
import { renderNotification, type RenderEnvironment } from './render.js';
import { sendWebhook } from './webhook.js';
import {
  MAX_ATTEMPTS,
  RETRY_BACKOFF_SECONDS,
  deleteOldNotifications,
  enqueueNotification,
  getChannel,
  getEnabledChannels,
  listDueNotifications,
  markNotificationFailure,
  markNotificationSent,
  truncateError,
  type NotificationRow,
} from './repository.js';

const PROCESS_INTERVAL_MS = 30_000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 20;

export function buildRenderEnvironment(ctx: CoreContext): RenderEnvironment {
  const general = ctx.settings.getGeneral();
  return {
    locale: general.locale,
    appName: general.appName,
    appUrl: ctx.settings.getBaseUrl(),
    timezone: general.timezone,
  };
}

interface DeliveryResult {
  ok: boolean;
  error?: string;
}

/**
 * Durable notification delivery queue.
 *
 * `enqueue` only writes rows (idempotent on `(event_key, channel_id)`); a single
 * timer drains due rows every 30s and retries failures with exponential
 * backoff. Failed deliveries are persisted with a truncated error, never
 * thrown back into the monitor/subscription schedulers.
 */
export class NotificationQueue {
  private tickTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private started = false;
  private processing: Promise<void> | null = null;

  constructor(private readonly ctx: CoreContext) {}

  enqueue(input: NotificationEnqueueInput): void {
    try {
      const general = this.ctx.settings.getGeneral();
      const requested =
        input.channelIds.length > 0 ? input.channelIds : general.defaultChannelIds;
      const uniqueIds = [...new Set(requested.map((id) => id.trim()).filter(Boolean))];
      const channels = getEnabledChannels(this.ctx.db, this.ctx.secretBox, uniqueIds);
      const nextAttemptAt = nowIso();

      if (channels.length === 0) {
        const inserted = enqueueNotification(this.ctx.db, {
          eventType: input.eventType,
          eventKey: input.eventKey,
          channelId: null,
          payload: input.payload,
          status: 'skipped_no_channel',
          nextAttemptAt,
        });
        this.ctx.logger.warn(
          {
            eventType: input.eventType,
            eventKey: input.eventKey,
            requestedChannels: uniqueIds.length,
            inserted,
          },
          'notification skipped: no enabled channel',
        );
        return;
      }

      let inserted = 0;
      for (const channel of channels) {
        const created = enqueueNotification(this.ctx.db, {
          eventType: input.eventType,
          eventKey: input.eventKey,
          channelId: channel.id,
          payload: input.payload,
          status: 'pending',
          nextAttemptAt,
        });
        if (created) inserted += 1;
      }
      this.ctx.logger.debug(
        {
          eventType: input.eventType,
          eventKey: input.eventKey,
          channels: channels.length,
          inserted,
        },
        'notification enqueued',
      );
    } catch (error) {
      // A notification failure must never break the caller's schedule loop.
      this.ctx.logger.error(
        { err: error, eventType: input.eventType, eventKey: input.eventKey },
        'failed to enqueue notification',
      );
    }
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.cleanupOldNotifications();
    void this.runBatch();
    this.tickTimer = setInterval(() => {
      void this.runBatch();
    }, PROCESS_INTERVAL_MS);
    this.tickTimer.unref();
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldNotifications();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
    this.ctx.logger.info({ intervalMs: PROCESS_INTERVAL_MS }, 'notification queue started');
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.processing) {
      try {
        await this.processing;
      } catch {
        // already logged inside runBatch
      }
    }
    this.ctx.logger.info('notification queue stopped');
  }

  private cleanupOldNotifications(): void {
    try {
      const general = this.ctx.settings.getGeneral();
      const removed = deleteOldNotifications(this.ctx.db, general.notificationRetentionDays);
      if (removed > 0) {
        this.ctx.logger.info(
          { removed, retentionDays: general.notificationRetentionDays },
          'pruned old notifications',
        );
      }
    } catch (error) {
      this.ctx.logger.error({ err: error }, 'failed to prune old notifications');
    }
  }

  private async runBatch(): Promise<void> {
    if (!this.started || this.processing) return;
    this.processing = this.processDue()
      .catch((error) => {
        this.ctx.logger.error({ err: error }, 'notification batch failed');
      })
      .finally(() => {
        this.processing = null;
      });
    await this.processing;
  }

  private async processDue(): Promise<void> {
    const due = listDueNotifications(this.ctx.db, nowIso(), BATCH_SIZE);
    if (due.length === 0) return;
    const env = buildRenderEnvironment(this.ctx);
    this.ctx.logger.debug({ count: due.length }, 'processing notification batch');
    for (const row of due) {
      if (!this.started) return;
      await this.deliver(row, env);
    }
  }

  private async deliver(row: NotificationRow, env: RenderEnvironment): Promise<void> {
    const eventType = row.event_type as NotificationEventType;
    const payload = parseJson<NotificationPayload | null>(row.payload, null);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      markNotificationFailure(this.ctx.db, row.id, 'Stored notification payload is invalid', null);
      this.ctx.logger.warn({ id: row.id }, 'notification failed: invalid stored payload');
      return;
    }
    if (!(EVENT_TYPES as readonly string[]).includes(eventType)) {
      markNotificationFailure(this.ctx.db, row.id, `Unknown notification event type: ${eventType}`, null);
      this.ctx.logger.warn({ id: row.id, eventType }, 'notification failed: unknown event type');
      return;
    }

    if (!row.channel_id) {
      markNotificationFailure(this.ctx.db, row.id, 'Notification channel was removed', null);
      this.ctx.logger.warn({ id: row.id, eventType }, 'notification failed: channel removed');
      return;
    }
    const channel = getChannel(this.ctx.db, this.ctx.secretBox, row.channel_id);
    if (!channel) {
      markNotificationFailure(this.ctx.db, row.id, 'Notification channel was removed', null);
      this.ctx.logger.warn({ id: row.id, eventType }, 'notification failed: channel not found');
      return;
    }
    if (!channel.enabled) {
      markNotificationFailure(this.ctx.db, row.id, 'Notification channel is disabled', null);
      this.ctx.logger.warn({ id: row.id, eventType }, 'notification failed: channel disabled');
      return;
    }

    const rendered = renderNotification(eventType, payload, env);
    let result: DeliveryResult;
    try {
      result = await this.dispatch(channel.type, channel.config, eventType, rendered);
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    if (result.ok) {
      markNotificationSent(this.ctx.db, row.id);
      this.ctx.logger.info(
        { id: row.id, eventType, channelId: row.channel_id },
        'notification sent',
      );
      return;
    }

    const attempts = Number(row.attempts) + 1;
    const backoffSeconds =
      attempts >= MAX_ATTEMPTS
        ? null
        : (RETRY_BACKOFF_SECONDS[
            Math.min(attempts - 1, RETRY_BACKOFF_SECONDS.length - 1)
          ] ?? null);
    const nextAttemptAt =
      backoffSeconds === null
        ? null
        : new Date(Date.now() + backoffSeconds * 1000).toISOString();
    const errorMessage = result.error ?? 'Notification delivery failed';
    markNotificationFailure(this.ctx.db, row.id, errorMessage, nextAttemptAt);
    this.ctx.logger.warn(
      {
        id: row.id,
        eventType,
        channelId: row.channel_id,
        attempts,
        willRetry: nextAttemptAt !== null,
        error: truncateError(errorMessage, 300),
      },
      'notification delivery failed',
    );
  }

  private async dispatch(
    channelType: 'email' | 'webhook',
    config: Record<string, unknown>,
    eventType: NotificationEventType,
    rendered: ReturnType<typeof renderNotification>,
  ): Promise<DeliveryResult> {
    if (channelType === 'email') {
      const parsed = emailChannelConfigSchema.safeParse(config);
      if (!parsed.success) return { ok: false, error: 'Invalid email channel configuration' };
      const result = await sendEmail(parsed.data, {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      return { ok: result.ok, error: result.error };
    }

    const parsed = webhookChannelConfigSchema.safeParse(config);
    if (!parsed.success) return { ok: false, error: 'Invalid webhook channel configuration' };
    const result = await sendWebhook(parsed.data, {
      event: eventType,
      title: rendered.title,
      message: rendered.message,
      severity: rendered.severity,
      timestamp: rendered.timestamp,
      data: rendered.data,
      appUrl: rendered.appUrl,
    });
    return { ok: result.ok, error: result.error };
  }
}
