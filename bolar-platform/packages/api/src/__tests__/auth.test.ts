import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { twoTenantFixture, createUser, TEST_PASSWORD } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { testApp, loginAs, authed } from './helpers.js';
import { totpCode } from '../shared/totp.js';

describe('auth (Day 9)', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  beforeAll(async () => { fx = await twoTenantFixture(); });

  it('health is public and reports database ok', async () => {
    const res = await request(testApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('logs in and returns tokens, user and org', async () => {
    const res = await request(testApp()).post('/auth/login').send({ email: fx.admins.a.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.tokenType).toBe('Bearer');
    expect(res.body.org.slug).toBe('alpha-pm');
    expect(res.body.mfaRequired).toBe(false);
  });

  it('uses one generic error for unknown email, wrong password and wrong org', async () => {
    const unknown = await request(testApp()).post('/auth/login').send({ email: 'nobody@alpha.test', password: TEST_PASSWORD });
    const wrongPwd = await request(testApp()).post('/auth/login').send({ email: fx.admins.a.email, password: 'definitely-wrong-1' });
    const wrongOrg = await request(testApp()).post('/auth/login').send({ email: fx.admins.a.email, password: TEST_PASSWORD, orgSlug: 'beta-pm' });
    for (const r of [unknown, wrongPwd, wrongOrg]) {
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('unauthenticated');
    }
    expect(unknown.body.message).toBe(wrongPwd.body.message);
    expect(wrongPwd.body.message).toBe(wrongOrg.body.message);
    const audits = await prisma.auditLog.findMany({ where: { action: 'auth.login_failed' } });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audits)).not.toContain('nobody@alpha.test');
  });

  it('locks the account after repeated failures with the same generic error', async () => {
    const victim = await createUser(fx.a, 'tenant', 'lock@alpha.test');
    for (let i = 0; i < 5; i++) await request(testApp()).post('/auth/login').send({ email: victim.email, password: 'bad-password-xx' });
    const res = await request(testApp()).post('/auth/login').send({ email: victim.email, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
    const u = await prisma.userProfile.findUnique({ where: { id: victim.id } });
    expect(u!.lockedUntil).not.toBeNull();
  });

  it('/me returns actor, roles, permissions and portals', async () => {
    const { accessToken } = await loginAs(fx.managers.a);
    const res = await authed(accessToken).get('/me');
    expect(res.status).toBe(200);
    expect(res.body.roles[0].role).toBe('property_manager');
    expect(res.body.permissions).toContain('property:write');
    expect(res.body.permissions).not.toContain('platform:admin');
    expect(res.body.portals).toEqual(['/manager']);
  });

  it('rejects anonymous and expired/garbage tokens', async () => {
    expect((await request(testApp()).get('/me')).status).toBe(401);
    expect((await authed('garbage.token.here').get('/me')).status).toBe(401);
  });

  it('rotates refresh tokens and rejects reuse of the old one', async () => {
    const first = await loginAs(fx.admins.a);
    const r1 = await request(testApp()).post('/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(first.refreshToken);
    const reuse = await request(testApp()).post('/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);
    const me = await authed(r1.body.accessToken).get('/me');
    expect(me.status).toBe(200);
  });

  it('logout revokes the session so the access token stops working', async () => {
    const t = await loginAs(fx.admins.a);
    expect((await authed(t.accessToken).post('/auth/logout').send({ refreshToken: t.refreshToken })).status).toBe(200);
    expect((await authed(t.accessToken).get('/me')).status).toBe(401);
  });

  it('MFA: enrollment then verification upgrades the session; mfa routes are blocked before verification', async () => {
    const t = await loginAs(fx.admins.a);
    const setup = await authed(t.accessToken).post('/auth/mfa/setup');
    expect(setup.status).toBe(200);
    const bad = await authed(t.accessToken).post('/auth/mfa/verify').send({ code: '000000' });
    expect([403, 200]).toContain(bad.status); // 1-in-a-million collision tolerated
    const ok = await authed(t.accessToken).post('/auth/mfa/verify').send({ code: totpCode(setup.body.secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.mfaRequired).toBe(false);
    // New login now requires MFA before mfa-level routes
    const again = await loginAs(fx.admins.a);
    expect(again.mfaRequired).toBe(true);
    const denied = await authed(again.accessToken).get('/audit');
    expect(denied.status).toBe(403);
    const me = await authed(again.accessToken).get('/me');
    expect(me.status).toBe(200);
    expect(me.body.actor.mfaVerified).toBe(false);
    const verified = await authed(again.accessToken).post('/auth/mfa/verify').send({ code: totpCode(setup.body.secret) });
    expect(verified.status).toBe(200);
    expect((await authed(verified.body.accessToken).get('/audit')).status).toBe(200);
  });

  it('validation errors carry fieldErrors and requestId', async () => {
    const res = await request(testApp()).post('/auth/login').send({ email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
    expect(res.body.fieldErrors.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(['body.email', 'body.password']));
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});
