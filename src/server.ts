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

const app = Fastify({ logger: true }); // ✅ active les logs détaillés

// global handlers to surface non-Error throws and promise rejections
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', util.inspect(err, { depth: 6, showHidden: true }));
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', util.inspect(reason, { depth: 6, showHidden: true }));
});

app.setErrorHandler((error: any, _request, reply) => {
  // use util.inspect to safely log unknown error shapes
  console.error('ERROR:', util.inspect(error, { depth: 4, showHidden: true }));
  reply.status(500).send({ error: 'Internal server error' });
});

const start = async () => {
  try {
    // ✅ crée le dossier uploads s'il n'existe pas
    const uploadsDir = path.join(process.cwd(), 'uploads');
    await fs.promises.mkdir(uploadsDir, { recursive: true });

    await app.register(cors, { origin: config.clientUrl });
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
    // ✅ log plus détaillé
    console.error('STARTUP ERROR:', err?.message ?? err);
    console.error(err);
    process.exit(1);
  }
};

start();

// import 'dotenv/config';
// import Fastify from 'fastify';
// import cors from '@fastify/cors';
// import jwt from '@fastify/jwt';
// import multipart from '@fastify/multipart';
// import { authRoutes } from './routes/auth.js';

// const app = Fastify();

// const start = async () => {
//   try {
//     // 1. plugins
//     await app.register(cors, {
//       origin: 'http://localhost:5173',
//       methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//       allowedHeaders: ['Content-Type', 'Authorization'],
//     });

//     await app.register(jwt, { secret: process.env.JWT_SECRET! });

//     await app.register(multipart); // ✅ ici

//     // 2. routes
//     await app.register(authRoutes);

//     app.get('/', async () => ({ ok: true }));

//     // 3. start server
//     await app.listen({ port: 3000 });

//     console.log('Server running on http://localhost:3000');
//   } catch (err) {
//     console.error(err);
//     process.exit(1);
//   }
// };

// start();

// import 'dotenv/config';
// import Fastify from 'fastify';
// import { PrismaClient } from '@prisma/client';
// import { PrismaPg } from '@prisma/adapter-pg';
// import pg from 'pg';
// import bcrypt from 'bcrypt';
// import cors from '@fastify/cors';
// import jwt from '@fastify/jwt';
// import { z } from 'zod';

// const registerSchema = z.object({
//   email: z.string().email(),
//   password: z.string().min(8),
// });

// const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
// const adapter = new PrismaPg(pool);
// const prisma = new PrismaClient({ adapter });

// const app = Fastify();

// app.post('/register', async (request, reply) => {
//   const result = registerSchema.safeParse(request.body);
//   if (!result.success) {
//     return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });
//   }
//   const { email, password } = result.data;
//   const userExists = await prisma.user.findUnique({ where: { email } });
//   if (userExists) return reply.status(400).send({ error: 'User already exists' });
//   const hashedPassword = await bcrypt.hash(password, 10);
//   const user = await prisma.user.create({
//     data: { email, password: hashedPassword },
//   });
//   return reply.send(user);
// });

// app.post('/login', async (request, reply) => {
//   const { email, password } = request.body as { email: string; password: string };
//   const user = await prisma.user.findUnique({ where: { email } });
//   if (!user) return reply.status(401).send({ error: 'Invalid email or password' });
//   const passwordMatch = await bcrypt.compare(password, user.password);
//   if (!passwordMatch) return reply.status(401).send({ error: 'Invalid email or password' });
//   const token = app.jwt.sign({ id: user.id, email: user.email });
//   return reply.send({ token });
// });

// app.get('/me', async (request, reply) => {
//   try {
//     await request.jwtVerify();
//     const { id } = request.user as { id: string };
//     const user = await prisma.user.findUnique({
//       where: { id },
//       select: { id: true, email: true, createdAt: true },
//     });
//     return reply.send(user);
//   } catch {
//     return reply.status(401).send({ error: 'Non autorisé' });
//   }
// });

// app.get('/', async () => {
//   return { message: 'Hello, World!' };
// });

// app.setErrorHandler((error, request, reply) => {
//   console.error(error);
//   reply.status(500).send({ error: 'Internal server error' });
// });

// const start = async () => {
//   try {
//     // ✅ CORS et JWT enregistrés ici, dans le bon contexte async
//     await app.register(cors, { origin: 'http://localhost:5173' });
//     await app.register(jwt, { secret: process.env.JWT_SECRET! });

//     await app.listen({ port: 3000 });
//     console.log('Server running on http://localhost:3000');
//   } catch (err) {
//     console.error(err);
//     process.exit(1);
//   }
// };

// start();