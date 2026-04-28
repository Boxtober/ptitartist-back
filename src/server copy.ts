

import 'dotenv/config';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from 'bcrypt';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { z } from 'zod';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const app = Fastify();

app.post('/register', async (request, reply) => {
  const result = registerSchema.safeParse(request.body);
  if (!result.success) {
    return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });
  }
  const { email, password } = result.data;
  const userExists = await prisma.user.findUnique({ where: { email } });
  if (userExists) return reply.status(400).send({ error: 'User already exists' });
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, password: hashedPassword },
  });
  return reply.send(user);
});

app.post('/login', async (request, reply) => {
  const { email, password } = request.body as { email: string; password: string };
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return reply.status(401).send({ error: 'Invalid email or password' });
  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) return reply.status(401).send({ error: 'Invalid email or password' });
  const token = app.jwt.sign({ id: user.id, email: user.email });
  return reply.send({ token });
});

app.get('/me', async (request, reply) => {
  try {
    await request.jwtVerify();
    const { id } = request.user as { id: string };
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, createdAt: true },
    });
    return reply.send(user);
  } catch {
    return reply.status(401).send({ error: 'Non autorisé' });
  }
});

app.get('/', async () => {
  return { message: 'Hello, World!' };
});

app.setErrorHandler((error, request, reply) => {
  console.error(error);
  reply.status(500).send({ error: 'Internal server error' });
});

const start = async () => {
  try {
    // ✅ CORS et JWT enregistrés ici, dans le bon contexte async
    await app.register(cors, { origin: 'http://localhost:5173' });
    await app.register(jwt, { secret: process.env.JWT_SECRET! });

    await app.listen({ port: 3000 });
    console.log('Server running on http://localhost:3000');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();