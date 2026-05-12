import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { PassThrough } from 'stream';
import { sanitizeFilename, isAllowedImage } from './fileUtils.js';

type SaveUploadOptions = {
  maxBytes?: number;
  allowedMimes?: string[];
  uploadsDir?: string;
};

export async function saveUpload(fileStream: any, originalFilename: string, mimetype: string | undefined, options: SaveUploadOptions = {}) {
  const uploadsDir = options.uploadsDir ?? path.join(process.cwd(), 'uploads');
  await fs.promises.mkdir(uploadsDir, { recursive: true });

  const safeOriginal = sanitizeFilename(originalFilename || 'file');
  if (options.allowedMimes && (!mimetype || !options.allowedMimes.includes(mimetype))) {
    // drain stream
    try { fileStream.resume(); } catch { }
    throw Object.assign(new Error('INVALID_MIME'), { code: 'INVALID_MIME' });
  }

  if (!isAllowedImage(safeOriginal)) {
    try { fileStream.resume(); } catch { }
    throw Object.assign(new Error('INVALID_EXTENSION'), { code: 'INVALID_EXTENSION' });
  }

  const filename = `${Date.now()}-${safeOriginal}`;
  const localPath = path.join(uploadsDir, filename);

  // enforce maxBytes if provided
  const pass = new PassThrough();
  if (options.maxBytes && options.maxBytes > 0) {
    let bytes = 0; let aborted = false;
    pass.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes as number) && !aborted) {
        aborted = true;
        pass.destroy(new Error('FILE_TOO_LARGE'));
      }
    });
  }

  try {
    await pipeline(fileStream, pass, fs.createWriteStream(localPath));
  } catch (err: any) {
    // cleanup partial file
    try { await fs.promises.unlink(localPath).catch(() => {}); } catch {}
    throw err;
  }

  return { filename, localPath };
}

export function getUploadUrl(filename: string) {
  const base = process.env.BASE_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/uploads/${filename}`;
}

export function getFilenameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return path.basename(parsed.pathname);
  } catch {
    const idx = url.indexOf('/uploads/');
    if (idx >= 0) return url.slice(idx + '/uploads/'.length);
    return null;
  }
}

export async function unlinkUploadFileByFilename(filename: string) {
  const filePath = path.join(process.cwd(), 'uploads', filename);
  try {
    await fs.promises.unlink(filePath);
  } catch (err: any) {
    if (err.code === 'ENOENT') return; // ignore
    throw err;
  }
}

export function fileExistsSync(filepath: string) {
  try {
    return fs.existsSync(filepath);
  } catch {
    return false;
  }
}
