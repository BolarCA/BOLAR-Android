import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createOrg, createUser, type UserFixture, type OrgFixture } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';

/** Day 51 platform control plane: health summary, feature flags, support sessions, platform-wide audit. */
describe('platform: health summary, feature flags, support sessions, platform audit (Day 51)', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let platformOrg: OrgFixture;
  let platformAdmin: UserFixture;
  let supportAgent: UserFixture;

  beforeAll(async () => {
    fx = await twoTenantFixture();
    platformOrg = await createOrg('platform-test', 'BOLAR Platform (test)');
    platformAdmin = await createUser(platformOrg, 'platform_admin', 'root@platform.test', { isPlatform: true });
    supportAgent = await createUser(platformOrg, 'support_agent', 'agent@platform.test', { isPlatform: true });
  });

  it('health summary: platform admin gets db check, counts and queue driver; org admin is denied', async () => {
    const p = await asUser(platformAdmin);
    const res = await p.get('/platform/health-summary');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database).toBe('ok');
    expect(res.body.queueDriver).toBe('memory');
    expect(res.body.counts.orgs).toBeGreaterThanOrEqual(3);
    expect(res.body.counts.users).toBeGreaterThanOrEqual(6);
    expect(res.body.counts.activeSessions).toBeGreaterThanOrEqual(1);
    expect(res.body.counts.activeSupportSessions).toBe(0);
    const a = await asUser(fx.admins.a);
    expect((await a.get('/platform/health-summary')).status).toBe(403);
  });

  it('feature flags: global + org CRUD by platform admin, duplicate key conflict, org admin and tenant are gated', async () => {
    const p = await asUser(platformAdmin);
    const global = await p.post('/feature-flags').send({ key: 'ops.cockpit', enabled: true, rules: { rollout: 100 } });
    expect(global.status).toBe(201);
    expect(global.body).toMatchObject({ key: 'ops.cockpit', enabled: true, tenantOrgId: null, orgSlug: null });
    const dup = await p.post('/feature-flags').send({ key: 'ops.cockpit' });
    expect(dup.status).toBe(409);
    const orgFlag = await p.post('/feature-flags').send({ key: 'ops.cockpit', enabled: false, tenantOrgId: fx.a.id });
    expect(orgFlag.status).toBe(201);
    expect(orgFlag.body).toMatchObject({ tenantOrgId: fx.a.id, orgSlug: fx.a.slug, enabled: false });
    expect((await p.post('/feature-flags').send({ key: 'Bad Key!' })).status).toBe(400);
    expect((await p.post('/feature-flags').send({ key: 'x.y', tenantOrgId: 'nope' })).status).toBe(400);

    const toggled = await p.patch(`/feature-flags/${orgFlag.body.id}`).send({ enabled: true });
    expect(toggled.status).toBe(200);
    expect(toggled.body.enabled).toBe(true);
    expect(await prisma.auditLog.findFirst({ where: { action: 'feature_flag.update', resourceId: orgFlag.body.id, tenantOrgId: fx.a.id } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: 'feature_flag.create', resourceId: global.body.id, tenantOrgId: null } })).not.toBeNull();

    const all = await p.get('/feature-flags');
    expect(all.body.items.map((f: { id: string }) => f.id).sort()).toEqual([global.body.id, orgFlag.body.id].sort());
    const onlyGlobal = await p.get('/feature-flags?scope=global');
    expect(onlyGlobal.body.items).toHaveLength(1);
    expect(onlyGlobal.body.items[0].id).toBe(global.body.id);
    const onlyA = await p.get(`/feature-flags?tenantOrgId=${fx.a.id}`);
    expect(onlyA.body.items).toHaveLength(1);
    expect(onlyA.body.items[0].id).toBe(orgFlag.body.id);

    // org_admin lacks feature_flag:write entirely (coarse gate), tenant too
    const a = await asUser(fx.admins.a);
    expect((await a.get('/feature-flags')).status).toBe(403);
    expect((await a.post('/feature-flags').send({ key: 'org.try' })).status).toBe(403);
    const tenant = await createUser(fx.b, 'tenant');
    expect((await (await asUser(tenant)).patch(`/feature-flags/${global.body.id}`).send({ enabled: false })).status).toBe(403);
    // unknown flag id is a 404 with an access.denied audit row
    expect((await p.patch('/feature-flags/does-not-exist').send({ enabled: true })).status).toBe(404);
    expect(await prisma.auditLog.findFirst({ where: { action: 'access.denied', resourceType: 'feature_flag', resourceId: 'does-not-exist', actorId: platformAdmin.id } })).not.toBeNull();
  });

  it('support session lifecycle: start (reason, time box) -> X-Tenant-Org carries supportSessionId -> end; audited in target org', async () => {
    const agent = await asUser(supportAgent);
    // Without a session, a support agent (not platform admin) cannot act on another org.
    const blocked = await asUser(supportAgent, { 'X-Tenant-Org': fx.a.slug });
    expect((await blocked.get('/me')).status).toBe(403);

    expect((await agent.post('/support-sessions').send({ tenantOrgId: fx.a.slug, reason: 'short' })).status).toBe(400);
    const started = await agent.post('/support-sessions').send({ tenantOrgId: fx.a.slug, reason: 'Ticket #4411: customer cannot open the leases page', durationMinutes: 30 });
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ tenantOrgId: fx.a.id, agentUserId: supportAgent.id, active: true, approvedBy: null, org: { slug: fx.a.slug }, agent: { email: supportAgent.email } });
    expect(new Date(started.body.endsAt).getTime() - new Date(started.body.startedAt).getTime()).toBe(30 * 60_000);
    const again = await agent.post('/support-sessions').send({ tenantOrgId: fx.a.id, reason: 'Ticket #4411: second attempt while active' });
    expect(again.status).toBe(409);

    // The org's own audit log shows the start; the platform org's log shows it too.
    expect(await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'support.session_started', resourceId: started.body.id } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { tenantOrgId: platformOrg.id, action: 'support.session_started', resourceId: started.body.id } })).not.toBeNull();

    // Now cross-tenant access works and /me reports the session; the cross-tenant access itself is audited.
    const acting = await asUser(supportAgent, { 'X-Tenant-Org': fx.a.slug });
    const me = await acting.get('/me');
    expect(me.status).toBe(200);
    expect(me.body.org.id).toBe(fx.a.id);
    expect(me.body.supportSessionId).toBe(started.body.id);
    const cross = await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'support.cross_tenant_access', actorId: supportAgent.id } });
    expect(cross).not.toBeNull();
    expect((cross!.metadata as { via: string }).via).toBe('support_session');
    // Read-only permissions apply inside the org: users list ok, invitations forbidden.
    expect((await acting.get('/users')).status).toBe(200);
    expect((await acting.post('/invitations').send({ email: 'x@alpha.test', role: 'tenant' })).status).toBe(403);
    // Org B is still off limits.
    expect((await (await asUser(supportAgent, { 'X-Tenant-Org': fx.b.slug })).get('/me')).status).toBe(403);

    // Listing: agent sees own; platform admin sees all; active filter works.
    expect((await agent.get('/support-sessions?active=true')).body.items.map((s: { id: string }) => s.id)).toEqual([started.body.id]);
    const p = await asUser(platformAdmin);
    expect((await p.get('/support-sessions')).body.items.some((s: { id: string }) => s.id === started.body.id)).toBe(true);

    // Another agent cannot end it (404 + access.denied); the owner can; ending twice is an invalid transition.
    const otherAgent = await createUser(platformOrg, 'support_agent', 'agent2@platform.test', { isPlatform: true });
    expect((await (await asUser(otherAgent)).post(`/support-sessions/${started.body.id}/end`)).status).toBe(404);
    expect(await prisma.auditLog.findFirst({ where: { action: 'access.denied', resourceType: 'support_session', resourceId: started.body.id, actorId: otherAgent.id } })).not.toBeNull();
    const ended = await agent.post(`/support-sessions/${started.body.id}/end`);
    expect(ended.status).toBe(200);
    expect(ended.body.active).toBe(false);
    expect(ended.body.endedAt).not.toBeNull();
    expect((await agent.post(`/support-sessions/${started.body.id}/end`)).status).toBe(409);
    expect(await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'support.session_ended', resourceId: started.body.id } })).not.toBeNull();
    // Session over: cross-tenant access is blocked again.
    expect((await (await asUser(supportAgent, { 'X-Tenant-Org': fx.a.slug })).get('/me')).status).toBe(403);
    expect((await agent.get('/support-sessions?active=true')).body.items).toHaveLength(0);

    // Platform admins self-approve and can act without a session, but a session still tags their context.
    const adminSession = await p.post('/support-sessions').send({ tenantOrgId: fx.b.id, reason: 'Ticket #4412: verify billing settings', durationMinutes: 15 });
    expect(adminSession.status).toBe(201);
    expect(adminSession.body.approvedBy).toBe(platformAdmin.id);
    const adminActing = await asUser(platformAdmin, { 'X-Tenant-Org': fx.b.slug });
    expect((await adminActing.get('/me')).body.supportSessionId).toBe(adminSession.body.id);
    expect((await p.post(`/support-sessions/${adminSession.body.id}/end`)).status).toBe(200);
    expect((await (await asUser(platformAdmin, { 'X-Tenant-Org': fx.b.slug })).get('/me')).body.supportSessionId).toBeNull();

    // Org users cannot start or list support sessions even though org_admin carries the coarse permission (audited denial).
    const orgAdmin = await asUser(fx.admins.a);
    expect((await orgAdmin.post('/support-sessions').send({ tenantOrgId: fx.b.id, reason: 'Trying to peek at another org' })).status).toBe(403);
    expect((await orgAdmin.get('/support-sessions')).status).toBe(403);
    expect(await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'access.denied', resourceType: 'support_session', actorId: fx.admins.a.id } })).not.toBeNull();
    expect(await prisma.supportSession.count({ where: { tenantOrgId: fx.b.id, agentUserId: fx.admins.a.id } })).toBe(0);
  });

  it('platform audit: org filter isolates rows per tenant; unfiltered spans tenants; org admin and MFA-less are denied', async () => {
    // Generate activity in both orgs.
    await (await asUser(fx.admins.a)).get('/users');
    await (await asUser(fx.admins.b)).get('/users');
    const p = await asUser(platformAdmin);
    const onlyA = await p.get(`/platform/audit?tenantOrgId=${fx.a.slug}&limit=100`);
    expect(onlyA.status).toBe(200);
    expect(onlyA.body.items.length).toBeGreaterThan(0);
    expect(onlyA.body.items.every((r: { tenantOrgId: string | null }) => r.tenantOrgId === fx.a.id)).toBe(true);
    const onlyB = await p.get(`/platform/audit?tenantOrgId=${fx.b.id}&limit=100`);
    expect(onlyB.body.items.every((r: { tenantOrgId: string | null }) => r.tenantOrgId === fx.b.id)).toBe(true);
    const all = await p.get('/platform/audit?limit=100&action=auth.login');
    const orgsSeen = new Set(all.body.items.map((r: { tenantOrgId: string | null }) => r.tenantOrgId));
    expect(orgsSeen.has(fx.a.id)).toBe(true);
    expect(orgsSeen.has(fx.b.id)).toBe(true);
    expect((await p.get('/platform/audit?tenantOrgId=missing-org')).status).toBe(400);
    // The query itself is audited.
    expect(await prisma.auditLog.findFirst({ where: { action: 'audit.platform_query', actorId: platformAdmin.id } })).not.toBeNull();
    // Org admins have audit:read but not platform:admin.
    expect((await (await asUser(fx.admins.a)).get('/platform/audit')).status).toBe(403);
    // Support agents lack platform:admin as well.
    expect((await (await asUser(supportAgent)).get('/platform/audit')).status).toBe(403);
    // Platform admin with MFA enabled but not verified on this session is refused (auth: mfa).
    const mfaAdmin = await createUser(platformOrg, 'platform_admin', 'mfa@platform.test', { isPlatform: true, mfaEnabled: true });
    await prisma.userProfile.update({ where: { id: mfaAdmin.id }, data: { mfaSecret: 'JBSWY3DPEHPK3PXP' } });
    const m = await asUser(mfaAdmin);
    expect((await m.get('/platform/audit')).status).toBe(403);
    expect((await m.get('/platform/health-summary')).status).toBe(200);
  });
});
