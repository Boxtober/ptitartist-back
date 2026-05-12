import crypto from 'crypto';
import { prisma } from '../plugins/prisma.js';

export function generateToken(length = 48) {
  return crypto.randomBytes(length).toString('hex');
}

// NOTE: we cast prisma to any for these updates because the TypeScript
// types won't reflect the new schema until `prisma generate` is run after
// applying the migration. This keeps compile-time checks passing locally.
const p: any = prisma as any;

export async function createEmailChangeRequest(userId: string, newEmail: string, ttlMinutes = 60) {
  const token = generateToken(24);
  const expires = new Date(Date.now() + ttlMinutes * 60_000);
  await p.user.update({ where: { id: userId }, data: { emailPending: newEmail, emailConfirmToken: token, emailConfirmExpires: expires } });
  return { token, expires };
}

export async function confirmEmailChange(token: string) {
  const user: any = await p.user.findFirst({ where: { emailConfirmToken: token } });
  if (!user) return null;
  if (!user.emailConfirmExpires || user.emailConfirmExpires < new Date()) return null;

  // apply the pending email
  const newEmail = user.emailPending as string | null;
  if (!newEmail) return null;

  const updated: any = await p.user.update({ where: { id: user.id }, data: { email: newEmail, emailPending: null, emailConfirmToken: null, emailConfirmExpires: null } });
  return updated;
}

export async function incrementTokenVersion(userId: string) {
  const updated: any = await p.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  return updated.tokenVersion;
}

export default {
  generateToken,
  createEmailChangeRequest,
  confirmEmailChange,
  incrementTokenVersion,
};
