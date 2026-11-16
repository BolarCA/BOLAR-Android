import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { twoTenantFixture, createUser, TEST_PASSWORD } from '@bolar/testing';
import { prisma, hashPassword } from '@bolar/db';
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

  it('an e-mail present in two orgs signs in by password match, and never reveals itself with a 400 before the password is right', async () => {
    const dupA = await createUser(fx.a, 'tenant', 'dup@both.test');
    await createUser(fx.b, 'tenant', 'dup@both.test');
    const wrong = await request(testApp()).post('/auth/login').send({ email: 'dup@both.test', password: 'definitely-wrong-1' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('unauthenticated');
    // both accounts share the fixture password, so the caller has proven it and is asked which org
    const both = await request(testApp()).post('/auth/login').send({ email: 'dup@both.test', password: TEST_PASSWORD });
    expect(both.status).toBe(400);
    expect(both.body.fieldErrors[0].path).toBe('body.orgSlug');
    // a password that only one of the two accepts signs that one in without an orgSlug
    await prisma.userProfile.update({ where: { id: dupA.id }, data: { passwordHash: await hashPassword('OnlyAlphaKnows-99!') } });
    const one = await request(testApp()).post('/auth/login').send({ email: 'dup@both.test', password: 'OnlyAlphaKnows-99!' });
    expect(one.status).toBe(200);
    expect(one.body.org.slug).toBe('alpha-pm');
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

  it('rotates refresh tokens; reusing the replaced token revokes the whole session (theft detection)', async () => {
    const first = await loginAs(fx.admins.a);
    const r1 = await request(testApp()).post('/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(first.refreshToken);
    expect((await authed(r1.body.accessToken).get('/me')).status).toBe(200);
    const reuse = await request(testApp()).post('/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);
    // the live session (and its fresh refresh token) is revoked and the event is audited
    expect((await authed(r1.body.accessToken).get('/me')).status).toBe(401);
    expect((await request(testApp()).post('/auth/refresh').send({ refreshToken: r1.body.refreshToken })).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: 'auth.refresh_reuse_detected' } })).toBeGreaterThanOrEqual(1);
  });

  it('refresh is refused for a suspended org or a locked user', async () => {
    const u = await createUser(fx.a, 'tenant', 'refresh-checks@alpha.test');
    const t = await loginAs(u);
    await prisma.userProfile.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() + 60_000) } });
    expect((await request(testApp()).post('/auth/refresh').send({ refreshToken: t.refreshToken })).status).toBe(401);
    await prisma.userProfile.update({ where: { id: u.id }, data: { lockedUntil: null } });
    await prisma.tenantOrg.update({ where: { id: fx.a.id }, data: { status: 'suspended' } });
    try {
      expect((await request(testApp()).post('/auth/refresh').send({ refreshToken: t.refreshToken })).status).toBe(401);
    } finally {
      await prisma.tenantOrg.update({ where: { id: fx.a.id }, data: { status: 'active' } });
    }
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
    // the code already used above is refused (replay guard); the next time step's code is accepted
    expect((await authed(again.accessToken).post('/auth/mfa/verify').send({ code: totpCode(setup.body.secret) })).status).toBe(403);
    const verified = await authed(again.accessToken).post('/auth/mfa/verify').send({ code: totpCode(setup.body.secret, Date.now() + 30_000) });
    expect(verified.status).toBe(200);
    expect((await authed(verified.body.accessToken).get('/audit')).status).toBe(200);
  });

  it('cookie transport: refresh token travels only as an httpOnly cookie; refresh and logout use it', async () => {
    const login = await request(testApp()).post('/auth/login').set('X-Auth-Transport', 'cookie').send({ email: fx.managers.a.email, password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.refreshToken).toBeUndefined();
    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('bolar_rt='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const refreshed = await request(testApp()).post('/auth/refresh').set('X-Auth-Transport', 'cookie').set('Cookie', cookie.split(';')[0]!).send({});
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    expect(refreshed.body.refreshToken).toBeUndefined();
    const rotated = (refreshed.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('bolar_rt='))!;
    expect(rotated.split(';')[0]).not.toBe(cookie.split(';')[0]);
    // without a cookie or body token refresh is refused; logout clears the cookie
    expect((await request(testApp()).post('/auth/refresh').set('X-Auth-Transport', 'cookie').send({})).status).toBe(401);
    const out = await request(testApp()).post('/auth/logout').set('X-Auth-Transport', 'cookie').set('Cookie', rotated.split(';')[0]!).send({});
    expect(out.status).toBe(200);
    expect((out.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('bolar_rt='))).toMatch(/Max-Age=0/);
    expect((await authed(refreshed.body.accessToken).get('/me')).status).toBe(401);
  });

  it('MFA: re-enrollment needs an MFA-verified session; wrong codes lock the account; locks are not extended', async () => {
    const victim = await createUser(fx.a, 'tenant', 'mfa-lock@alpha.test');
    const t = await loginAs(victim);
    const setup = await authed(t.accessToken).post('/auth/mfa/setup');
    expect(setup.status).toBe(200);
    expect((await authed(t.accessToken).post('/auth/mfa/verify').send({ code: totpCode(setup.body.secret) })).status).toBe(200);

    // A fresh (pre-MFA) session may not rotate the authenticator secret.
    const again = await loginAs(victim);
    expect(again.mfaRequired).toBe(true);
    const denied = await authed(again.accessToken).post('/auth/mfa/setup');
    expect(denied.status).toBe(403);
    expect((await prisma.userProfile.findUniqueOrThrow({ where: { id: victim.id } })).mfaSecret).toBe(setup.body.secret);

    // Five wrong codes lock the account; the right code is then refused with the same message.
    const wrong = String((Number(totpCode(setup.body.secret)) + 7) % 1_000_000).padStart(6, '0');
    for (let i = 0; i < 5; i++) expect((await authed(again.accessToken).post('/auth/mfa/verify').send({ code: wrong })).status).toBe(403);
    const locked = await authed(again.accessToken).post('/auth/mfa/verify').send({ code: totpCode(setup.body.secret) });
    expect(locked.status).toBe(403);
    expect(locked.body.message).toBe('Invalid verification code');
    const u1 = await prisma.userProfile.findUniqueOrThrow({ where: { id: victim.id } });
    expect(u1.lockedUntil).not.toBeNull();

    // Attempts while locked (password or code) do not move lockedUntil.
    await request(testApp()).post('/auth/login').send({ email: victim.email, password: 'bad-password-xx' });
    await authed(again.accessToken).post('/auth/mfa/verify').send({ code: wrong });
    const u2 = await prisma.userProfile.findUniqueOrThrow({ where: { id: victim.id } });
    expect(u2.lockedUntil!.getTime()).toBe(u1.lockedUntil!.getTime());
    expect(u2.failedLogins).toBe(u1.failedLogins);

    // Once the lock passes, a verified session may re-enroll (next time step: the earlier code was already consumed).
    await prisma.userProfile.update({ where: { id: victim.id }, data: { lockedUntil: null, failedLogins: 0 } });
    const verified = await authed(again.accessToken).post('/auth/mfa/verify').send({ code: totpCode(setup.body.secret, Date.now() + 30_000) });
    expect(verified.status).toBe(200);
    expect((await authed(verified.body.accessToken).post('/auth/mfa/setup')).status).toBe(200);
  });

  it('validation errors carry fieldErrors and requestId', async () => {
    const res = await request(testApp()).post('/auth/login').send({ email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
    expect(res.body.fieldErrors.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(['body.email', 'body.password']));
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});
