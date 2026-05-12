import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    // verifySession added by src/plugins/session.ts
    verifySession: () => Promise<void>;
    // user populated after jwtVerify/verifySession
    user?: { id: string; tokenVersion?: number };
  }
}
