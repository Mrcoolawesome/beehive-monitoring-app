// A single shared Prisma client for the whole app to import, instead of
// every file that needs the database creating its own client (which would
// open a separate connection pool per file — wasteful, and in dev mode
// actively harmful, see below).

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

// Prisma 7 dropped the old "just put a `url` in schema.prisma" connection
// method. The client now needs an explicit "driver adapter" object that
// knows how to talk to Postgres specifically — @prisma/adapter-pg wraps the
// standard `pg` driver. DATABASE_URL comes from .env (see .env.example).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Next.js's dev server hot-reloads modules on every file save, which would
// normally recreate the Prisma client (and its connection pool) on every
// single edit. Stashing it on `globalThis` — which survives hot reloads,
// unlike a plain module-level variable — means we reuse the same client
// across reloads in development. In production there's only ever one
// module load, so this global is just a formality there.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
