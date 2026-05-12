import path from 'path';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

export function sanitizeFilename(original: string) {
  // strip directory components
  const base = path.basename(original);
  // replace spaces and unsafe chars
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function isAllowedImage(filename: string) {
  return ALLOWED_EXT.has(path.extname(filename).toLowerCase());
}
