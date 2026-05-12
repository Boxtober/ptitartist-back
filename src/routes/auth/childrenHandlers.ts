import type { FastifyInstance } from 'fastify';
import { prisma } from '../../plugins/prisma.js';
import { z } from 'zod';

const createChildSchema = z.object({ firstName: z.string().min(1), birthDate: z.string().optional(), avatarUrl: z.string().url().optional(), color: z.string().optional() });
const updateChildSchema = z.object({ firstName: z.string().min(1).optional(), birthDate: z.string().optional(), avatarUrl: z.string().url().nullable().optional(), color: z.string().optional() });

export default async function childrenHandlers(app: FastifyInstance) {
  app.get('/children', async (request, reply) => {
    await (request as any).verifySession();
    const { id } = (request as any).user as { id: string };
    const children = await (prisma as any).child.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' } });
    return reply.send(children);
  });

  app.post('/children', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id: userId } = (request as any).user as { id: string };
      const result = createChildSchema.safeParse(request.body);
      if (!result.success) return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });
      const created = await (prisma as any).child.create({ data: { ...result.data, userId } });
      return reply.status(201).send(created);
    } catch (err: any) { console.error('Create child error:', err); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  app.put('/children/:id', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id: childId } = request.params as { id: string };
      const { id: userId } = (request as any).user as { id: string };
      const existing = await (prisma as any).child.findUnique({ where: { id: childId } });
      if (!existing) return reply.status(404).send({ error: 'Child not found' });
      if (existing.userId !== userId) return reply.status(403).send({ error: 'Forbidden' });
      const result = updateChildSchema.safeParse(request.body);
      if (!result.success) return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });
      const updated = await (prisma as any).child.update({ where: { id: childId }, data: result.data });
      return reply.send(updated);
    } catch (err: any) { console.error('Update child error:', err); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  app.delete('/children/:id', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id: childId } = request.params as { id: string };
      const { id: userId } = (request as any).user as { id: string };
      const existing = await (prisma as any).child.findUnique({ where: { id: childId } });
      if (!existing) return reply.status(404).send({ error: 'Child not found' });
      if (existing.userId !== userId) return reply.status(403).send({ error: 'Forbidden' });
      await (prisma as any).image.updateMany({ where: { childId }, data: { childId: null } });
      await (prisma as any).child.delete({ where: { id: childId } });
      return reply.send({ success: true });
    } catch (err: any) { console.error('Delete child error:', err); return reply.status(500).send({ error: 'Internal server error' }); }
  });
}
