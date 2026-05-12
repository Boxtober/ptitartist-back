import { prisma } from '../plugins/prisma.js';
import { getFilenameFromUrl, unlinkUploadFileByFilename } from '../utils/fileStorage.js';
import fs from 'fs';
import path from 'path';

export async function createImageRecord(
  userId: string,
  filename: string,
  description?: string | null,
  childId?: string | null,
  imageDescription?: string | null
) {
  const base = process.env.BASE_URL ?? 'http://localhost:3000';
  const data: any = { url: `${base}/uploads/${filename}`, userId };
  if (typeof description !== 'undefined') data.description = description ?? null;
  if (typeof childId !== 'undefined') data.childId = childId ?? null;
  if (typeof imageDescription !== 'undefined') data.imageDescription = imageDescription ?? null;
  return prisma.image.create({ data });
}

export async function deleteImage(userId: string, imageId: string) {
  const existing = await prisma.image.findUnique({ where: { id: imageId } });
  if (!existing) throw new Error('Image not found');
  if (existing.userId !== userId) throw new Error('Forbidden');

  const filename = getFilenameFromUrl(existing.url);
  if (filename) {
    try {
      await unlinkUploadFileByFilename(filename);
    } catch (err) {
      console.error('Error deleting file:', err);
    }
  }

  // remove any favorites referencing this image to avoid referential constraint errors
  try {
    await prisma.favorite.deleteMany({ where: { imageId } });
  } catch (err) {
    console.error('Error deleting favorites for image:', err);
  }

  return prisma.image.delete({ where: { id: imageId } });
}

export async function listImagesForUser(userId: string) {
  return prisma.image.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, include: { child: { select: { id: true, firstName: true } } } });
}
