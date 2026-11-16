import { PrismaClient } from '@prisma/client';

declare global {
  var __bolarPrisma: PrismaClient | undefined;
}

export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  return new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
    log: process.env.PRISMA_LOG === '1' ? ['query', 'warn', 'error'] : ['error'],
  });
}

/** Process-wide root client. Use `forTenant(ctx)` for tenant-scoped access in handlers. */
export const prisma: PrismaClient = globalThis.__bolarPrisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__bolarPrisma = prisma;

export { PrismaClient };
export { Prisma } from '@prisma/client';
export type * from '@prisma/client';
