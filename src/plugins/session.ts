import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { prisma } from './prisma.js';

declare module 'fastify' {
  interface FastifyRequest {
    verifySession: () => Promise<void>;
  }
}

export default fp(async function (app: FastifyInstance) {
  app.decorateRequest('verifySession', async function (this: any) {
    await this.jwtVerify();
    const userId = this.user?.id as string | undefined;
    if (!userId) throw new Error('Unauthorized');

    // fetch tokenVersion and compare to token's tokenVersion claim if present
    let user: any = null;
    try {
      user = await (prisma as any).user.findUnique({ where: { id: userId }, select: { tokenVersion: true } });
    } catch (err: any) {
      // If the tokenVersion column doesn't exist yet (Prisma P2022), treat as version 0
      if (err && err.code === 'P2022') {
        user = { tokenVersion: 0 };
      } else {
        throw err;
      }
    }

    const tokenVersionClaim = (this.user && this.user.tokenVersion) || 0;
    if (user && typeof user.tokenVersion === 'number' && tokenVersionClaim !== user.tokenVersion) {
      throw new Error('Session invalidated');
    }
  });
});
