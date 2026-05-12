export function sanitizeString(input: unknown, maxLen = 1024): string {
  if (input == null) return '';
  let s = String(input);
  // remove HTML tags
  s = s.replace(/<[^>]*>/g, '');
  // remove control characters
  s = s.replace(/[\x00-\x1F\x7F]/g, '');
  // collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}
