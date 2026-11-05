import type { CoreContext } from '../context.js';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: CoreContext;
  }
}

export {};
