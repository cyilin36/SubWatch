import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { APP_VERSION, type AppMeta } from '@subwatch/shared';
import type { AppModules, CoreContext } from './context.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerSettingsRoutes } from './api/settings.js';
import { registerTemplateRoutes } from './templates/index.js';
import { registerTemplateSourceRoutes } from './templates/sources/index.js';
import { AppError, ForbiddenError } from './lib/errors.js';

export async function buildApp(context: CoreContext, modules: AppModules): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: context.logger as unknown as FastifyBaseLogger,
    trustProxy: context.config.trustProxy,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.decorate('ctx', context);

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      // Do not merge Helmet's defaults: its default policy includes
      // `upgrade-insecure-requests`, which makes browsers silently rewrite
      // http://<lan-ip>:PORT/assets/*.js to https:// and leaves the SPA blank.
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    // Direct HTTP access on a LAN/NAS is the primary deployment. Never let a
    // browser cache an HSTS policy that would force HTTPS later.
    strictTransportSecurity: false,
    crossOriginEmbedderPolicy: false,
    // Ignored on plain-HTTP LAN origins and only produces console noise.
    crossOriginOpenerPolicy: false,
  });
  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
  });

  // CSRF hardening for cookie-authenticated mutations. The browser app always
  // sends this header; the push endpoint uses a bearer token and is exempt.
  app.addHook('onRequest', async (request) => {
    const method = request.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
    if (!request.url.startsWith('/api/')) return;
    if (request.url.startsWith('/api/push/')) return;
    if (request.headers['x-requested-with'] !== 'subwatch') {
      throw new ForbiddenError('Missing X-Requested-With: subwatch header');
    }
    const origin = request.headers.origin;
    if (origin) {
      if (origin === 'null') throw new ForbiddenError('Cross-origin request rejected');
      try {
        const originHost = new URL(origin).host;
        const requestHost = request.headers.host;
        if (requestHost && originHost !== requestHost) {
          throw new ForbiddenError('Cross-origin request rejected');
        }
      } catch (error) {
        if (error instanceof ForbiddenError) throw error;
        throw new ForbiddenError('Invalid Origin header');
      }
    }
  });

  // Never let a mobile browser keep a stale index.html/CSP after an upgrade.
  app.addHook('onSend', async (_request, reply, payload) => {
    const contentType = reply.getHeader('content-type');
    if (typeof contentType === 'string' && contentType.includes('text/html')) {
      reply.header('cache-control', 'no-cache, no-store, must-revalidate');
    }
    return payload;
  });

  const webIndex = path.join(context.config.webDir, 'index.html');
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({
        error: { code: 'not_found', message: `No API route for ${request.method} ${request.url}` },
      });
    }
    if (existsSync(webIndex)) {
      return reply.sendFile('index.html');
    }
    return reply
      .code(503)
      .type('text/plain; charset=utf-8')
      .send('SubWatch API is running, but the web UI has not been built yet. Run `pnpm build`.');
  });

  app.setErrorHandler((error: FastifyError | AppError | ZodError, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: error.flatten(),
        },
      });
    }
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, 'request failed');
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      });
    }
    const fastifyError = error as FastifyError;
    if (fastifyError.statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'too_many_requests', message: 'Too many requests, please slow down' },
      });
    }
    if (fastifyError.validation) {
      return reply.code(400).send({
        error: {
          code: 'validation_error',
          message: fastifyError.message,
          details: fastifyError.validation,
        },
      });
    }
    if (fastifyError.statusCode && fastifyError.statusCode < 500) {
      return reply.code(fastifyError.statusCode).send({
        error: { code: fastifyError.code ?? 'bad_request', message: fastifyError.message },
      });
    }
    request.log.error({ err: error }, 'unhandled request error');
    return reply.code(500).send({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  });

  app.get('/api/health', async () => {
    const row = context.db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
    return {
      ok: Number(row?.ok ?? 0) === 1,
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  app.get('/api/meta', async (): Promise<AppMeta & { setupRequired: boolean }> => {
    const general = context.settings.getGeneral();
    return {
      version: APP_VERSION,
      locale: general.locale,
      timezone: general.timezone,
      appName: general.appName,
      baseUrl: context.settings.getBaseUrl(),
      setupRequired: context.settings.isSetupRequired(),
    };
  });

  await registerAuthRoutes(app, context);
  registerTemplateRoutes(app, context);
  registerTemplateSourceRoutes(app, context);
  modules.notifications.registerRoutes(app);
  modules.monitors.registerRoutes(app);
  modules.subscriptions.registerRoutes(app);
  await registerSettingsRoutes(app, context, modules);

  if (existsSync(context.config.webDir)) {
    await app.register(fastifyStatic, {
      root: context.config.webDir,
      prefix: '/',
      wildcard: false,
    });
  }

  return app;
}
