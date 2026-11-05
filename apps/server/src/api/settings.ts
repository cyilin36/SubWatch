import type { FastifyInstance } from 'fastify';
import { IANAZone } from 'luxon';
import { z } from 'zod';
import {
  APP_VERSION,
  emailChannelConfigSchema,
  settingsUpdateSchema,
  type SettingsDto,
} from '@subwatch/shared';
import type { AppModules, CoreContext } from '../context.js';
import { createRequireAuth } from '../auth/guard.js';
import { BadRequestError } from '../lib/errors.js';
import { one } from '../db/helpers.js';

export function buildSettingsDto(ctx: CoreContext): SettingsDto {
  const general = ctx.settings.getGeneral();
  return {
    general,
    smtp: ctx.settings.getMaskedSmtp(),
    version: APP_VERSION,
    timezone: general.timezone,
  };
}

export async function registerSettingsRoutes(
  app: FastifyInstance,
  ctx: CoreContext,
  modules: AppModules,
): Promise<void> {
  const requireAuth = createRequireAuth(ctx);

  app.get('/api/settings', { preHandler: requireAuth }, async () => buildSettingsDto(ctx));

  app.patch('/api/settings', { preHandler: requireAuth }, async (request) => {
    const body = settingsUpdateSchema.parse(request.body ?? {});
    const before = ctx.settings.getGeneral();
    if (body.general) {
      if (body.general.timezone && !IANAZone.isValidZone(body.general.timezone)) {
        throw new BadRequestError(`Invalid timezone: ${body.general.timezone}`);
      }
      ctx.settings.updateGeneral(body.general);
    }
    if (body.smtp) {
      ctx.settings.updateSmtp(body.smtp);
    }
    const after = ctx.settings.getGeneral();
    const reminderConfigChanged =
      after.timezone !== before.timezone ||
      after.reminderTime !== before.reminderTime ||
      JSON.stringify(after.defaultReminderOffsets) !== JSON.stringify(before.defaultReminderOffsets);
    if (reminderConfigChanged) {
      modules.subscriptions.rescheduleAll();
    }
    ctx.logger.info({ general: after.appName, timezone: after.timezone }, 'settings updated');
    return buildSettingsDto(ctx);
  });

  const smtpTestSchema = z.object({
    config: emailChannelConfigSchema.optional(),
  });

  app.post(
    '/api/settings/smtp/test',
    { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (request) => {
      const body = smtpTestSchema.parse(request.body ?? {});
      const config = body.config ?? ctx.settings.getSmtp();
      if (!config) throw new BadRequestError('SMTP is not configured yet');
      const result = await modules.notifications.testEmail(config);
      return { ok: result.ok, error: result.error ?? null };
    },
  );

  app.get('/api/settings/version', { preHandler: requireAuth }, async () => {
    const row = one<{ version: number }>(ctx.db, 'SELECT MAX(version) AS version FROM schema_migrations');
    return { version: APP_VERSION, schemaVersion: Number(row?.version ?? 0) };
  });
}
