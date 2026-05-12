import type { FastifyInstance } from 'fastify';
import { prisma } from '../../plugins/prisma.js';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';

export default async function settingsHandlers(app: FastifyInstance) {
  app.get('/settings', async (request, reply) => {
    await (request as any).verifySession();
    const { id } = (request as any).user as { id: string };
    const user = await (prisma as any).user.findUnique({ where: { id }, select: { isPrivateProfile: true, emailReminders: true, autoBackup: true } });
    return reply.send(user ?? {});
  });

  app.put('/settings', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id } = (request as any).user as { id: string };
      const parsed = request.body as any;
      const updated = await (prisma as any).user.update({ where: { id }, data: parsed });
      return reply.send({ success: true, settings: { isPrivateProfile: updated.isPrivateProfile, emailReminders: updated.emailReminders, autoBackup: updated.autoBackup } });
    } catch (err: any) { console.error('Update settings error:', err); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  app.post('/export', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id: userId } = (request as any).user as { id: string };
      const images = await (prisma as any).image.findMany({ where: { userId } });
      reply.raw.setHeader('Content-Type', 'application/zip');
      reply.raw.setHeader('Content-Disposition', `attachment; filename="ptitartist-${userId}.zip"`);
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err: Error) => { console.error('Archive error:', err); try { reply.raw.end(); } catch (e) {} });
      archive.pipe(reply.raw);
      for (const img of images) {
        try {
          let pathname: string | null = null;
          try { const parsed = new URL(img.url); pathname = parsed.pathname; } catch (e) { const idx = img.url.indexOf('/uploads/'); if (idx >= 0) pathname = img.url.slice(idx); }
          if (!pathname) continue; const filename = path.basename(pathname); const filePath = path.join(process.cwd(), 'uploads', filename);
          if (fs.existsSync(filePath)) archive.file(filePath, { name: filename });
        } catch (err) { console.error('Error adding file to archive:', err); }
      }
      await archive.finalize();
    } catch (err: any) { console.error('Export error:', err); return reply.status(500).send({ error: 'Internal server error during export' }); }
  });
}
