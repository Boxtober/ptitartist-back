import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../plugins/prisma.js';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  age: z.coerce.number().optional(),
  avatarUrl: z.string().optional(),
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  age: z.number().int().min(0).optional(),
  avatarUrl: z.string().url().optional(),
});

export async function authRoutes(app: FastifyInstance) {

  const fastify = app as any;
  app.post('/register', async (request, reply) => {
    const result = registerSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });
    }
    const { email, password, firstName, lastName, age, avatarUrl } = result.data;

    const userExists = await prisma.user.findUnique({ where: { email } });
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

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' });

    const token = fastify.jwt.sign({ id: user.id });
    return reply.send({ token });
  });

  app.get('/me', async (request, reply) => {
    try {
      await (request as any).jwtVerify();
      const { id } = (request as any).user as { id: string };
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          createdAt: true,
          firstName: true,
          lastName: true,
          age: true,
          avatarUrl: true,
        },
      });
      return reply.send(user);
    } catch {
      return reply.status(401).send({ error: 'Non autorisé' });
    }
  });

  app.put('/profile', async (request, reply) => {
    try {
      await (request as any).jwtVerify();
      const { id } = (request as any).user as { id: string };

      const result = updateProfileSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });
      }

      const updated = await prisma.user.update({
        where: { id },
        data: result.data,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          age: true,
          avatarUrl: true,
        },
      });

      return reply.send(updated);
    } catch (err) {
      console.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  app.post('/upload', async (request, reply) => {
    await (request as any).jwtVerify();
    const { id: userId } = (request as any).user as { id: string };

    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const filename = `${Date.now()}-${data.filename}`;
    const uploadsDir = path.join(process.cwd(), 'uploads');
    await fs.promises.mkdir(uploadsDir, { recursive: true });
    const localPath = path.join(uploadsDir, filename);

    await pipeline(data.file, fs.createWriteStream(localPath));

    const base = process.env.BASE_URL ?? 'http://localhost:3000';
    const image = await prisma.image.create({
      data: { url: `${base}/uploads/${filename}`, userId },
    });

    return reply.status(201).send(image);
  });

  app.get('/images', async (request, reply) => {
    await (request as any).jwtVerify();
    const { id } = (request as any).user as { id: string };

    const images = await prisma.image.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send(images);
  });

  app.put('/images/:id', async (request, reply) => {
    await (request as any).jwtVerify();
    const { id: imageId } = request.params as { id: string };
    const { createdAt } = request.body as { createdAt: string };

    const existing = await prisma.image.findUnique({ where: { id: imageId } });
    if (!existing) return reply.status(404).send({ error: 'Image not found' });
    if (existing.userId !== (request.user as { id: string }).id) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const updated = await prisma.image.update({
      where: { id: imageId },
      data: { createdAt: new Date(createdAt) },
    });

    return reply.send(updated);
  });
}

// app.post('/upload', async (request, reply) => {
//   await request.jwtVerify();
//   const { id: userId } = request.user as { id: string };

//   const data = await request; // récup fichier
//   console.log("FILE DATA:", data);
  
//   const filename = `${Date.now()}-${data?.filename}`;
//   const filepath = `uploads/${filename}`;

//   await new Promise((resolve, reject) => {
//     const stream = data?.file;
//     const writeStream = require('fs').createWriteStream(filepath);
//     stream.pipe(writeStream);
//     stream.on('end', resolve);
//     stream.on('error', reject);
//   });

//   const image = await prisma.image.create({
//     data: {
//       url: `http://localhost:3000/${filepath}`,
//       userId,
//     },
//   });

//   return image;
// });
// }


// import { FastifyInstance } from 'fastify';
// import bcrypt from 'bcrypt';
// import { z } from 'zod';
// import { prisma } from '../plugins/prisma.ts';

// const registerSchema = z.object({
//   email: z.string().email(),
//   password: z.string().min(8),
// });

// const loginSchema = z.object({
//   email: z.string().email(),
//   password: z.string(),
// });

// export async function authRoutes(app: FastifyInstance) {
//   app.post('/register', async (request, reply) => {
//     const result = registerSchema.safeParse(request.body);
//     if (!result.success) {
//       return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });
//     }

//     const { email, password } = result.data;

//     const userExists = await prisma.user.findUnique({ where: { email } });
//     if (userExists) return reply.status(400).send({ error: 'User already exists' });

//     const hashedPassword = await bcrypt.hash(password, 10);
//     const user = await prisma.user.create({
//       data: { email, password: hashedPassword },
//     });

//     const { password: _, ...userWithoutPassword } = user;
//     return reply.status(201).send(userWithoutPassword);
//   });

//   app.post('/login', async (request, reply) => {
//     const result = loginSchema.safeParse(request.body);
//     if (!result.success) {
//       return reply.status(400).send({ error: 'Invalid input', details: result.error.flatten() });
//     }

//     const { email, password } = result.data;

//     const user = await prisma.user.findUnique({ where: { email } });
//     if (!user) return reply.status(401).send({ error: 'Invalid email or password' });

//     const passwordMatch = await bcrypt.compare(password, user.password);
//     if (!passwordMatch) return reply.status(401).send({ error: 'Invalid email or password' });

//     const token = app.jwt.sign({ id: user.id, email: user.email });
//     return reply.send({ token });
//   });

//   app.get('/profile', async (request, reply) => {
//     try {
//       await request.jwtVerify();
//       const { id } = request.user as { id: string };

//       const user = await prisma.user.findUnique({
//         where: { id },
//         select: { id: true, email: true, createdAt: true },
//       });

//       return reply.send(user);
//     } catch {
//       return reply.status(401).send({ error: 'Non autorisé' });
//     }
//   });
// }