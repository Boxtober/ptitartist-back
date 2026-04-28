// import { PrismaClient } from '@prisma/client';
// import { PrismaPg } from '@prisma/adapter-pg';
// import pg from 'pg';
// import { config } from '../config.js';

// const pool = new pg.Pool({ connectionString: config.databaseUrl });
// const adapter = new PrismaPg(pool);

// export const prisma = new PrismaClient({ adapter });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });