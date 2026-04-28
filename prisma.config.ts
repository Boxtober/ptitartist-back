import "dotenv/config";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";

const config = {
  schema: "prisma/schema.prisma",
  // Ensure the Prisma config exposes the database URL to the CLI
  datasource: {
    url: process.env.DATABASE_URL,
  },
  migrate: {
    async adapter(env: any) {
      const { Pool } = await import("pg");
      return new PrismaPg(new Pool({ connectionString: env.DATABASE_URL }));
    },
  },
};

export default defineConfig(config as any);