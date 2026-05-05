import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../plugins/prisma.js';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import archiver from 'archiver';

// Zod schemas for children and image uploads
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

const uploadSchema = z.object({
  description: z.string().optional(),
  childId: z.string().uuid().optional(),
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
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  age: z.number().int().min(0).optional(),
  avatarUrl: z.string().url().optional(),
});

export async function authRoutes(app: FastifyInstance) {

  const fastify = app as any;
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

    const token = fastify.jwt.sign({ id: user.id });
    return reply.send({ token });
  });

  app.get('/me', async (request, reply) => {
    try {
      await (request as any).jwtVerify();
      const { id } = (request as any).user as { id: string };
  const user = await (prisma as any).user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          createdAt: true,
          firstName: true,
          lastName: true,
          age: true,
          avatarUrl: true,
        },
      });
      return reply.send(user);
    } catch {
      return reply.status(401).send({ error: 'Non autorisé' });
    }
  });

  app.put('/profile', async (request, reply) => {
    try {
      await (request as any).jwtVerify();
      const { id } = (request as any).user as { id: string };

      const result = updateProfileSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });
      }

  const updated = await (prisma as any).user.update({
        where: { id },
        data: result.data as any,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          age: true,
          avatarUrl: true,
        },
      });

      return reply.send(updated);
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.post('/upload', async (request, reply) => {
    try {
      await (request as any).jwtVerify();
      const { id: userId } = (request as any).user as { id: string };

      const data = await (request as any).file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });

      // read optional fields: prefer multipart field, then header, then query
      let description: string | undefined;
      let childId: string | undefined;
      try {
        const body = request.body as any;
        if (body && typeof body.description === 'string') description = body.description;
        if (body && typeof body.childId === 'string') childId = body.childId;
      } catch (e) {}
      if (!description && typeof (request as any).headers['x-description'] === 'string') {
        description = (request as any).headers['x-description'];
      }
      if (!description && typeof (request as any).query?.description === 'string') {
        description = (request as any).query.description as string;
      }
      if (!childId && typeof (request as any).headers['x-child-id'] === 'string') {
        childId = (request as any).headers['x-child-id'];
      }
      if (!childId && typeof (request as any).query?.childId === 'string') {
        childId = (request as any).query.childId as string;
      }

      // validate optional fields
      const parsed = uploadSchema.safeParse({ description, childId });
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
      const { childId: parsedChildId } = parsed.data;

      // if childId provided, verify ownership
      if (parsedChildId) {
  const child = await (prisma as any).child.findUnique({ where: { id: parsedChildId } });
        if (!child || child.userId !== userId) return reply.status(403).send({ error: 'Child not found or forbidden' });
      }

      const filename = `${Date.now()}-${data.filename}`;
      const uploadsDir = path.join(process.cwd(), 'uploads');
      await fs.promises.mkdir(uploadsDir, { recursive: true });
      const localPath = path.join(uploadsDir, filename);

      await pipeline(data.file, fs.createWriteStream(localPath));

      const base = process.env.BASE_URL ?? 'http://localhost:3000';
      const image = await (prisma as any).image.create({
        data: { url: `${base}/uploads/${filename}`, userId, description, childId: parsedChildId ?? null },
      });

      return reply.status(201).send(image);
    } catch (err: any) {
      console.error('Upload error:', err);
      return reply.status(500).send({ error: 'Internal server error during upload', message: err?.message });
    }
  });

  // app.get('/images', async (request, reply) => {
  //   await (request as any).jwtVerify();
  //   const { id } = (request as any).user as { id: string };

  //     const images = await (prisma as any).image.findMany({
  //       where: { userId: id },
  //       orderBy: { createdAt: 'desc' },
  //       include: { child: { select: { id: true, firstName: true } } },
  //     });

  //   return reply.send(images);
  // });

  app.get('/images', async (request, reply) => {
  await (request as any).jwtVerify();
  const { id: userId } = (request as any).user as { id: string };

  const images = await (prisma as any).image.findMany({
    where: { userId }, // ta logique existante
    orderBy: { createdAt: 'desc' },
    include: {
      child: { select: { id: true, firstName: true } },
    },
  });

  // fetch favorites for this user for these images
  const imageIds = images.map((i: any) => i.id);
  const favorites = await (prisma as any).favorite.findMany({
    where: { userId, imageId: { in: imageIds } },
    select: { imageId: true }
  });
  const favoritesSet = new Set(favorites.map((f: any) => f.imageId));
  const imagesWithFlag = images.map((i: any) => ({ ...i, isFavorite: favoritesSet.has(i.id) }));

  return reply.send(imagesWithFlag);
});
  // CHILDREN CRUD
  app.get('/children', async (request, reply) => {
    await (request as any).jwtVerify();
    const { id } = (request as any).user as { id: string };
  const children = await (prisma as any).child.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' } });
    return reply.send(children);
  });

  app.post('/children', async (request, reply) => {
    try {
      await (request as any).jwtVerify();
      const { id: userId } = (request as any).user as { id: string };
      const result = createChildSchema.safeParse(request.body);
      if (!result.success) return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });

      const data = result.data;
  const created = await (prisma as any).child.create({ data: { ...data, userId } });
      return reply.status(201).send(created);
    } catch (err: any) {
      console.error('Create child error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.put('/children/:id', async (request, reply) => {
    try {
      await (request as any).jwtVerify();
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
      await (request as any).jwtVerify();
      const { id: childId } = request.params as { id: string };
      const { id: userId } = (request as any).user as { id: string };

      const existing = await (prisma as any).child.findUnique({ where: { id: childId } });
      if (!existing) return reply.status(404).send({ error: 'Child not found' });
      if (existing.userId !== userId) return reply.status(403).send({ error: 'Forbidden' });

      // Decide behavior: set childId null on images (as schema uses SetNull)
  await (prisma as any).image.updateMany({ where: { childId }, data: { childId: null } });
  await (prisma as any).child.delete({ where: { id: childId } });

      return reply.send({ success: true });
    } catch (err: any) {
      console.error('Delete child error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.delete('/me', async (request, reply) => {
    try {
      await (request as any).jwtVerify();
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
              if (err.code && err.code === 'ENOENT') {
     
              } else {
                console.error('Error removing user file:', err);
              }
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

  app.put('/images/:id', async (request, reply) => {
    await (request as any).jwtVerify();
    const { id: imageId } = request.params as { id: string };
    const { createdAt, description, childId } = request.body as { createdAt?: string; description?: string; childId?: string };

  const existing = await (prisma as any).image.findUnique({ where: { id: imageId } });
    if (!existing) return reply.status(404).send({ error: 'Image not found' });
    if (existing.userId !== (request as any).user.id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

      const dataToUpdate: any = {};
      if (createdAt) dataToUpdate.createdAt = new Date(createdAt);
      if (typeof description === 'string') dataToUpdate.description = description;
      if (typeof childId === 'string') {
        // validate child ownership or allow null to dissociate
        if (childId === '') {
          dataToUpdate.childId = null;
        } else {
            const child = await (prisma as any).child.findUnique({ where: { id: childId } });
            if (!child || child.userId !== (request as any).user.id) return reply.status(403).send({ error: 'Child not found or forbidden' });
          dataToUpdate.childId = childId;
        }
      }

      const updated = await prisma.image.update({
        where: { id: imageId },
        data: dataToUpdate,
      });

    return reply.send(updated);
  });
  // Reusable image deletion logic (used by /images/:id and alias /upload/:id)
  async function deleteImageById(imageId: string, request: any, reply: any) {
    await request.jwtVerify();

    const existing = await prisma.image.findUnique({ where: { id: imageId } });
    if (!existing) return reply.status(404).send({ error: 'Image not found' });
    if (existing.userId !== request.user.id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    try {
      let pathname: string | null = null;
      try {
        const parsed = new URL(existing.url);
        pathname = parsed.pathname;
      } catch (e) {
        const idx = existing.url.indexOf('/uploads/');
        if (idx >= 0) pathname = existing.url.slice(idx);
      }

      if (pathname) {
        const filename = path.basename(pathname);
        const filePath = path.join(process.cwd(), 'uploads', filename);
        try {
          await fs.promises.unlink(filePath);
        } catch (err: any) {
          if (err.code && err.code === 'ENOENT') {
            // already gone, ignore
          } else {
            console.error('Error removing file:', err);
          }
        }
      }
    } catch (err) {
      console.error('Error while attempting to remove image file:', err);
    }

    const deleted = await (prisma as any).image.delete({ where: { id: imageId } });
    return reply.send({ success: true, deleted });
  }
app.post('/images/:id/favorite', async (request, reply) => {
  await (request as any).jwtVerify();
  const { id: imageId } = request.params as { id: string };
  const { id: userId } = (request as any).user as { id: string };

  // Optionnel : vérifier que l'image existe
  const image = await (prisma as any).image.findUnique({ where: { id: imageId } });
  if (!image) return reply.status(404).send({ error: 'Image not found' });

  try {
    const fav = await (prisma as any).favorite.create({
      data: { userId, imageId },
    });
    return reply.status(201).send(fav);
  } catch (err: any) {
    // si unique constraint violée -> déjà favori
    return reply.status(400).send({ error: 'Already favorited' });
  }
});

app.delete('/images/:id/favorite', async (request, reply) => {
  await (request as any).jwtVerify();
  const { id: imageId } = request.params as { id: string };
  const { id: userId } = (request as any).user as { id: string };

  await (prisma as any).favorite.deleteMany({ where: { userId, imageId } });
  return reply.send({ success: true });
});
  // Keep original route
  app.delete('/images/:id', async (request, reply) => {
    const { id: imageId } = request.params as { id: string };
    return deleteImageById(imageId, request, reply);
  });

  // Alias for backwards-compatibility: some frontends call /upload/:id
  app.delete('/upload/:id', async (request, reply) => {
    const { id: imageId } = request.params as { id: string };
    return deleteImageById(imageId, request, reply);
  });

  // SETTINGS endpoints
  app.get('/settings', async (request, reply) => {
    await (request as any).jwtVerify();
    const { id } = (request as any).user as { id: string };
    const user = await (prisma as any).user.findUnique({ where: { id }, select: { isPrivateProfile: true, emailReminders: true, autoBackup: true } });
    return reply.send(user ?? {});
  });

  const settingsSchema = z.object({
    isPrivateProfile: z.boolean().optional(),
    emailReminders: z.boolean().optional(),
    autoBackup: z.boolean().optional(),
  });

  app.put('/settings', async (request, reply) => {
    try {
      await (request as any).jwtVerify();
      const { id } = (request as any).user as { id: string };
      const parsed = settingsSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
      const updated = await (prisma as any).user.update({ where: { id }, data: parsed.data });
      return reply.send({ success: true, settings: { isPrivateProfile: updated.isPrivateProfile, emailReminders: updated.emailReminders, autoBackup: updated.autoBackup } });
    } catch (err: any) {
      console.error('Update settings error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // EXPORT: zip all user's images and stream as attachment
  app.post('/export', async (request, reply) => {
    try {
      await (request as any).jwtVerify();
      const { id: userId } = (request as any).user as { id: string };

      const images = await (prisma as any).image.findMany({ where: { userId } });

      // stream zip
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
      // note: reply will end when archive stream finishes
    } catch (err: any) {
      console.error('Export error:', err);
      return reply.status(500).send({ error: 'Internal server error during export' });
    }
  });
}
