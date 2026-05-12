import type { FastifyInstance } from 'fastify';
import { prisma } from '../../plugins/prisma.js';

export default async function favoritesHandlers(app: FastifyInstance) {
  app.post('/images/:id/favorite', async (request, reply) => {
    await (request as any).verifySession();
    const { id: imageId } = request.params as { id: string };
    const { id: userId } = (request as any).user as { id: string };
    const image = await (prisma as any).image.findUnique({ where: { id: imageId } });
    if (!image) return reply.status(404).send({ error: 'Image not found' });
    try { const fav = await (prisma as any).favorite.create({ data: { userId, imageId } }); return reply.status(201).send(fav); } catch (err: any) { return reply.status(400).send({ error: 'Already favorited' }); }
  });

  app.delete('/images/:id/favorite', async (request, reply) => {
    await (request as any).verifySession();
    const { id: imageId } = request.params as { id: string };
    const { id: userId } = (request as any).user as { id: string };
    await (prisma as any).favorite.deleteMany({ where: { userId, imageId } });
    return reply.send({ success: true });
  });
}
