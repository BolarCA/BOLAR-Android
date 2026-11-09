import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { twoTenantFixture, createUser, createProperty, relate } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser, testApp, loginAs, authed } from './helpers.js';

describe('iam: invitations, roles, relationships, access check (Days 11-13)', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  beforeAll(async () => { fx = await twoTenantFixture(); });

  it('invite -> accept -> login -> role is active; duplicate and expired invites are rejected', async () => {
    const a = await asUser(fx.admins.a);
    const inv = await a.post('/invitations').send({ email: 'New.Staff@alpha.test', role: 'property_manager' });
    expect(inv.status).toBe(201);
    expect(inv.body.email).toBe('new.staff@alpha.test');
    expect(inv.body.acceptUrl).toContain('token=');
    const dup = await a.post('/invitations').send({ email: 'new.staff@alpha.test', role: 'tenant' });
    expect(dup.status).toBe(409);
    const token = new URL(inv.body.acceptUrl).searchParams.get('token')!;
    const accept = await request(testApp()).post('/invitations/accept').send({ token, name: 'New Staff', password: 'LongEnoughPassword1!' });
    expect(accept.status).toBe(200);
    const again = await request(testApp()).post('/invitations/accept').send({ token, name: 'New Staff', password: 'LongEnoughPassword1!' });
    expect(again.status).toBe(404);
    const login = await request(testApp()).post('/auth/login').send({ email: 'new.staff@alpha.test', password: 'LongEnoughPassword1!' });
    expect(login.status).toBe(200);
    const me = await authed(login.body.accessToken).get('/me');
    expect(me.body.roles[0].role).toBe('property_manager');
    // expired
    const exp = await a.post('/invitations').send({ email: 'late@alpha.test', role: 'tenant' });
    await prisma.invitation.update({ where: { id: exp.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const list = await a.get('/invitations');
    expect(list.body.items.find((i: { id: string }) => i.id === exp.body.id).status).toBe('expired');
    const revoke = await a.post(`/invitations/${exp.body.id}/revoke`);
    expect(revoke.status).toBe(409);
  });

  it('tenant role cannot invite or read users (denied path)', async () => {
    const tenant = await createUser(fx.a, 'tenant');
    const t = await asUser(tenant);
    expect((await t.post('/invitations').send({ email: 'x@alpha.test', role: 'tenant' })).status).toBe(403);
    expect((await t.get('/users')).status).toBe(403);
    const denied = await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'auth.login', actorId: tenant.id } });
    expect(denied).not.toBeNull();
  });

  it('role scope validation and revoke', async () => {
    const a = await asUser(fx.admins.a);
    const badScope = await a.post('/roles').send({ userId: fx.managers.a.id, role: 'tenant', scopeType: 'property', scopeId: fx.propA.id });
    expect(badScope.status).toBe(400);
    const ok = await a.post('/roles').send({ userId: fx.managers.a.id, role: 'landlord', scopeType: 'property', scopeId: fx.propA.id });
    expect(ok.status).toBe(201);
    const dupe = await a.post('/roles').send({ userId: fx.managers.a.id, role: 'landlord', scopeType: 'property', scopeId: fx.propA.id });
    expect(dupe.status).toBe(409);
    expect((await a.delete(`/roles/${ok.body.id}`)).status).toBe(204);
    const grant = await prisma.auditLog.findFirst({ where: { action: 'role.revoke', resourceId: ok.body.id } });
    expect(grant).not.toBeNull();
  });

  it('property-scoped role covers only that property; relationship grants access; revoke removes it', async () => {
    const other = await createProperty(fx.a, { name: 'Other Place' });
    const scoped = await createUser(fx.a, 'property_manager', undefined, { scopeType: 'property', scopeId: fx.propA.id });
    const s = await asUser(scoped);
    const inScope = await s.post('/access/check').send({ permission: 'property:write', resourceType: 'property', resourceId: fx.propA.id });
    expect(inScope.body).toMatchObject({ allowed: true, via: 'role' });
    const outScope = await s.post('/access/check').send({ permission: 'property:write', resourceType: 'property', resourceId: other.id });
    expect(outScope.body.allowed).toBe(false);
    const edge = await relate(fx.a, scoped.id, 'manages', 'property', other.id);
    const viaRel = await s.post('/access/check').send({ permission: 'property:write', resourceType: 'property', resourceId: other.id });
    expect(viaRel.body).toMatchObject({ allowed: true, via: 'relationship' });
    const a = await asUser(fx.admins.a);
    expect((await a.delete(`/relationships/${edge.id}`)).status).toBe(204);
    const after = await s.post('/access/check').send({ permission: 'property:write', resourceType: 'property', resourceId: other.id });
    expect(after.body.allowed).toBe(false);
  });

  it('permission catalog is available to role readers', async () => {
    const a = await asUser(fx.admins.a);
    const res = await a.get('/permissions');
    expect(res.status).toBe(200);
    expect(res.body.roles.tenant).toContain('maintenance:request');
  });

  it('self-protection: admin cannot suspend self', async () => {
    const a = await asUser(fx.admins.a);
    expect((await a.patch(`/users/${fx.admins.a.id}`).send({ status: 'suspended' })).status).toBe(409);
  });

  it('suspending a user revokes their sessions', async () => {
    const victim = await createUser(fx.a, 'tenant');
    const t = await loginAs(victim);
    const a = await asUser(fx.admins.a);
    expect((await a.patch(`/users/${victim.id}`).send({ status: 'suspended' })).status).toBe(200);
    expect((await authed(t.accessToken).get('/me')).status).toBe(401);
  });
});
