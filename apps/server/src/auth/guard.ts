import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { COOKIE_NAME } from '@subwatch/shared';
import type { CoreContext } from '../context.js';
import { UnauthorizedError } from '../lib/errors.js';
import { getValidSession } from './session.js';

/**
 * Fastify pre-handler that validates the session cookie and throws a 401 when
 * the request is not authenticated.
 */
export function createRequireAuth(ctx: CoreContext) {
  return async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const token = request.cookies[COOKIE_NAME];
    if (!token) throw new UnauthorizedError('Authentication required');
    const session = getValidSession(ctx.db, token);
    if (!session) throw new UnauthorizedError('Session expired or invalid');
  };
}

export type RequireAuth = ReturnType<typeof createRequireAuth>;

// Keep FastifyInstance in the type surface for callers that type route modules.
export type AuthFastifyInstance = FastifyInstance;

