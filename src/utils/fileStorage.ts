import fs from 'fs';
import path from 'path';

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
