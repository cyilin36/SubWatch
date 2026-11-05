import type { FastifyInstance } from 'fastify';
import type { ModuleContext, SubscriptionModule } from '../context.js';
import { REMINDER_SCAN_INTERVAL_MS, rebuildAllPendingReminders, scanDueReminders } from './reminders.js';
import { registerSubscriptionRoutes } from './routes.js';
import { registerTemplateRoutes, seedBuiltinTemplates } from './templates.js';

/**
 * Subscription + template module: built-in template seeding, CRUD/renewal
 * routes and the expiry reminder scheduler.
 */
export function createSubscriptionModule(ctx: ModuleContext): SubscriptionModule {
  seedBuiltinTemplates(ctx);

  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  const safeScan = (): void => {
    if (stopped) return;
    try {
      scanDueReminders(ctx);
    } catch (error) {
      ctx.logger.error({ err: error }, 'subscription reminder scan failed');
    }
  };

  const safeRescheduleAll = (): void => {
    if (stopped) return;
    try {
      rebuildAllPendingReminders(ctx);
    } catch (error) {
      ctx.logger.error({ err: error }, 'failed to rebuild subscription reminder schedules');
    }
  };

  return {
    registerRoutes(app: FastifyInstance) {
      registerTemplateRoutes(app, ctx);
      registerSubscriptionRoutes(app, ctx);
    },
    start() {
      if (timer) return;
      stopped = false;
      // Recover schedules after downtime, then catch up on anything already due.
      safeRescheduleAll();
      safeScan();
      timer = setInterval(safeScan, REMINDER_SCAN_INTERVAL_MS);
      timer.unref?.();
    },
    async stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    rescheduleAll() {
      safeRescheduleAll();
    },
  };
}
