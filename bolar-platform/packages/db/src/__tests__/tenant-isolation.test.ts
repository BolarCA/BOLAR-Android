import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, forTenant, truncateAll, TENANT_SCOPED_MODELS } from '../index.js';

describe('tenant-scoped client', () => {
  let orgA: string;
  let orgB: string;
  beforeAll(async () => {
    await truncateAll(prisma);
    orgA = (await prisma.tenantOrg.create({ data: { slug: 'acme-a', name: 'Acme Holdings' } })).id;
    orgB = (await prisma.tenantOrg.create({ data: { slug: 'acme-b', name: 'Acme Holdings' } })).id;
    await prisma.property.create({ data: { tenantOrgId: orgA, name: 'Shared Name', addressLine1: '1 A St', city: 'Austin', state: 'TX', postalCode: '78701' } });
    await prisma.property.create({ data: { tenantOrgId: orgB, name: 'Shared Name', addressLine1: '1 B St', city: 'Austin', state: 'TX', postalCode: '78701' } });
  });
  afterAll(async () => prisma.$disconnect());

  it('derives tenant-scoped models from the schema', () => {
    expect(TENANT_SCOPED_MODELS.has('Property')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('TenantOrg')).toBe(false);
    expect(TENANT_SCOPED_MODELS.has('Permission')).toBe(false);
  });

  it('filters list/count by tenant', async () => {
    const a = forTenant(prisma, orgA);
    const rows = await a.property.findMany({ where: { name: 'Shared Name' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.addressLine1).toBe('1 A St');
    expect(await a.property.count()).toBe(1);
  });

  it('stamps tenantOrgId on create and rejects cross-tenant override', async () => {
    const a = forTenant(prisma, orgA);
    const created = await a.property.create({ data: { tenantOrgId: orgB, name: 'X', addressLine1: 'x', city: 'x', state: 'TX', postalCode: '0' } as never });
    expect(created.tenantOrgId).toBe(orgA);
  });

  it('treats another tenant row as not found for unique/update/delete', async () => {
    const b = forTenant(prisma, orgB);
    const rowA = (await prisma.property.findFirst({ where: { tenantOrgId: orgA } }))!;
    expect(await b.property.findUnique({ where: { id: rowA.id } })).toBeNull();
    await expect(b.property.update({ where: { id: rowA.id }, data: { name: 'hacked' } })).rejects.toMatchObject({ code: 'not_found' });
    await expect(b.property.delete({ where: { id: rowA.id } })).rejects.toMatchObject({ code: 'not_found' });
    const still = await prisma.property.findUnique({ where: { id: rowA.id } });
    expect(still!.name).toBe('Shared Name');
    expect(await b.property.updateMany({ where: {}, data: { name: 'bulk' } })).toMatchObject({ count: 1 });
    expect((await prisma.property.findUnique({ where: { id: rowA.id } }))!.name).toBe('Shared Name');
  });
});

describe('audit log is append-only', () => {
  it('rejects UPDATE and DELETE via trigger', async () => {
    const log = await prisma.auditLog.create({ data: { action: 'test', resourceType: 'test', requestId: 'r1' } });
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: 'changed' } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/append-only/);
  });
});
