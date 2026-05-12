import type { FastifyInstance } from 'fastify';
import { pipeline } from 'stream/promises';
import fs from 'fs';
import path from 'path';
import { PassThrough } from 'stream';
import bcrypt from 'bcrypt';
import { prisma } from '../../plugins/prisma.js';
import { sanitizeString } from '../../utils/sanitize.js';

export default async function profileHandlers(app: FastifyInstance) {
  app.get('/me', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id } = (request as any).user as { id: string };
      const user = await (prisma as any).user.findUnique({
        where: { id },
        select: { id: true, email: true, createdAt: true, firstName: true, lastName: true, age: true, avatarUrl: true },
      });
      return reply.send(user);
    } catch {
      return reply.status(401).send({ error: 'Non autorisé' });
    }
  });

  app.put('/profile', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id } = (request as any).user as { id: string };
      const safe = request.body as any;
      if (typeof safe.firstName === 'string') safe.firstName = sanitizeString(safe.firstName, 128);
      if (typeof safe.lastName === 'string') safe.lastName = sanitizeString(safe.lastName, 128);
      const updated = await (prisma as any).user.update({ where: { id }, data: safe, select: { id: true, email: true, firstName: true, lastName: true, age: true, avatarUrl: true } });
      return reply.send(updated);
    } catch (err: any) {
      console.error('Update profile error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.post('/profile/avatar', async (request, reply) => {
    const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
    const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
    try {
      await (request as any).verifySession();
      const { id } = (request as any).user as { id: string };
      const data = await (request as any).file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });
      const mimetype = (data as any).mimetype as string | undefined;
      if (!mimetype || !ALLOWED_MIMES.includes(mimetype)) { try { (data as any).file.resume(); } catch (e) {} return reply.status(400).send({ error: 'Invalid file type' }); }

      const uploadsDir = path.join(process.cwd(), 'uploads');
      await fs.promises.mkdir(uploadsDir, { recursive: true });
      const safeOriginal = (data as any).filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = `${Date.now()}-${safeOriginal}`;
      const localPath = path.join(uploadsDir, filename);

      const pass = new PassThrough();
      let bytes = 0; let aborted = false;
      pass.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_AVATAR_BYTES && !aborted) { aborted = true; pass.destroy(new Error('FILE_TOO_LARGE')); } });

      try { await pipeline((data as any).file, pass, fs.createWriteStream(localPath)); } catch (err: any) { try { await fs.promises.unlink(localPath).catch(() => {}); } catch {} if (err && err.message === 'FILE_TOO_LARGE') return reply.status(413).send({ error: 'File too large. Max 2MB.' }); console.error('Avatar pipeline error:', err); return reply.status(500).send({ error: 'Internal server error during avatar upload' }); }

      // remove previous avatar file if exist
      const user = await (prisma as any).user.findUnique({ where: { id }, select: { avatarUrl: true } });
      if (user && user.avatarUrl) {
        try {
          let prevFilename: string | null = null;
          try { const parsed = new URL(user.avatarUrl); prevFilename = path.basename(parsed.pathname); } catch (e) { const idx = user.avatarUrl.indexOf('/uploads/'); if (idx >= 0) prevFilename = user.avatarUrl.slice(idx + '/uploads/'.length); }
          if (prevFilename) await fs.promises.unlink(path.join(process.cwd(), 'uploads', prevFilename)).catch(() => {});
        } catch (err) { console.error('Error removing previous avatar:', err); }
      }

      const base = process.env.BASE_URL ?? 'http://localhost:3000';
      const url = `${base}/uploads/${filename}`;
      const updated = await (prisma as any).user.update({ where: { id }, data: { avatarUrl: url } });
      const { password: _pw, ...userWithoutPw } = updated as any;
      return reply.send(userWithoutPw);
    } catch (err: any) {
      console.error('Avatar upload error:', err);
      return reply.status(500).send({ error: 'Internal server error during avatar upload', message: err?.message });
    }
  });

  app.delete('/profile/avatar', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id } = (request as any).user as { id: string };
      const user = await (prisma as any).user.findUnique({ where: { id }, select: { avatarUrl: true } });
      if (!user) return reply.status(404).send({ error: 'User not found' });
      if (!user.avatarUrl) return reply.send({ success: true });
      try { let prevFilename: string | null = null; try { const parsed = new URL(user.avatarUrl); prevFilename = path.basename(parsed.pathname); } catch (e) { const idx = user.avatarUrl.indexOf('/uploads/'); if (idx >= 0) prevFilename = user.avatarUrl.slice(idx + '/uploads/'.length); } if (prevFilename) await fs.promises.unlink(path.join(process.cwd(), 'uploads', prevFilename)).catch(() => {}); } catch (err) { console.error('Error removing avatar file:', err); }
      const updated = await (prisma as any).user.update({ where: { id }, data: { avatarUrl: null } });
      const { password: _pw, ...userWithoutPw } = updated as any;
      return reply.send({ success: true, user: userWithoutPw });
    } catch (err: any) { console.error('Delete avatar error:', err); return reply.status(500).send({ error: 'Internal server error' }); }
  });

  // profile change email/password omitted here — handled in separate handlers
}
