import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  templateSourceInputSchema,
  templateSourcePathsSchema,
  templateSourceSyncInputSchema,
  type TemplateSourceAvailableDto,
  type TemplateSourceDetailDto,
  type TemplateSourceDto,
  type TemplateSourceSyncResultDto,
} from '@subwatch/shared';
import type { CoreContext } from '../../context.js';
import { createRequireAuth } from '../../auth/guard.js';
import { NotFoundError } from '../../lib/errors.js';
import { deleteSourceTemplatesByPaths } from '../repository.js';
import {
  createTemplateSource,
  deleteTemplateSourceWithTemplates,
  getTemplateSource,
  getTemplateSourceDetail,
  listTemplateSources,
  updateTemplateSource,
} from './repository.js';
import { removeSourceDir } from './git.js';
import { previewTemplateSource, syncTemplateSource } from './sync.js';

const idParamsSchema = z.object({ id: z.string().min(1).max(64) });

export function registerTemplateSourceRoutes(app: FastifyInstance, ctx: CoreContext): void {
  const requireAuth = createRequireAuth(ctx);

  app.get('/api/template-sources', { preHandler: requireAuth }, async (): Promise<TemplateSourceDto[]> => {
    return listTemplateSources(ctx);
  });

  app.post('/api/template-sources', { preHandler: requireAuth }, async (request, reply): Promise<TemplateSourceDto> => {
    const input = templateSourceInputSchema.parse(request.body ?? {});
    const created = createTemplateSource(ctx, input);
    reply.code(201);
    return created;
  });

  app.get<{ Params: { id: string } }>(
    '/api/template-sources/:id',
    { preHandler: requireAuth },
    async (request): Promise<TemplateSourceDetailDto> => {
      const { id } = idParamsSchema.parse(request.params);
      const detail = getTemplateSourceDetail(ctx, id);
      if (!detail) throw new NotFoundError('Template source not found');
      return detail;
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/template-sources/:id',
    { preHandler: requireAuth },
    async (request): Promise<TemplateSourceDto> => {
      const { id } = idParamsSchema.parse(request.params);
      const input = templateSourceInputSchema.parse(request.body ?? {});
      const updated = updateTemplateSource(ctx, id, input);
      if (!updated) throw new NotFoundError('Template source not found');
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/template-sources/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      const removed = deleteTemplateSourceWithTemplates(ctx, id);
      if (!removed) throw new NotFoundError('Template source not found');
      // Best-effort removal of the local clone; never fail the request over it.
      try {
        removeSourceDir(ctx, id);
      } catch (error) {
        ctx.logger.warn({ err: error, sourceId: id }, 'failed to remove template source clone directory');
      }
      reply.code(204);
      return reply.send();
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/template-sources/:id/available',
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request): Promise<TemplateSourceAvailableDto> => {
      const { id } = idParamsSchema.parse(request.params);
      return previewTemplateSource(ctx, id);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/template-sources/:id/sync',
    { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request): Promise<TemplateSourceSyncResultDto> => {
      const { id } = idParamsSchema.parse(request.params);
      const body = templateSourceSyncInputSchema.parse(request.body ?? {});
      return syncTemplateSource(ctx, id, body.paths);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/template-sources/:id/uninstall',
    { preHandler: requireAuth },
    async (request): Promise<{ removed: number }> => {
      const { id } = idParamsSchema.parse(request.params);
      const { paths } = templateSourcePathsSchema.parse(request.body ?? {});
      const source = getTemplateSource(ctx, id);
      if (!source) throw new NotFoundError('Template source not found');
      const removed = deleteSourceTemplatesByPaths(ctx, id, paths);
      return { removed };
    },
  );
}
