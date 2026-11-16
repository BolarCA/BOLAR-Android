import { Prisma, type PrismaClient } from '@prisma/client';

/** Truncate every table (tests only). Audit trigger is bypassed via TRUNCATE ... CASCADE which is DDL-like. */
export async function truncateAll(client: PrismaClient): Promise<void> {
  const tables = Prisma.dmmf.datamodel.models.map((m) => `"${m.dbName ?? m.name}"`);
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE;`);
}
