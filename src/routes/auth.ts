import type { FastifyInstance } from 'fastify';
import authHandlers from './auth/authHandlers.js';
import profileHandlers from './auth/profileHandlers.js';
import childrenHandlers from './auth/childrenHandlers.js';
import favoritesHandlers from './auth/favoritesHandlers.js';
import settingsHandlers from './auth/settingsHandlers.js';

// Top-level router that composes smaller auth-related handler modules.
export async function authRoutes(app: FastifyInstance) {
  await authHandlers(app);
  await profileHandlers(app);
  await childrenHandlers(app);
  await favoritesHandlers(app);
  await settingsHandlers(app);
}