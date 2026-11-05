import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  NOTIFICATION_STATUS_VALUES,
  SECRET_KEEP,
  channelInputSchema,
  channelTestSchema,
  emailChannelConfigSchema,
  eventTypeSchema,
  paginationQuerySchema,
  webhookChannelConfigSchema,
  type ChannelType,
  type EmailChannelConfig,
  type WebhookChannelConfig,
} from '@subwatch/shared';
import type { CoreContext, NotificationModule } from '../context.js';
import { createRequireAuth } from '../auth/guard.js';
import { AppError, BadRequestError, NotFoundError } from '../lib/errors.js';
import { sendEmail } from './email.js';
import { NotificationQueue, buildRenderEnvironment } from './queue.js';
import { buildChannelTestPayload, renderNotification } from './render.js';
import {
  createChannel,
  deleteChannel,
  getChannel,
  getNotificationDto,
  listChannels,
  listNotifications,
  retryNotification,
  toChannelDto,
  updateChannel,
} from './repository.js';
import { sendWebhook } from './webhook.js';

interface ChannelTestResult {
  ok: boolean;
  error?: string;
}

const notificationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(NOTIFICATION_STATUS_VALUES).optional(),
  eventType: eventTypeSchema.optional(),
});

async function runEmailTest(
  ctx: CoreContext,
  config: EmailChannelConfig,
): Promise<ChannelTestResult> {
  const env = buildRenderEnvironment(ctx);
  const rendered = renderNotification('channel.test', buildChannelTestPayload(env.locale), env);
  const result = await sendEmail(config, {
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  return { ok: result.ok, error: result.error };
}

async function runWebhookTest(
  ctx: CoreContext,
  config: WebhookChannelConfig,
): Promise<ChannelTestResult> {
  const env = buildRenderEnvironment(ctx);
  const rendered = renderNotification('channel.test', buildChannelTestPayload(env.locale), env);
  const result = await sendWebhook(config, {
    event: 'channel.test',
    title: rendered.title,
    message: rendered.message,
    severity: rendered.severity,
    timestamp: rendered.timestamp,
    data: rendered.data,
    appUrl: rendered.appUrl,
  });
  return { ok: result.ok, error: result.error };
}

/** Strip `SECRET_KEEP` sentinels from a draft config with no stored secret. */
function normalizeDraftConfig(
  type: ChannelType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (type === 'email') {
    return {
      ...config,
      password: config.password === SECRET_KEEP ? '' : config.password,
    };
  }
  const headers = Array.isArray(config.headers)
    ? (config.headers as Array<Record<string, unknown>>).map((header) =>
        header && header.secret === true && header.value === SECRET_KEEP
          ? { ...header, value: '' }
          : header,
      )
    : [];
  return {
    ...config,
    signingSecret: config.signingSecret === SECRET_KEEP ? '' : config.signingSecret,
    headers,
  };
}

function parseOrBadRequest<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: z.ZodError } },
  value: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    // Match the global ZodError handler contract ({ error: { code: 'validation_error' } }).
    throw new AppError(400, 'validation_error', message, parsed.error.flatten());
  }
  return parsed.data;
}

function parseDraftConfig(
  type: ChannelType,
  raw: Record<string, unknown>,
): EmailChannelConfig | WebhookChannelConfig {
  const normalized = normalizeDraftConfig(type, raw);
  if (type === 'email') {
    const parsed = emailChannelConfigSchema.safeParse(normalized);
    if (!parsed.success) {
      throw new BadRequestError('Invalid email channel config', parsed.error.flatten());
    }
    return parsed.data;
  }
  const parsed = webhookChannelConfigSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new BadRequestError('Invalid webhook channel config', parsed.error.flatten());
  }
  return parsed.data;
}

async function testChannelConfig(
  ctx: CoreContext,
  type: ChannelType,
  config: Record<string, unknown>,
): Promise<ChannelTestResult> {
  const parsed = parseDraftConfig(type, config);
  return type === 'email'
    ? runEmailTest(ctx, parsed as EmailChannelConfig)
    : runWebhookTest(ctx, parsed as WebhookChannelConfig);
}

