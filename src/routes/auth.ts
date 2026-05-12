import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../plugins/prisma.js';
import authService from '../services/authService.js';
import mailer from '../services/mailer.js';
import { sanitizeString } from '../utils/sanitize.js';
import { sanitizeFilename, isAllowedImage } from '../utils/fileUtils.js';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { PassThrough } from 'stream';
import archiver from 'archiver';

// Zod schemas
const createChildSchema = z.object({
  firstName: z.string().min(1),
  birthDate: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  color: z.string().optional(),
});

const updateChildSchema = z.object({
  firstName: z.string().min(1).optional(),
  birthDate: z.string().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  color: z.string().optional(),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  age: z.coerce.number().optional(),
  avatarUrl: z.string().optional(),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(128).optional(),
  lastName: z.string().min(1).max(128).optional(),
  age: z.number().int().min(0).optional(),
  avatarUrl: z.string().url().optional(),
});

const changeEmailSchema = z.object({
  currentPassword: z.string().min(1),
  newEmail: z.string().email(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

const settingsSchema = z.object({
  isPrivateProfile: z.boolean().optional(),
  emailReminders: z.boolean().optional(),
  autoBackup: z.boolean().optional(),
});

export async function authRoutes(app: FastifyInstance) {
  const fastify = app as any;

  // ─── Auth ────────────────────────────────────────────────────────────────

  app.post('/register', async (request, reply) => {
    const result = registerSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });
    }
    const { email, password, firstName, lastName, age, avatarUrl } = result.data;

    const userExists = await (prisma as any).user.findUnique({ where: { email } });
    if (userExists) return reply.status(400).send({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        age: age ?? null,
        avatarUrl: avatarUrl ?? null,
      },
    });

    const { password: _pw, ...userWithoutPassword } = user;
    return reply.status(201).send(userWithoutPassword);
  });

  app.post('/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };

    const user = await (prisma as any).user.findUnique({ where: { email } });
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' });

    const token = fastify.jwt.sign({ id: user.id, tokenVersion: (user as any).tokenVersion ?? 0 });
    return reply.send({ token });
  });

  // ─── Profile ─────────────────────────────────────────────────────────────

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

      const result = updateProfileSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });
      }

      const safeData: any = { ...result.data };
      if (typeof safeData.firstName === 'string') safeData.firstName = sanitizeString(safeData.firstName, 128);
      if (typeof safeData.lastName === 'string') safeData.lastName = sanitizeString(safeData.lastName, 128);

      const updated = await (prisma as any).user.update({
        where: { id },
        data: safeData,
        select: { id: true, email: true, firstName: true, lastName: true, age: true, avatarUrl: true },
      });

      return reply.send(updated);
    } catch (err) {
      console.error(err);
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
      if (!mimetype || !ALLOWED_MIMES.includes(mimetype)) {
        try { (data as any).file.resume(); } catch (e) {}
        return reply.status(400).send({ error: 'Invalid file type' });
      }

      const uploadsDir = path.join(process.cwd(), 'uploads');
      await fs.promises.mkdir(uploadsDir, { recursive: true });
      const safeOriginal = sanitizeFilename(data.filename);
      if (!isAllowedImage(safeOriginal)) return reply.status(400).send({ error: 'Invalid file extension' });
      const filename = `${Date.now()}-${safeOriginal}`;
      const localPath = path.join(uploadsDir, filename);

      const pass = new PassThrough();
      let bytes = 0;
      let aborted = false;
      pass.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_AVATAR_BYTES && !aborted) {
          aborted = true;
          pass.destroy(new Error('FILE_TOO_LARGE'));
        }
      });

      try {
        await pipeline((data as any).file, pass, fs.createWriteStream(localPath));
      } catch (err: any) {
        try { await fs.promises.unlink(localPath).catch(() => {}); } catch {}
        if (err && err.message === 'FILE_TOO_LARGE') {
          return reply.status(413).send({ error: 'File too large. Max 2MB.' });
        }
        console.error('Upload pipeline error:', err);
        return reply.status(500).send({ error: 'Internal server error during avatar upload' });
      }

  const user = await (prisma as any).user.findUnique({ where: { id }, select: { avatarUrl: true } });
      if (user && user.avatarUrl) {
        try {
          let prevFilename: string | null = null;
          try {
            const parsed = new URL(user.avatarUrl);
            prevFilename = path.basename(parsed.pathname);
          } catch (e) {
            const idx = user.avatarUrl.indexOf('/uploads/');
            if (idx >= 0) prevFilename = user.avatarUrl.slice(idx + '/uploads/'.length);
          }
          if (prevFilename) {
            const prevPath = path.join(process.cwd(), 'uploads', prevFilename);
            await fs.promises.unlink(prevPath).catch(() => {});
          }
        } catch (err) {
          console.error('Error removing previous avatar:', err);
        }
      }

  const base = process.env.BASE_URL ?? 'http://localhost:3000';
  const url = `${base}/uploads/${filename}`;
  const updated = await (prisma as any).user.update({ where: { id }, data: { avatarUrl: url } });
      const { password: _pw, ...userWithoutPw } = updated as any;
      return reply.send(userWithoutPw);
    } catch (err: any) {
      console.error('Avatar upload error:', err);
      // Development helper: include message and stack to assist debugging
      return reply.status(500).send({ error: 'Internal server error during avatar upload', message: err?.message, stack: err?.stack });
    }
  });

  app.delete('/profile/avatar', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id } = (request as any).user as { id: string };
  const user = await (prisma as any).user.findUnique({ where: { id }, select: { avatarUrl: true } });
      if (!user) return reply.status(404).send({ error: 'User not found' });
      if (!user.avatarUrl) return reply.send({ success: true });

      try {
        let prevFilename: string | null = null;
        try {
          const parsed = new URL(user.avatarUrl);
          prevFilename = path.basename(parsed.pathname);
        } catch (e) {
          const idx = user.avatarUrl.indexOf('/uploads/');
          if (idx >= 0) prevFilename = user.avatarUrl.slice(idx + '/uploads/'.length);
        }
        if (prevFilename) {
          const prevPath = path.join(process.cwd(), 'uploads', prevFilename);
          await fs.promises.unlink(prevPath).catch(() => {});
        }
      } catch (err) {
        console.error('Error removing avatar file:', err);
      }

      const updated = await (prisma as any).user.update({ where: { id }, data: { avatarUrl: null } });
      const { password: _pw, ...userWithoutPw } = updated as any;
      return reply.send({ success: true, user: userWithoutPw });
    } catch (err: any) {
      console.error('Delete avatar error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.post('/profile/change-email', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id } = (request as any).user as { id: string };
      const parsed = changeEmailSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });

      const { currentPassword, newEmail } = parsed.data;
  const user = await (prisma as any).user.findUnique({ where: { id }, select: { password: true } });
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) return reply.status(401).send({ error: 'Invalid current password' });

  const exists = await (prisma as any).user.findUnique({ where: { email: newEmail }, select: { id: true } });
      if (exists) return reply.status(400).send({ error: 'Email already in use' });

      const safeEmail = sanitizeString(newEmail, 254);
      const updated = await (prisma as any).user.update({ where: { id }, data: { email: safeEmail } });
      const { password: _pw, ...userWithoutPw } = updated as any;
      return reply.send({ success: true, user: userWithoutPw });
    } catch (err: any) {
      console.error('Change email error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.post('/profile/change-password', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id } = (request as any).user as { id: string };
      const parsed = changePasswordSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });

      const { currentPassword, newPassword } = parsed.data;
      const user = await (prisma as any).user.findUnique({ where: { id } });
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) return reply.status(401).send({ error: 'Invalid current password' });

      const hashed = await bcrypt.hash(newPassword, 10);
      await (prisma as any).user.update({ where: { id }, data: { password: hashed } });

      return reply.send({ success: true });
    } catch (err: any) {
      console.error('Change password error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.post('/profile/request-email-change', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id } = (request as any).user as { id: string };
      const parsed = z.object({ newEmail: z.string().email(), currentPassword: z.string().min(1) }).safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });

      const { newEmail, currentPassword } = parsed.data;
  const user: any = await (prisma as any).user.findUnique({ where: { id }, select: { password: true } });
      if (!user) return reply.status(404).send({ error: 'User not found' });

      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) return reply.status(401).send({ error: 'Invalid current password' });

      const exists = await (prisma as any).user.findUnique({ where: { email: newEmail } });
      if (exists) return reply.status(400).send({ error: 'Email already in use' });

      const { token, expires } = await authService.createEmailChangeRequest(id, newEmail, 60);

      const confirmUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/confirm-email?token=${encodeURIComponent(token)}`;
      const html = `<p>Bonjour,</p><p>Pour confirmer votre nouveau e‑mail <strong>${newEmail}</strong>, cliquez sur le lien suivant :</p><p><a href="${confirmUrl}">Confirmer mon e‑mail</a></p><p>Ce lien expire le ${expires.toISOString()}.</p>`;
      try { await mailer.sendEmail(newEmail, 'Confirmez votre e‑mail', html); } catch (e) { console.error('Mailer error', e); }

      return reply.send({ success: true, expires });
    } catch (err: any) {
      console.error('Request email change error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.get('/profile/confirm-email', async (request, reply) => {
    try {
      const q = request.query as { token?: string };
      if (!q.token) return reply.status(400).send({ error: 'Token required' });

      const updated = await authService.confirmEmailChange(q.token);
      if (!updated) return reply.status(400).send({ error: 'Invalid or expired token' });

      await authService.incrementTokenVersion(updated.id);

      return reply.send({ success: true, userId: updated.id, email: updated.email });
    } catch (err: any) {
      console.error('Confirm email error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Children ─────────────────────────────────────────────────────────────

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
    } catch (err: any) {
      console.error('Create child error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
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
    } catch (err: any) {
      console.error('Update child error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
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
    } catch (err: any) {
      console.error('Delete child error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Account ──────────────────────────────────────────────────────────────

  app.delete('/me', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id } = (request as any).user as { id: string };

      const images = await (prisma as any).image.findMany({ where: { userId: id } });
      for (const img of images) {
        try {
          let pathname: string | null = null;
          try {
            const parsed = new URL(img.url);
            pathname = parsed.pathname;
          } catch (e) {
            const idx = img.url.indexOf('/uploads/');
            if (idx >= 0) pathname = img.url.slice(idx);
          }
          if (pathname) {
            const filename = path.basename(pathname);
            const filePath = path.join(process.cwd(), 'uploads', filename);
            try {
              await fs.promises.unlink(filePath);
            } catch (err: any) {
              if (err.code !== 'ENOENT') console.error('Error removing user file:', err);
            }
          }
        } catch (err) {
          console.error('Error while removing one of user files:', err);
        }
      }

      await (prisma as any).image.deleteMany({ where: { userId: id } });
      await (prisma as any).user.delete({ where: { id } });

      return reply.send({ success: true });
    } catch (err: any) {
      console.error('Error deleting account:', err);
      return reply.status(500).send({ error: 'Internal server error while deleting account', message: err?.message });
    }
  });

  // ─── Favorites ────────────────────────────────────────────────────────────

  app.post('/images/:id/favorite', async (request, reply) => {
    await (request as any).verifySession();
    const { id: imageId } = request.params as { id: string };
    const { id: userId } = (request as any).user as { id: string };

    const image = await (prisma as any).image.findUnique({ where: { id: imageId } });
    if (!image) return reply.status(404).send({ error: 'Image not found' });

    try {
      const fav = await (prisma as any).favorite.create({ data: { userId, imageId } });
      return reply.status(201).send(fav);
    } catch (err: any) {
      return reply.status(400).send({ error: 'Already favorited' });
    }
  });

  app.delete('/images/:id/favorite', async (request, reply) => {
    await (request as any).verifySession();
    const { id: imageId } = request.params as { id: string };
    const { id: userId } = (request as any).user as { id: string };

    await (prisma as any).favorite.deleteMany({ where: { userId, imageId } });
    return reply.send({ success: true });
  });

  // ─── Settings ─────────────────────────────────────────────────────────────

  app.get('/settings', async (request, reply) => {
    await (request as any).verifySession();
    const { id } = (request as any).user as { id: string };
    const user = await (prisma as any).user.findUnique({
      where: { id },
      select: { isPrivateProfile: true, emailReminders: true, autoBackup: true },
    });
    return reply.send(user ?? {});
  });

  app.put('/settings', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id } = (request as any).user as { id: string };
      const parsed = settingsSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
      const updated = await (prisma as any).user.update({ where: { id }, data: parsed.data });
      return reply.send({
        success: true,
        settings: {
          isPrivateProfile: updated.isPrivateProfile,
          emailReminders: updated.emailReminders,
          autoBackup: updated.autoBackup,
        },
      });
    } catch (err: any) {
      console.error('Update settings error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ─── Export ───────────────────────────────────────────────────────────────

  app.post('/export', async (request, reply) => {
    try {
      await (request as any).verifySession();
      const { id: userId } = (request as any).user as { id: string };

      const images = await (prisma as any).image.findMany({ where: { userId } });

      reply.raw.setHeader('Content-Type', 'application/zip');
      reply.raw.setHeader('Content-Disposition', `attachment; filename="ptitartist-${userId}.zip"`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err: Error) => {
        console.error('Archive error:', err);
        try { reply.raw.end(); } catch (e) {}
      });
      archive.pipe(reply.raw);

      for (const img of images) {
        try {
          let pathname: string | null = null;
          try {
            const parsed = new URL(img.url);
            pathname = parsed.pathname;
          } catch (e) {
            const idx = img.url.indexOf('/uploads/');
            if (idx >= 0) pathname = img.url.slice(idx);
          }
          if (!pathname) continue;
          const filename = path.basename(pathname);
          const filePath = path.join(process.cwd(), 'uploads', filename);
          if (fs.existsSync(filePath)) {
            archive.file(filePath, { name: filename });
          }
        } catch (err) {
          console.error('Error adding file to archive:', err);
        }
      }

      await archive.finalize();
    } catch (err: any) {
      console.error('Export error:', err);
      return reply.status(500).send({ error: 'Internal server error during export' });
    }
  });
}