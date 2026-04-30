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

const app = Fastify({ logger: true }); 


const start = async () => {
  try {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    await fs.promises.mkdir(uploadsDir, { recursive: true });

    await app.register(cors, {
      origin: config.clientUrl,
      methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });
    const jwtSecret = process.env.JWT_SECRET ?? 'dev-secret-please-change';
    await app.register(jwt, { secret: jwtSecret });
    await app.register(fastifyMultipart);
    await app.register(fastifyStatic, {
      root: uploadsDir,
      prefix: '/uploads/',
    });
    await app.register(authRoutes);

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
