import type { FastifyInstance } from 'fastify';
import { pipeline } from 'stream/promises';
import fs from 'fs';
import path from 'path';
import { prisma } from '../plugins/prisma.js';
import { createImageRecord, listImagesForUser, deleteImage } from '../services/imageService.js';
import { z } from 'zod';
import { sanitizeString } from '../utils/sanitize.js';
import { sanitizeFilename, isAllowedImage } from '../utils/fileUtils.js';

export default async function imagesRoutes(app: FastifyInstance) {
  app.post('/upload', async (request, reply) => {
    let savedFilePath: string | null = null;

    try {
      await (request as any).verifySession();
      const { id: userId } = (request as any).user as { id: string };
      console.log('POST /upload: handler entered for user', userId);

      const fields: Record<string, string> = {};
      let fileMetadata: { filename: string } | null = null;

      const uploadsDir = path.join(process.cwd(), 'uploads');
      await fs.promises.mkdir(uploadsDir, { recursive: true });

      for await (const part of (request as any).parts()) {
        if (part.file) {
          if (!fileMetadata) {
            console.log('POST /upload: file part received, filename=', part.filename);

            const safeOriginal = sanitizeFilename(part.filename);
            if (!isAllowedImage(safeOriginal)) {
              part.file.resume();
              return reply.status(400).send({ error: 'Invalid file extension' });
            }

            const filename = `${Date.now()}-${safeOriginal}`;
            const localPath = path.join(uploadsDir, filename);

            // Consume the file stream immediately — this unblocks the iterator
            console.log('POST /upload: writing file to', localPath);
            await pipeline(part.file, fs.createWriteStream(localPath));
            console.log('POST /upload: file written');

            savedFilePath = localPath;
            fileMetadata = { filename };
          } else {
            // extra files: drain and ignore
            part.file.resume();
          }
        } else {
          // text field
          fields[part.fieldname] = part.value;
          console.log('POST /upload: field', part.fieldname, '=', part.value);
        }
      }

      console.log('POST /upload: finished reading all parts');

      if (!fileMetadata || !savedFilePath) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      // Extract optional fields
      let description: string | undefined = fields['description'];
      let childId: string | undefined = fields['childId'];
      let imageDescription: string | undefined = fields['imageDescription'];

      // Fallback to headers
      if (!description && typeof (request as any).headers['x-description'] === 'string') {
        description = (request as any).headers['x-description'];
      }
      if (!childId && typeof (request as any).headers['x-child-id'] === 'string') {
        childId = (request as any).headers['x-child-id'];
      }
      if (!imageDescription && typeof (request as any).headers['x-image-description'] === 'string') {
        imageDescription = (request as any).headers['x-image-description'];
      }

      // Coerce non-string fields (e.g. client may send a JSON object) to strings, then sanitize
      if (description != null && typeof description !== 'string') {
        try { description = JSON.stringify(description); } catch (e) { description = String(description); }
      }
      if (imageDescription != null && typeof imageDescription !== 'string') {
        try { imageDescription = JSON.stringify(imageDescription); } catch (e) { imageDescription = String(imageDescription); }
      }

      // Sanitize
      if (typeof description === 'string') description = sanitizeString(description, 512);
      if (typeof imageDescription === 'string') imageDescription = sanitizeString(imageDescription, 1024);

      const image = await createImageRecord(
        userId,
        fileMetadata.filename,
        description,
        childId ?? null,
        imageDescription ?? null,
      );
      console.log('POST /upload: image record created id=', image.id);

      return reply.status(201).send(image);
    } catch (err: any) {
      // Clean up saved file if DB write failed
      if (savedFilePath) {
        fs.promises.unlink(savedFilePath).catch(() => {});
      }
      console.error('Upload error:', err);
      return reply.status(500).send({ error: 'Internal server error during upload', message: err?.message });
    }
  });

  app.get('/images', async (request, reply) => {
    await (request as any).verifySession();
    const { id: userId } = (request as any).user as { id: string };

    const images = await listImagesForUser(userId);

    const imageIds = images.map((i: any) => i.id);
    const favorites = await (prisma as any).favorite.findMany({
      where: { userId, imageId: { in: imageIds } },
      select: { imageId: true },
    });
    const favoritesSet = new Set(favorites.map((f: any) => f.imageId));
    const imagesWithFlag = images.map((i: any) => ({ ...i, isFavorite: favoritesSet.has(i.id) }));

    return reply.send(imagesWithFlag);
  });

  app.put('/images/:id', async (request, reply) => {
    await (request as any).verifySession();
    const { id: imageId } = request.params as { id: string };

    const bodySchema = z.object({
      createdAt: z.string().optional(),
      description: z.string().max(512).optional(),
      imageDescription: z.string().max(1024).optional(),
      childId: z.string().uuid().optional().or(z.literal('')),
    }).strict();

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    const { createdAt, description, childId, imageDescription } = parsed.data;

    const existing = await (prisma as any).image.findUnique({ where: { id: imageId } });
    if (!existing) return reply.status(404).send({ error: 'Image not found' });
    if (existing.userId !== (request as any).user.id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const dataToUpdate: any = {};
    if (createdAt) dataToUpdate.createdAt = new Date(createdAt);
    if (typeof description === 'string') dataToUpdate.description = sanitizeString(description, 512);
    if (typeof childId === 'string') {
      if (childId === '') {
        dataToUpdate.childId = null;
      } else {
        const child = await (prisma as any).child.findUnique({ where: { id: childId } });
        if (!child || child.userId !== (request as any).user.id) {
          return reply.status(403).send({ error: 'Child not found or forbidden' });
        }
        dataToUpdate.childId = childId;
      }
    }
    if (typeof imageDescription === 'string') {
      dataToUpdate.imageDescription = sanitizeString(imageDescription, 1024);
    }

    const updated = await prisma.image.update({ where: { id: imageId }, data: dataToUpdate });
    return reply.send(updated);
  });

  app.delete('/images/:id', async (request, reply) => {
    await (request as any).verifySession();
    const { id: imageId } = request.params as { id: string };
    const { id: userId } = (request as any).user as { id: string };

    try {
      const deleted = await deleteImage(userId, imageId);
      return reply.send({ success: true, deleted });
    } catch (err: any) {
      if (err.message === 'Image not found') return reply.status(404).send({ error: 'Image not found' });
      if (err.message === 'Forbidden') return reply.status(403).send({ error: 'Forbidden' });
      console.error('Delete image error:', err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}