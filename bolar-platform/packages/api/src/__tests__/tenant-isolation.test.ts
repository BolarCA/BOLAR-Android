import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';

/**
 * Day 10: prove no tenant data leakage before CRUD begins.
 * Two orgs share names; every list/detail/update/delete across tenants must be denied as not-found.
 */
describe('tenant isolation (Day 10)', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  beforeAll(async () => { fx = await twoTenantFixture(); });

  it('lists only the caller org users and subaccounts', async () => {
    const a = await asUser(fx.admins.a);
    const users = await a.get('/users');
    expect(users.status).toBe(200);
    expect(users.body.items.every((u: { email: string }) => u.email.endsWith('@alpha.test'))).toBe(true);
    const subs = await a.get('/subaccounts');
    const subB = await prisma.subaccount.findFirst({ where: { tenantOrgId: fx.b.id } });
    expect(subs.body.items.map((s: { id: string }) => s.id)).not.toContain(subB!.id);
  });

  it('detail/update of another tenant user or subaccount is 404 (no existence leak)', async () => {
    const a = await asUser(fx.admins.a);
    const subB = await prisma.subaccount.findFirst({ where: { tenantOrgId: fx.b.id } });
    expect((await a.get(`/users/${fx.admins.b.id}`)).status).toBe(404);
    expect((await a.patch(`/users/${fx.admins.b.id}`).send({ name: 'pwned' })).status).toBe(404);
    expect((await a.get(`/subaccounts/${subB!.id}`)).status).toBe(404);
    expect((await a.patch(`/subaccounts/${subB!.id}`).send({ name: 'pwned' })).status).toBe(404);
    expect((await a.get(`/orgs/${fx.b.id}`)).status).toBe(404);
    expect((await prisma.userProfile.findUnique({ where: { id: fx.admins.b.id } }))!.name).not.toBe('pwned');
  });

  it('cannot assign roles or relationships to another tenant user', async () => {
    const a = await asUser(fx.admins.a);
    const role = await a.post('/roles').send({ userId: fx.admins.b.id, role: 'property_manager', scopeType: 'org' });
    expect(role.status).toBe(400);
    const rel = await a.post('/relationships').send({ subjectId: fx.managers.b.id, relation: 'manages', objectType: 'property', objectId: fx.propA.id });
    expect(rel.status).toBe(400);
  });

  it('X-Tenant-Org header cannot be used by non-platform users to switch org', async () => {
    const a = await asUser(fx.admins.a, { 'X-Tenant-Org': fx.b.slug });
    const res = await a.get('/users');
    expect(res.status).toBe(403);
  });

  it('platform admin may target another org via X-Tenant-Org and the access is audited', async () => {
    const platformOrg = await prisma.tenantOrg.create({ data: { slug: 'bolar-platform', name: 'Platform' } });
    const pa = await createUser({ id: platformOrg.id, slug: platformOrg.slug, name: platformOrg.name }, 'platform_admin', 'pa@platform.test', { isPlatform: true });
    const p = await asUser(pa, { 'X-Tenant-Org': fx.b.slug });
    const res = await p.get('/users');
    expect(res.status).toBe(200);
    expect(res.body.items.every((u: { email: string }) => u.email.endsWith('@beta.test'))).toBe(true);
    const log = await prisma.auditLog.findFirst({ where: { action: 'support.cross_tenant_access', tenantOrgId: fx.b.id } });
    expect(log).not.toBeNull();
  });

  it('audit queries are tenant-scoped', async () => {
    const a = await asUser(fx.admins.a);
    const res = await a.get('/audit?limit=100');
    expect(res.status).toBe(200);
    const ids = new Set(res.body.items.map((r: { id: string }) => r.id));
    const bLogs = await prisma.auditLog.findMany({ where: { tenantOrgId: fx.b.id } });
    for (const l of bLogs) expect(ids.has(l.id)).toBe(false);
  });
});
