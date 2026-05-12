import 'dotenv/config';
import util from 'util';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import path from 'path';
import fs from 'fs';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import imagesRoutes from './routes/images.js';

const app = Fastify({ logger: true }); 


const start = async () => {
  try {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    await fs.promises.mkdir(uploadsDir, { recursive: true });

    await app.register(cors, {
      origin: config.clientUrl,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      // include common custom headers that frontends may send
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-description', 'x-image-description', 'x-child-id', 'content-length'],
      credentials: true,
    });

    // dev-only request logger to help diagnose pending/OPTIONS issues
    if (process.env.NODE_ENV !== 'production') {
      app.addHook('onRequest', async (request, reply) => {
        try {
          console.log(`incoming ${request.method} ${request.url} from ${request.ip}`);
        } catch {}
      });
    }
    const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-please-change';
    if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-please-change')) {
      throw new Error('JWT_SECRET must be set in production');
    }
  await app.register(jwt, { secret: jwtSecret });
  // session plugin that adds verifySession to requests (checks tokenVersion)
  const sessionModule = await import('./plugins/session.js');
  await app.register(sessionModule.default ?? sessionModule);
    await app.register(fastifyMultipart);
    await app.register(fastifyStatic, {
      root: uploadsDir,
      prefix: '/uploads/',
    });
    // Basic security headers (lightweight, no extra dependency)
    app.addHook('onSend', async (request, reply, payload) => {
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('X-Frame-Options', 'DENY');
      reply.header('Referrer-Policy', 'no-referrer');
      reply.header('X-Permitted-Cross-Domain-Policies', 'none');
      // HSTS only in production over HTTPS
      if (process.env.NODE_ENV === 'production') {
        reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
      }
      return payload;
    });
      // Centralized error handler: hide internal messages in production
      app.setErrorHandler((error: any, request, reply) => {
        // log full error server-side
        app.log.error(error);
        const isProd = process.env.NODE_ENV === 'production';
        const response: any = { error: 'internal_error' };
        // In non-prod, include a short message to help debugging
        if (!isProd) response.message = error?.message;
        const status = (error && (error.statusCode || error.status)) ? (error.statusCode || error.status) : 500;
        reply.status(status).send(response);
      });
  await app.register(authRoutes);
  await app.register(imagesRoutes);

    app.get('/', async () => ({ message: 'Hello, World!' }));

    await app.listen({ port: config.port });
    console.log(`Server running on http://localhost:${config.port}`);
  } catch (err: any) {
    console.error('STARTUP ERROR:', err?.message ?? err);
    console.error(err);
    process.exit(1);
  }
};

start();
