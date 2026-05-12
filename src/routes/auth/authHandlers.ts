import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../../plugins/prisma.js';
import { sanitizeString } from '../../utils/sanitize.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  age: z.coerce.number().optional(),
  avatarUrl: z.string().optional(),
});

export default async function authHandlers(app: FastifyInstance) {
  const fastify = app as any;

  app.post('/register', async (request, reply) => {
    const result = registerSchema.safeParse(request.body);
    if (!result.success) return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });
    const { email, password, firstName, lastName, age, avatarUrl } = result.data;

    const userExists = await (prisma as any).user.findUnique({ where: { email } });
    if (userExists) return reply.status(400).send({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        age: age ?? null,
        avatarUrl: avatarUrl ?? null,
      },
    });

    const { password: _pw, ...userWithoutPassword } = user;
    return reply.status(201).send(userWithoutPassword);
  });

  app.post('/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };
    const user = await (prisma as any).user.findUnique({ where: { email } });
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' });
    const token = fastify.jwt.sign({ id: user.id, tokenVersion: (user as any).tokenVersion ?? 0 });
    return reply.send({ token });
  });
}
