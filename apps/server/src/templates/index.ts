import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  TEMPLATE_EXPORT_FORMAT,
  TEMPLATE_EXPORT_VERSION,
  templateExportEnvelopeSchema,
  templateGitImportInputSchema,
  templateGitPreviewInputSchema,
  templateInputSchema,
  templateKindSchema,
  type TemplateDto,
  type TemplateGitImportResultDto,
  type TemplateGitPreviewDto,
  type TemplateSummaryDto,
} from '@subwatch/shared';
import type { CoreContext } from '../context.js';
import { createRequireAuth } from '../auth/guard.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { nowIso } from '../db/helpers.js';
import {
  createTemplate,
  deleteTemplate,
  getTemplateById,
  listTemplateSummaries,
  updateTemplate,
} from './repository.js';
import {
  importGitTemplates,
  previewGitTemplates,
  updateTemplateFromSource,
} from './git/import.js';
import { renderTemplate } from './render.js';

const idParamsSchema = z.object({ id: z.string().min(1).max(64) });
const listQuerySchema = z.object({ kind: templateKindSchema.optional() });
const renderInputSchema = z.object({ values: z.record(z.unknown()).default({}) });

function requireTemplate(ctx: CoreContext, id: string): TemplateDto {
  const template = getTemplateById(ctx, id);
  if (!template) throw new NotFoundError('Template not found');
  return template;
}

export function registerTemplateRoutes(app: FastifyInstance, ctx: CoreContext): void {
  const requireAuth = createRequireAuth(ctx);

  app.get('/api/templates', { preHandler: requireAuth }, async (request): Promise<TemplateSummaryDto[]> => {
    const query = listQuerySchema.parse(request.query ?? {});
    return listTemplateSummaries(ctx, query.kind);
  });

  app.post('/api/templates', { preHandler: requireAuth }, async (request, reply): Promise<TemplateDto> => {
    const input = templateInputSchema.parse(request.body ?? {});
    const created = createTemplate(ctx, input);
    reply.code(201);
    return created;
  });

  app.post(
    '/api/templates/import',
    { preHandler: requireAuth },
    async (request, reply): Promise<TemplateDto> => {
      const envelope = templateExportEnvelopeSchema.parse(request.body ?? {});
      const created = createTemplate(ctx, envelope.template);
      reply.code(201);
      return created;
    },
  );

  // Static git import routes are registered before the `/:id` routes for clarity;
  // they do not conflict because Fastify matches static segments first.
  app.post(
    '/api/templates/git/preview',
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request): Promise<TemplateGitPreviewDto> => {
      const body = templateGitPreviewInputSchema.parse(request.body ?? {});
      return previewGitTemplates(ctx, body);
    },
  );

  app.post(
    '/api/templates/git/import',
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply): Promise<TemplateGitImportResultDto> => {
      const body = templateGitImportInputSchema.parse(request.body ?? {});
      const result = await importGitTemplates(ctx, body);
      reply.code(201);
      return result;
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/templates/:id',
    { preHandler: requireAuth },
    async (request): Promise<TemplateDto> => {
      const { id } = idParamsSchema.parse(request.params);
      return requireTemplate(ctx, id);
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/templates/:id',
    { preHandler: requireAuth },
    async (request): Promise<TemplateDto> => {
      const { id } = idParamsSchema.parse(request.params);
      const existing = requireTemplate(ctx, id);
      const input = templateInputSchema.parse(request.body ?? {});
      if (input.kind !== existing.kind) {
        throw new BadRequestError('A template kind cannot be changed after creation');
      }
      const updated = updateTemplate(ctx, id, input);
      if (!updated) throw new NotFoundError('Template not found');
      return updated;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/templates/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = idParamsSchema.parse(request.params);
      requireTemplate(ctx, id);
      if (!deleteTemplate(ctx, id)) throw new NotFoundError('Template not found');
      reply.code(204);
      return reply.send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/templates/:id/update-from-source',
    { preHandler: requireAuth },
    async (request): Promise<TemplateDto> => {
      const { id } = idParamsSchema.parse(request.params);
      return updateTemplateFromSource(ctx, id);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/templates/:id/export',
    { preHandler: requireAuth },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const template = requireTemplate(ctx, id);
      return {
        format: TEMPLATE_EXPORT_FORMAT,
        version: TEMPLATE_EXPORT_VERSION,
        exportedAt: nowIso(),
        template: {
          kind: template.kind,
          name: template.name,
          description: template.description,
          icon: template.icon,
          color: template.color,
          category: template.category,
          version: template.version,
          fields: template.fields,
          payload: template.payload,
        },
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/templates/:id/render',
    { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request) => {
      const { id } = idParamsSchema.parse(request.params);
      const body = renderInputSchema.parse(request.body ?? {});
      return renderTemplate(ctx, id, body.values);
    },
  );
}
