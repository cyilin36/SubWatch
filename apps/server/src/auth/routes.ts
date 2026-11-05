import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  COOKIE_NAME,
  changePasswordSchema,
  loginSchema,
  setupSchema,
  type AuthStatusDto,
} from '@subwatch/shared';
import type { CoreContext } from '../context.js';
import { AppError, ConflictError, UnauthorizedError } from '../lib/errors.js';
import { createRequireAuth } from './guard.js';
import { createSession, deleteAllSessions, deleteSession, getValidSession } from './session.js';

function isSecure(request: FastifyRequest): boolean {
  return request.protocol === 'https';
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: string, secure: boolean): void {
  reply.setCookie(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    expires: new Date(expiresAt),
  });
}

function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(COOKIE_NAME, { path: '/', httpOnly: true, sameSite: 'lax', secure });
}

function sessionMeta(request: FastifyRequest): { userAgent: string | null; ip: string | null } {
  const userAgent = request.headers['user-agent'];
  return {
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
    ip: request.ip,
  };
}


/**
 * Direct port access is the default deployment. Capture the origin the admin
 * actually used so notification deep links work without any domain/HTTPS
 * configuration. Existing explicit (non-loopback) base URLs are never replaced.
 */
function maybeDetectBaseUrl(ctx: CoreContext, request: FastifyRequest): void {
  const host = request.headers.host;
  if (!host || !/^[A-Za-z0-9.\-:\[\]]+$/.test(host)) return;
  const origin = `${request.protocol}://${host}`;
  const current = ctx.settings.getGeneral().baseUrl;
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  if (!current || (loopback.test(host) === false && loopback.test(current.replace(/^https?:\/\//, '')))) {
    ctx.settings.updateGeneral({ baseUrl: origin });
  }
}

export async function registerAuthRoutes(app: FastifyInstance, ctx: CoreContext): Promise<void> {
  const requireAuth = createRequireAuth(ctx);

  app.get('/api/auth/status', async (request): Promise<AuthStatusDto> => {
    const token = request.cookies[COOKIE_NAME];
    const authenticated = Boolean(token && getValidSession(ctx.db, token));
    return { setupRequired: ctx.settings.isSetupRequired(), authenticated };
  });

  app.post(
    '/api/auth/setup',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!ctx.settings.isSetupRequired()) {
        throw new ConflictError('SubWatch is already initialized');
      }
      const body = setupSchema.parse(request.body);
      ctx.settings.setPassword(body.password);
      maybeDetectBaseUrl(ctx, request);
      const session = createSession(ctx.db, sessionMeta(request));
      setSessionCookie(reply, session.token, session.expiresAt, isSecure(request));
      ctx.logger.info('admin password initialized');
      return { setupRequired: false, authenticated: true } satisfies AuthStatusDto;
    },
  );

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      if (ctx.settings.isSetupRequired()) {
        throw new AppError(409, 'setup_required', 'Initial admin password has not been configured');
      }
      const body = loginSchema.parse(request.body);
      if (!ctx.settings.verifyAdminPassword(body.password)) {
        ctx.logger.warn({ ip: request.ip }, 'failed admin login attempt');
        throw new UnauthorizedError('Invalid password');
      }
      maybeDetectBaseUrl(ctx, request);
      const session = createSession(ctx.db, sessionMeta(request));
      setSessionCookie(reply, session.token, session.expiresAt, isSecure(request));
      return { setupRequired: false, authenticated: true } satisfies AuthStatusDto;
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[COOKIE_NAME];
    if (token) deleteSession(ctx.db, token);
    clearSessionCookie(reply, isSecure(request));
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (): Promise<AuthStatusDto> => {
    return { setupRequired: false, authenticated: true };
  });

  app.post('/api/auth/password', { preHandler: requireAuth }, async (request, reply) => {
    const body = changePasswordSchema.parse(request.body);
    if (!ctx.settings.verifyAdminPassword(body.currentPassword)) {
      throw new UnauthorizedError('Current password is incorrect');
    }
    ctx.settings.setPassword(body.newPassword);
    deleteAllSessions(ctx.db);
    const session = createSession(ctx.db, sessionMeta(request));
    setSessionCookie(reply, session.token, session.expiresAt, isSecure(request));
    ctx.logger.info('admin password changed; all sessions invalidated');
    return { ok: true };
  });
}
