import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  idSchema,
  monitorInputSchema,
  monitorTestSchema,
  paginationQuerySchema,
  pushPayloadSchema,
  pushTokenRegenerateSchema,
} from '@subwatch/shared';
import type { ModuleContext, MonitorModule } from '../context.js';
import { createRequireAuth } from '../auth/guard.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { getTemplateById } from '../templates/repository.js';
import * as repo from './repository.js';
import { executeMonitorRun, executePushReport, testMonitorDraft } from './engine.js';
import { validateRequestConfig } from './http-runner.js';
import { MonitorScheduler } from './scheduler.js';

const idParamsSchema = z.object({ id: idSchema });
const pushTokenParamsSchema = z.object({ token: z.string().min(8).max(200) });
const metricsQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d']).default('24h'),
  metric: z.string().min(1).max(100).optional(),
});

const RANGE_MS: Record<'24h' | '7d' | '30d', number> = {
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  '30d': 30 * 24 * 3600 * 1000,
};

const MAX_METRIC_POINTS = 500;

function requireMonitor(ctx: ModuleContext, id: string): { row: repo.MonitorRow; dto: ReturnType<typeof repo.getMonitorDto> } {
  const monitor = repo.getMonitorWithDto(ctx, id);
  if (!monitor) throw new NotFoundError(`Monitor ${id} not found`);
  return monitor;
}

export function registerMonitorRoutes(app: FastifyInstance, ctx: ModuleContext, scheduler: MonitorScheduler): void {
  const requireAuth = createRequireAuth(ctx);

  app.get('/api/monitors', { preHandler: requireAuth }, async () => repo.listMonitors(ctx));

  app.post('/api/monitors', { preHandler: requireAuth }, async (request, reply) => {
    const input = monitorInputSchema.parse(request.body ?? {});
    const configError = validateRequestConfig(input.config);
    if (configError) throw new BadRequestError(configError);
    let templateName: string | null = null;
    if (input.templateId) {
      const template = getTemplateById(ctx, input.templateId);
      if (!template || template.kind !== 'monitor') {
        throw new BadRequestError('Template not found or is not a monitor template');
      }
      templateName = template.name;
    }
    const created = repo.createMonitor(ctx, input, templateName);
    if (input.enabled) scheduler.kick();
    reply.code(201);
    return created.pushToken ? { ...created.dto, pushToken: created.pushToken } : created.dto;
  });

  app.get<{ Params: { id: string } }>('/api/monitors/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    return requireMonitor(ctx, id).dto;
  });

  app.put<{ Params: { id: string } }>('/api/monitors/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const input = monitorInputSchema.parse(request.body ?? {});
    const configError = validateRequestConfig(input.config);
    if (configError) throw new BadRequestError(configError);
    const existing = requireMonitor(ctx, id);
    const updated = repo.updateMonitor(ctx, existing.row, input);
    if (input.enabled) scheduler.kick();
    return updated.pushToken ? { ...updated.dto, pushToken: updated.pushToken } : updated.dto;
  });

  app.delete<{ Params: { id: string } }>('/api/monitors/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    requireMonitor(ctx, id);
    repo.deleteMonitor(ctx, id);
    reply.code(204);
    return reply.send();
  });

  app.post<{ Params: { id: string } }>(
    '/api/monitors/:id/run',
    { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const existing = requireMonitor(ctx, id);
      if (existing.row.type !== 'http') {
        throw new BadRequestError('Push monitors cannot be run manually; post a report to their push token endpoint');
      }
      const rules = repo.listRuleDtos(ctx.db, id);
      const result = await executeMonitorRun(ctx, existing.row, rules, {
        trigger: 'manual',
        persist: true,
        scheduleNext: false,
      });
      return { run: result.run, monitor: result.monitor };
    },
  );

  app.post(
    '/api/monitors/test',
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      const input = monitorTestSchema.parse(request.body ?? {});
      return testMonitorDraft(ctx, input);
    },
  );

  app.get<{ Params: { id: string } }>('/api/monitors/:id/runs', { preHandler: requireAuth }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    requireMonitor(ctx, id);
    const cursor = paginationQuerySchema.parse(request.query ?? {});
    return repo.listRuns(ctx, id, cursor);
  });

  app.get<{ Params: { id: string } }>('/api/monitors/:id/metrics', { preHandler: requireAuth }, async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    requireMonitor(ctx, id);
    const query = metricsQuerySchema.parse(request.query ?? {});
    const since = new Date(Date.now() - RANGE_MS[query.range]).toISOString();
    const points = repo.listRunPoints(ctx, id, since, MAX_METRIC_POINTS);
    if (!query.metric) return { points };
    const metricKey = query.metric;
    return {
      points: points.map((point) => {
        const value = point.metrics[metricKey];
        return { at: point.at, metrics: value === undefined ? {} : { [metricKey]: value } };
      }),
    };
  });

  app.post<{ Params: { id: string } }>(
    '/api/monitors/:id/push-token/rotate',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const existing = requireMonitor(ctx, id);
      if (existing.row.type !== 'push') throw new BadRequestError('Only push monitors have a push token');
      pushTokenRegenerateSchema.parse(request.body ?? {});
      const rotated = repo.rotatePushToken(ctx, id);
      if (!rotated) throw new NotFoundError(`Monitor ${id} not found`);
      return rotated;
    },
  );

  // Public push ingest endpoint: authenticated by the bearer-style token in the
  // path, exempt from the session cookie / X-Requested-With CSRF check.
  app.post<{ Params: { token: string } }>(
    '/api/push/:token',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request) => {
      const { token } = pushTokenParamsSchema.parse(request.params);
      const row = repo.findMonitorByPushToken(ctx, token);
      if (!row || !row.enabled) throw new NotFoundError('Invalid push token');
      const report = pushPayloadSchema.parse(request.body ?? {});
      const rules = repo.listRuleDtos(ctx.db, row.id);
      const result = executePushReport(ctx, row, rules, report);
      return {
        ok: true,
        status: result.status,
        metrics: result.metrics,
        evaluations: result.evaluations,
        error: result.error,
        receivedAt: new Date().toISOString(),
      };
    },
  );
}

export function createMonitorModule(ctx: ModuleContext): MonitorModule {
  const scheduler = new MonitorScheduler(ctx);
  return {
    registerRoutes(app: FastifyInstance) {
      registerMonitorRoutes(app, ctx, scheduler);
    },
    start() {
      scheduler.start();
    },
    async stop() {
      await scheduler.stop();
    },
    kick() {
      scheduler.kick();
    },
  };
}