export function createNotificationModule(ctx: CoreContext): NotificationModule {
  const queue = new NotificationQueue(ctx);
  const requireAuth = createRequireAuth(ctx);

  return {
    enqueue(input) {
      queue.enqueue(input);
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/api/channels', { preHandler: requireAuth }, async () =>
        listChannels(ctx.db, ctx.secretBox).map(toChannelDto),
      );

      app.post('/api/channels', { preHandler: requireAuth }, async (request, reply) => {
        const body = parseOrBadRequest(channelInputSchema, request.body ?? {}, 'Invalid notification channel');
        const record = createChannel(ctx.db, ctx.secretBox, body);
        ctx.logger.info({ channelId: record.id, type: record.type }, 'notification channel created');
        return reply.code(201).send(toChannelDto(record));
      });

      app.put('/api/channels/:id', { preHandler: requireAuth }, async (request) => {
        const { id } = request.params as { id: string };
        const body = parseOrBadRequest(channelInputSchema, request.body ?? {}, 'Invalid notification channel');
        const record = updateChannel(ctx.db, ctx.secretBox, id, body);
        if (!record) throw new NotFoundError('Notification channel not found');
        ctx.logger.info({ channelId: record.id, type: record.type }, 'notification channel updated');
        return toChannelDto(record);
      });

      app.delete('/api/channels/:id', { preHandler: requireAuth }, async (request) => {
        const { id } = request.params as { id: string };
        if (!deleteChannel(ctx.db, id)) throw new NotFoundError('Notification channel not found');
        ctx.logger.info({ channelId: id }, 'notification channel deleted');
        return { ok: true };
      });

      app.post(
        '/api/channels/:id/test',
        { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
        async (request) => {
          const { id } = request.params as { id: string };
          const record = getChannel(ctx.db, ctx.secretBox, id);
          if (!record) throw new NotFoundError('Notification channel not found');
          const result = await testChannelConfig(ctx, record.type, record.config);
          return { ok: result.ok, error: result.error ?? null };
        },
      );

      // Draft test (new/unsaved channel config); `:id/test` above owns its own
      // path, so Fastify's static route wins for `/api/channels/test`.
      app.post(
        '/api/channels/test',
        { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
        async (request) => {
          const body = parseOrBadRequest(channelTestSchema, request.body ?? {}, 'Invalid channel test payload');
          const result = await testChannelConfig(ctx, body.type, body.config);
          return { ok: result.ok, error: result.error ?? null };
        },
      );

      app.get('/api/notifications', { preHandler: requireAuth }, async (request) => {
        const query = parseOrBadRequest(
          notificationsQuerySchema,
          request.query ?? {},
          'Invalid notification query',
        );
        const { items, total } = listNotifications(ctx.db, {
          status: query.status,
          eventType: query.eventType,
          limit: query.limit,
          offset: query.offset,
        });
        return { items, total, limit: query.limit, offset: query.offset };
      });

      app.post('/api/notifications/:id/retry', { preHandler: requireAuth }, async (request) => {
        const { id } = request.params as { id: string };
        const existing = getNotificationDto(ctx.db, id);
        if (!existing) throw new NotFoundError('Notification not found');
        if (existing.status !== 'failed' && existing.status !== 'pending') {
          throw new BadRequestError(`Cannot retry a ${existing.status} notification`);
        }
        retryNotification(ctx.db, id);
        ctx.logger.info({ notificationId: id }, 'notification manually retried');
        return { ok: true, item: getNotificationDto(ctx.db, id) ?? existing };
      });
    },

    start() {
      queue.start();
    },

    async stop() {
      await queue.stop();
    },

    async testEmail(config) {
      // The settings page may submit the masked `SECRET_KEEP` sentinel for an
      // already-stored password; fall back to the saved SMTP password then.
      const resolved =
        config.password === SECRET_KEEP
          ? { ...config, password: ctx.settings.getSmtp()?.password ?? '' }
          : config;
      return runEmailTest(ctx, resolved);
    },
  };
}
