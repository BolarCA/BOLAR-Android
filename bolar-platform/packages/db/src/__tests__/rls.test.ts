/**
 * Row-level security proof (ADR 0005). Connects as a LOGIN member of `bolar_app` (a non-owner role, so RLS
 * applies) and shows that without `app.tenant_id` nothing is visible and with it only that tenant's rows are,
 * across Property, Lease, Invoice, AuditLog and Document. Also pins the committed migration to the schema.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma, createPrismaClient, forTenant, truncateAll, withTenantRls, rlsPolicySql, rlsTables, currentTenantSetting, TENANT_SCOPED_MODELS, type PrismaClient } from '../index.js';

const LOGIN_ROLE = 'bolar_app_rls_test';
const LOGIN_PASSWORD = 'rls_test_only';

function appUrl(): string {
  const u = new URL(process.env.DATABASE_URL!);
  u.username = LOGIN_ROLE;
  u.password = LOGIN_PASSWORD;
  return u.toString();
}

describe('row-level security (ADR 0005)', () => {
  let app: PrismaClient;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    await truncateAll(prisma);
    await prisma.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${LOGIN_ROLE}') THEN CREATE ROLE ${LOGIN_ROLE} LOGIN PASSWORD '${LOGIN_PASSWORD}' IN ROLE bolar_app; END IF; END $$;`);
    orgA = (await prisma.tenantOrg.create({ data: { slug: 'rls-a', name: 'RLS A' } })).id;
    orgB = (await prisma.tenantOrg.create({ data: { slug: 'rls-b', name: 'RLS B' } })).id;
    for (const [org, tag] of [[orgA, 'A'], [orgB, 'B']] as const) {
      const prop = await prisma.property.create({ data: { tenantOrgId: org, name: `Prop ${tag}`, addressLine1: '1 St', city: 'Austin', state: 'TX', postalCode: '78701' } });
      const unit = await prisma.unit.create({ data: { tenantOrgId: org, propertyId: prop.id, unitNumber: '1' } });
      const lease = await prisma.lease.create({ data: { tenantOrgId: org, propertyId: prop.id, unitId: unit.id, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), rentCents: 100000, createdBy: 'seed' } });
      await prisma.invoice.create({ data: { tenantOrgId: org, leaseId: lease.id, number: `INV-${tag}-1`, dueDate: new Date('2026-02-01'), totalCents: 100000 } });
      await prisma.auditLog.create({ data: { tenantOrgId: org, action: 'test.rls', resourceType: 'property', resourceId: prop.id, requestId: `rls-${tag}` } });
      await prisma.document.create({ data: { tenantOrgId: org, ownerType: 'property', ownerId: prop.id, title: `Doc ${tag}`, createdBy: 'seed' } });
    }
    await prisma.auditLog.create({ data: { tenantOrgId: null, action: 'test.global', resourceType: 'session', requestId: 'rls-global' } });
    app = createPrismaClient(appUrl());
    await app.$connect();
  });

  afterAll(async () => {
    await app.$disconnect();
    await prisma.$disconnect();
  });

  it('every tenant-scoped table has RLS enabled with the tenant policy, and the migration matches the schema', async () => {
    const rows = await prisma.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; policies: number }>>`
      SELECT c.relname, c.relrowsecurity, (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation')::int AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    const byTable = new Map(rows.map((r) => [r.relname, r]));
    for (const t of rlsTables()) {
      expect(TENANT_SCOPED_MODELS.has(t.model)).toBe(true);
      const row = byTable.get(t.table);
      expect(row, `table ${t.table}`).toBeDefined();
      expect(row!.relrowsecurity, `RLS enabled on ${t.table}`).toBe(true);
      expect(row!.policies, `tenant_isolation policy on ${t.table}`).toBe(1);
    }
    const dir = resolve(process.cwd(), 'prisma/migrations');
    // Latest *_rls_policies migration must equal the generator output (earlier ones are superseded, kept for history).
    const folder = readdirSync(dir).filter((f) => f.endsWith('_rls_policies')).sort().pop();
    expect(folder).toBeDefined();
    const committed = readFileSync(resolve(dir, folder!, 'migration.sql'), 'utf8').trim();
    expect(committed).toBe(rlsPolicySql().trim());
  });

  it('the app role sees no tenant rows without app.tenant_id, and only its tenant with it', async () => {
    const tables = ['property', 'lease', 'invoice', 'auditLog', 'document'] as const;
    for (const t of tables) {
      const count = await (app[t] as unknown as { count: () => Promise<number> }).count();
      // AuditLog admits NULL-tenant (platform) rows; every other table is fully hidden.
      expect(count, `${t} without tenant setting`).toBe(t === 'auditLog' ? 1 : 0);
    }
    expect(await currentTenantSetting(app)).toBeNull();
    const seenA = await withTenantRls(app, orgA, async (tx) => {
      expect(await currentTenantSetting(tx)).toBe(orgA);
      return {
        property: await tx.property.findMany(),
        lease: await tx.lease.findMany(),
        invoice: await tx.invoice.findMany(),
        auditLog: await tx.auditLog.findMany({ where: { tenantOrgId: { not: null } } }),
        document: await tx.document.findMany(),
        // no where clause at all: policy alone must filter
        unfiltered: await tx.invoice.count(),
      };
    });
    for (const k of ['property', 'lease', 'invoice', 'auditLog', 'document'] as const) {
      expect(seenA[k], k).toHaveLength(1);
      expect((seenA[k][0] as { tenantOrgId: string }).tenantOrgId).toBe(orgA);
    }
    expect(seenA.unfiltered).toBe(1);
    const seenB = await withTenantRls(app, orgB, (tx) => tx.property.findMany());
    expect(seenB).toHaveLength(1);
    expect(seenB[0]!.name).toBe('Prop B');
    // the setting is transaction-local: gone after the transaction
    expect(await currentTenantSetting(app)).toBeNull();
    expect(await app.property.count()).toBe(0);
  });

  it('writes under the wrong tenant are rejected by WITH CHECK; the owner role is unaffected', async () => {
    await expect(withTenantRls(app, orgA, (tx) => tx.property.create({ data: { tenantOrgId: orgB, name: 'Smuggled', addressLine1: 'x', city: 'x', state: 'TX', postalCode: '0' } }))).rejects.toThrow(/row-level security/);
    const ok = await withTenantRls(app, orgA, (tx) => tx.property.create({ data: { tenantOrgId: orgA, name: 'Legit', addressLine1: 'x', city: 'x', state: 'TX', postalCode: '0' } }));
    expect(ok.tenantOrgId).toBe(orgA);
    expect(await prisma.property.count()).toBe(3);
    expect(await forTenant(prisma, orgB).property.count()).toBe(1);
  });

  it('forTenant(..., { rls: true }) reads through RLS; without rls the app role sees nothing', async () => {
    expect(await forTenant(app, orgA).property.count()).toBe(0);
    const scoped = forTenant(app, orgA, { rls: true });
    expect(await scoped.property.count()).toBe(2);
    const first = await scoped.property.findFirst({ where: { name: 'Legit' } });
    expect(first?.tenantOrgId).toBe(orgA);
    // an explicit cross-tenant where is filtered by the policy alone (no application-level rewrite in this path)
    expect(await withTenantRls(app, orgA, (tx) => tx.property.findMany({ where: { tenantOrgId: orgB } }))).toHaveLength(0);
    expect(await forTenant(app, orgB, { rls: true }).document.findMany()).toHaveLength(1);
  });
});
