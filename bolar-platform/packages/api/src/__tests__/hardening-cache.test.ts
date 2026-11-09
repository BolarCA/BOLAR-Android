/**
 * /me roles+permissions cache (Days 91-104, ADR 0006): keyed by (userId, tenantOrgId, sessionId), 30 s TTL,
 * explicit invalidation on grant/revoke/suspend/logout/support-session, and no tenant bleed across X-Tenant-Org.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { twoTenantFixture, createUser, createOrg } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { testApp, loginAs, authed, asUser } from './helpers.js';
import { TtlCache, meCache, meCacheKey, meCacheStats, invalidateUserCache, invalidateSessionCache, memoizeForever, resetCachesForTests } from '../shared/cache.js';
import { verifyAccessToken } from '../shared/tokens.js';

async function sid(token: string): Promise<string> { return (await verifyAccessToken(token))!.sid; }

describe('me cache: tenant-keyed, invalidated on mutation', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  beforeAll(async () => { fx = await twoTenantFixture(); resetCachesForTests(); });
  afterEach(() => { meCacheStats.hits = 0; meCacheStats.misses = 0; });

  it('unit: TtlCache expires, evicts by predicate and bounds its size', () => {
    let now = 1000;
    const c = new TtlCache<number>(3, () => now);
    c.set('me:u1:orgA:s1', 1, 100);
    c.set('me:u1:orgB:s1', 2, 100);
    c.set('me:u2:orgA:s2', 3, 1000);
    expect(c.get('me:u1:orgA:s1')).toBe(1);
    expect(c.get('me:u1:orgB:s1')).toBe(2);
    now = 1101;
    expect(c.get('me:u1:orgA:s1')).toBeUndefined();
    c.set('me:u1:orgA:s1', 1, 100);
    expect(c.invalidateWhere((k) => k.startsWith('me:u1:'))).toBe(2);
    expect(c.get('me:u2:orgA:s2')).toBe(3);
    c.set('a', 1, 100); c.set('b', 1, 100); c.set('c', 1, 100);
    expect(c.size).toBeLessThanOrEqual(3);
    c.set('zero-ttl', 1, 0);
    expect(c.get('zero-ttl')).toBeUndefined();
    const memo = memoizeForever((n: number) => ({ n }));
    expect(memo(1)).toBe(memo(1));
    expect(memo(2)).not.toBe(memo(1));
  });

  it('second request hits the cache; the entry is keyed by (user, org, session) so another org never matches', async () => {
    const tok = await loginAs(fx.managers.a);
    const s = await sid(tok.accessToken);
    meCache.clear();
    meCacheStats.hits = 0; meCacheStats.misses = 0;
    const first = await authed(tok.accessToken).get('/me');
    expect(first.status).toBe(200);
    expect(meCacheStats.misses).toBe(1);
    const second = await authed(tok.accessToken).get('/me');
    expect(second.status).toBe(200);
    expect(meCacheStats.hits).toBe(1);
    expect(second.body.roles).toEqual(first.body.roles);
    expect(meCache.get(meCacheKey(fx.managers.a.id, fx.a.id, s))).toBeDefined();
    // the same user+session under org B is a different key: nothing cached there
    expect(meCache.get(meCacheKey(fx.managers.a.id, fx.b.id, s))).toBeUndefined();
    // and the cached roles are org A's
    expect((meCache.get(meCacheKey(fx.managers.a.id, fx.a.id, s))!.roles as { scopeId: string }[]).every((r) => r.scopeId === fx.a.id)).toBe(true);
  });

  it('platform actor switching X-Tenant-Org resolves org-specific roles from separate entries (no bleed)', async () => {
    const platformOrg = await createOrg('bolar-platform-cache', 'BOLAR Platform');
    const admin = await createUser(platformOrg, 'platform_admin', 'root@platform-cache.test', { isPlatform: true });
    // an org-scoped role in org B only
    await prisma.roleAssignment.create({ data: { tenantOrgId: fx.b.id, userId: admin.id, role: 'bookkeeper', scopeType: 'org', scopeId: fx.b.id } });
    const tok = await loginAs(admin);
    const s = await sid(tok.accessToken);
    const home = await authed(tok.accessToken).get('/me');
    expect(home.body.org.id).toBe(platformOrg.id);
    expect(home.body.roles.map((r: { role: string }) => r.role)).toEqual(['platform_admin']);
    const asB = await authed(tok.accessToken, { 'X-Tenant-Org': fx.b.slug }).get('/me');
    expect(asB.status).toBe(200);
    expect(asB.body.org.id).toBe(fx.b.id);
    expect(asB.body.roles.map((r: { role: string }) => r.role).sort()).toEqual(['bookkeeper', 'platform_admin']);
    const asA = await authed(tok.accessToken, { 'X-Tenant-Org': fx.a.slug }).get('/me');
    expect(asA.body.org.id).toBe(fx.a.id);
    expect(asA.body.roles.map((r: { role: string }) => r.role)).toEqual(['platform_admin']);
    // three distinct cache entries, each carrying only that org's roles
    expect(meCache.get(meCacheKey(admin.id, platformOrg.id, s))).toBeDefined();
    expect(meCache.get(meCacheKey(admin.id, fx.a.id, s))).toBeDefined();
    expect(meCache.get(meCacheKey(admin.id, fx.b.id, s))).toBeDefined();
    expect((meCache.get(meCacheKey(admin.id, fx.a.id, s))!.roles as { role: string }[]).some((r) => r.role === 'bookkeeper')).toBe(false);
    // repeat the org-A view: served from cache, still without the org-B role
    meCacheStats.hits = 0;
    const asA2 = await authed(tok.accessToken, { 'X-Tenant-Org': fx.a.slug }).get('/me');
    expect(meCacheStats.hits).toBe(1);
    expect(asA2.body.roles.map((r: { role: string }) => r.role)).toEqual(['platform_admin']);
    // a cached org-A user never sees org B via the cache: org B's manager has a different key and different roles
    const bTok = await loginAs(fx.managers.b);
    const bMe = await authed(bTok.accessToken).get('/me');
    expect(bMe.body.org.id).toBe(fx.b.id);
    expect(bMe.body.roles.every((r: { scopeId: string }) => r.scopeId === fx.b.id)).toBe(true);
  });

  it('role grant and revoke through the API take effect on the next request, not at TTL expiry', async () => {
    const admin = await asUser(fx.admins.a);
    const staff = await createUser(fx.a, 'property_manager', 'staff.cache@alpha.test');
    const tok = await loginAs(staff);
    const rolesOf = async () => ((await authed(tok.accessToken).get('/me')).body.roles as { role: string }[]).map((r) => r.role);
    expect(await rolesOf()).toEqual(['property_manager']);
    // a direct DB change without invalidation is NOT seen (proves the cache is in effect)...
    const direct = await prisma.roleAssignment.create({ data: { tenantOrgId: fx.a.id, userId: staff.id, role: 'bookkeeper', scopeType: 'org', scopeId: fx.a.id } });
    expect(await rolesOf()).toEqual(['property_manager']);
    await prisma.roleAssignment.delete({ where: { id: direct.id } });
    // ...while the API path invalidates explicitly
    const grant = await admin.post('/roles').send({ userId: staff.id, role: 'bookkeeper', scopeType: 'org' });
    expect(grant.status).toBe(201);
    expect((await rolesOf()).sort()).toEqual(['bookkeeper', 'property_manager']);
    const revoke = await admin.delete(`/roles/${grant.body.id}`);
    expect(revoke.status).toBe(204);
    expect(await rolesOf()).toEqual(['property_manager']);
  });

  it('suspend and logout drop the cached entries; a revoked session is rejected immediately', async () => {
    const admin = await asUser(fx.admins.a);
    const staff = await createUser(fx.a, 'property_manager', 'staff.suspend@alpha.test');
    const tok = await loginAs(staff);
    const s = await sid(tok.accessToken);
    expect((await authed(tok.accessToken).get('/me')).status).toBe(200);
    expect(meCache.get(meCacheKey(staff.id, fx.a.id, s))).toBeDefined();
    const suspend = await admin.patch(`/users/${staff.id}`).send({ status: 'suspended' });
    expect(suspend.status).toBe(200);
    expect(meCache.get(meCacheKey(staff.id, fx.a.id, s))).toBeUndefined();
    expect((await authed(tok.accessToken).get('/me')).status).toBe(401);

    const other = await createUser(fx.a, 'property_manager', 'staff.logout@alpha.test');
    const tok2 = await loginAs(other);
    const s2 = await sid(tok2.accessToken);
    expect((await authed(tok2.accessToken).get('/me')).status).toBe(200);
    expect(meCache.get(meCacheKey(other.id, fx.a.id, s2))).toBeDefined();
    expect((await request(testApp()).post('/auth/logout').send({ refreshToken: tok2.refreshToken })).status).toBe(200);
    expect(meCache.get(meCacheKey(other.id, fx.a.id, s2))).toBeUndefined();
    expect((await authed(tok2.accessToken).get('/me')).status).toBe(401);
    // helpers used by the platform module
    meCache.set(meCacheKey('u9', 'o1', 's9'), { roles: [], permissions: [] }, 10_000);
    meCache.set(meCacheKey('u9', 'o2', 's8'), { roles: [], permissions: [] }, 10_000);
    expect(invalidateSessionCache('s9')).toBe(1);
    expect(invalidateUserCache('u9')).toBe(1);
  });
});
