/**
 * Rate limiting (Days 91-104, ADR 0006). Uses the in-memory store with a fake clock; client IPs are simulated with
 * X-Forwarded-For (the app trusts one proxy hop) because loopback is a trusted address outside production.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { twoTenantFixture, createUser, createOrg, TEST_PASSWORD } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { systemContext } from '@bolar/shared';
import { testApp, loginAs } from './helpers.js';
import { MemoryRateLimitStore, RateLimiter, configureRateLimiterForTests, resetRateLimiterForTests, policiesFor, RATE_LIMIT_WINDOW_MS } from '../shared/rate-limit.js';
import { config } from '../config.js';

let clock = Date.UTC(2026, 10, 9, 12, 0, 0);
const now = () => clock;
let store: MemoryRateLimitStore;

function limiterFor(limits: Partial<{ RATE_LIMIT_LOGIN_PER_IP: number; RATE_LIMIT_LOGIN_PER_EMAIL: number; RATE_LIMIT_PUBLIC_PER_IP: number; RATE_LIMIT_AUTHED_PER_ACTOR: number }> = {}) {
  store = new MemoryRateLimitStore();
  configureRateLimiterForTests({ enabled: true, store, now, limits: { RATE_LIMIT_LOGIN_PER_IP: 10, RATE_LIMIT_LOGIN_PER_EMAIL: 5, RATE_LIMIT_PUBLIC_PER_IP: 3, RATE_LIMIT_AUTHED_PER_ACTOR: 5, ...limits } });
}

const from = (ip: string) => ({ 'X-Forwarded-For': ip });

describe('rate limits (sliding window, per IP / e-mail / actor, platform exempt)', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  beforeAll(async () => { fx = await twoTenantFixture(); });
  beforeEach(() => { clock = Date.UTC(2026, 10, 9, 12, 0, 0); limiterFor(); });
  afterAll(() => resetRateLimiterForTests());

  it('login: 10/min per IP, then 429 with Retry-After, audited once per window, allowed again as the window slides', async () => {
    const app = testApp();
    const ip = '203.0.113.10';
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post('/auth/login').set(from(ip)).send({ email: `nobody${i}@alpha.test`, password: 'wrong-password' });
      expect(r.status, `attempt ${i + 1}`).toBe(401);
      // the tightest policy is reported: per-e-mail (5, one hit each) until the per-IP budget drops below it
      expect(Number(r.headers['ratelimit-remaining'])).toBe(Math.min(4, 10 - (i + 1)));
    }
    const blocked = await request(app).post('/auth/login').set(from(ip)).send({ email: 'nobody-x@alpha.test', password: 'wrong-password' });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'rate_limited', message: 'Too many requests; try again later' });
    expect(blocked.body.requestId).toBeTruthy();
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
    // a correct password does not get through either while limited
    const stillBlocked = await request(app).post('/auth/login').set(from(ip)).send({ email: fx.managers.a.email, password: TEST_PASSWORD });
    expect(stillBlocked.status).toBe(429);
    const audits = await prisma.auditLog.findMany({ where: { action: 'rate_limit.exceeded' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ policy: 'login_ip', limit: 10, path: '/auth/login' });
    expect(JSON.stringify(audits[0]!.metadata)).not.toContain(ip); // key is hashed, raw IP not stored in metadata
    // 90 s later the sliding estimate (1 + 12 * 0.5) is under the limit again
    clock += 90_000;
    const again = await request(app).post('/auth/login').set(from(ip)).send({ email: 'nobody-y@alpha.test', password: 'wrong-password' });
    expect(again.status).toBe(401);
    // another IP was never affected
    const other = await request(app).post('/auth/login').set(from('203.0.113.11')).send({ email: fx.managers.a.email, password: TEST_PASSWORD });
    expect(other.status).toBe(200);
  });

  it('login: 5/min per e-mail across IPs with the same generic error; other e-mails keep their budget', async () => {
    const app = testApp();
    const victim = (await createUser(fx.a, 'tenant', 'victim.rl@alpha.test')).email; // dedicated account: 5 failures also trigger the lockout
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/auth/login').set(from(`198.51.100.${i + 1}`)).send({ email: victim.toUpperCase(), password: 'wrong-password' });
      expect(r.status).toBe(401);
    }
    const blocked = await request(app).post('/auth/login').set(from('198.51.100.9')).send({ email: victim, password: TEST_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.message).toBe('Too many requests; try again later');
    // unknown e-mail from the same IPs: same generic 401 as before (existence not leaked by the limiter)
    const unknown = await request(app).post('/auth/login').set(from('198.51.100.9')).send({ email: 'ghost@alpha.test', password: 'wrong-password' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe('Invalid email, password, or organization');
    const other = await request(app).post('/auth/login').set(from('198.51.100.9')).send({ email: fx.managers.b.email, password: TEST_PASSWORD });
    expect(other.status).toBe(200);
  });

  it('public intake endpoints: 60/min per IP (3 here), separate budgets per endpoint and per webhook provider', async () => {
    const app = testApp();
    const ip = '192.0.2.5';
    for (let i = 0; i < 3; i++) expect((await request(app).post('/invitations/accept').set(from(ip)).send({ token: 'x'.repeat(40), name: 'N', password: 'LongEnoughPassword1!' })).status).toBe(404);
    expect((await request(app).post('/invitations/accept').set(from(ip)).send({ token: 'x'.repeat(40), name: 'N', password: 'LongEnoughPassword1!' })).status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await request(app).post('/privacy-requests/intake').set(from(ip)).send({})).status).toBe(400);
    expect((await request(app).post('/privacy-requests/intake').set(from(ip)).send({})).status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await request(app).post('/webhooks/stripe').set(from(ip)).set('Content-Type', 'application/json').send('{}')).status).not.toBe(429);
    expect((await request(app).post('/webhooks/stripe').set(from(ip)).set('Content-Type', 'application/json').send('{}')).status).toBe(429);
    // another provider from the same IP has its own budget
    expect((await request(app).post('/webhooks/plaid').set(from(ip)).set('Content-Type', 'application/json').send('{}')).status).not.toBe(429);
    // another IP is unaffected
    expect((await request(app).post('/webhooks/stripe').set(from('192.0.2.6')).set('Content-Type', 'application/json').send('{}')).status).not.toBe(429);
    const audits = await prisma.auditLog.findMany({ where: { action: 'rate_limit.exceeded', createdAt: { gte: new Date(Date.now() - 60_000) } }, orderBy: { createdAt: 'asc' } });
    expect(audits.filter((a) => (a.metadata as { policy: string }).policy === 'public_ip')).toHaveLength(3);
  });

  it('authenticated: 600/min per actor (5 here); one tenant or actor bursting never consumes another budget', async () => {
    const app = testApp();
    const ip = '203.0.113.77';
    const a = await loginAs(fx.managers.a);
    const b = await loginAs(fx.managers.b);
    const adminA = await loginAs(fx.admins.a);
    for (let i = 0; i < 5; i++) expect((await request(app).get('/me').set(from(ip)).set('Authorization', `Bearer ${a.accessToken}`)).status).toBe(200);
    const blocked = await request(app).get('/me').set(from(ip)).set('Authorization', `Bearer ${a.accessToken}`);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    // same IP, other tenant's actor: full budget
    for (let i = 0; i < 5; i++) expect((await request(app).get('/me').set(from(ip)).set('Authorization', `Bearer ${b.accessToken}`)).status).toBe(200);
    // same tenant, other actor: full budget
    expect((await request(app).get('/me').set(from(ip)).set('Authorization', `Bearer ${adminA.accessToken}`)).status).toBe(200);
    // audit row is scoped to the bursting tenant and actor, and written once per window
    await request(app).get('/me').set(from(ip)).set('Authorization', `Bearer ${a.accessToken}`);
    const audits = await prisma.auditLog.findMany({ where: { action: 'rate_limit.exceeded', actorId: fx.managers.a.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]!.tenantOrgId).toBe(fx.a.id);
    expect(audits[0]!.metadata).toMatchObject({ policy: 'actor', limit: 5 });
    // after 2 full windows the budget is fully restored
    clock += 2 * RATE_LIMIT_WINDOW_MS;
    expect((await request(app).get('/me').set(from(ip)).set('Authorization', `Bearer ${a.accessToken}`)).status).toBe(200);
  });

  it('platform admins are exempt from the per-actor limit; trusted IPs bypass every policy', async () => {
    const app = testApp();
    const platformOrg = await createOrg('bolar-platform-rl', 'BOLAR Platform');
    const admin = await createUser(platformOrg, 'platform_admin', 'root@platform-rl.test', { isPlatform: true });
    const tok = await loginAs(admin);
    for (let i = 0; i < 8; i++) expect((await request(app).get('/me').set(from('203.0.113.200')).set('Authorization', `Bearer ${tok.accessToken}`)).status).toBe(200);
    // loopback (no X-Forwarded-For) is trusted outside production: 12 failed logins, none throttled
    for (let i = 0; i < 12; i++) expect((await request(app).post('/auth/login').send({ email: `nobody${i}@beta.test`, password: 'wrong-password' })).status).toBe(401);
  });

  it('fails open when the store is broken and can be disabled by config', async () => {
    const app = testApp();
    configureRateLimiterForTests({ enabled: true, now, store: { kind: 'memory', hit: async () => { throw new Error('store down'); }, markAudited: async () => false } });
    for (let i = 0; i < 3; i++) expect((await request(app).post('/invitations/accept').set(from('192.0.2.50')).send({ token: 'x'.repeat(40), name: 'N', password: 'LongEnoughPassword1!' })).status).toBe(404);
    configureRateLimiterForTests({ enabled: false, store: new MemoryRateLimitStore(), limits: { RATE_LIMIT_PUBLIC_PER_IP: 1 } });
    for (let i = 0; i < 3; i++) expect((await request(app).post('/invitations/accept').set(from('192.0.2.51')).send({ token: 'x'.repeat(40), name: 'N', password: 'LongEnoughPassword1!' })).status).toBe(404);
  });

  it('unit: sliding window math and policy mapping', async () => {
    const s = new MemoryRateLimitStore();
    let t = 1_000_000 - (1_000_000 % 60_000); // window start
    const limiter = new RateLimiter(s, () => t);
    const policy = { name: 'test', key: 'k', limit: 4, windowMs: 60_000 };
    for (let i = 0; i < 4; i++) expect((await limiter.check(policy)).allowed).toBe(true);
    const d = await limiter.check(policy);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSeconds).toBe(60);
    t += 90_000; // halfway through the next window: previous 5 hits weigh 0.5 -> 2.5 + 1 = 3.5 allowed
    expect((await limiter.check(policy)).allowed).toBe(true);
    expect((await limiter.check(policy)).allowed).toBe(false); // 2 + 2.5 = 4.5 > 4
    t += 60_000; // two windows after the burst: previous window had 2 hits -> 1 + 2*0.5 = 2
    expect((await limiter.check(policy)).allowed).toBe(true);

    const cfg = config();
    const anon = systemContext(null);
    const asActor = { ...systemContext('org1'), actor: { userId: 'u1', email: 'u@x', name: 'U', isPlatform: false, mfaVerified: true } };
    expect(policiesFor({ method: 'POST', path: '/auth/login', ip: '1.2.3.4', body: { email: 'A@x.test' }, ctx: anon }, cfg).map((p) => p.name)).toEqual(['login_ip', 'login_email']);
    expect(policiesFor({ method: 'POST', path: '/auth/login', ip: '1.2.3.4', body: { email: 'a@x.test' }, ctx: anon }, cfg)[1]!.key).toBe(policiesFor({ method: 'POST', path: '/auth/login', ip: '9.9.9.9', body: { email: ' A@X.TEST ' }, ctx: anon }, cfg)[1]!.key);
    expect(policiesFor({ method: 'POST', path: '/webhooks/stripe/', ip: '1.2.3.4', body: null, ctx: anon }, cfg)[0]!.key).toBe('public:webhook:stripe:ip:1.2.3.4');
    expect(policiesFor({ method: 'GET', path: '/properties', ip: '1.2.3.4', body: null, ctx: anon }, cfg)).toEqual([]);
    expect(policiesFor({ method: 'GET', path: '/properties', ip: '1.2.3.4', body: null, ctx: asActor }, cfg)[0]!.key).toBe('actor:org1:u1');
    expect(policiesFor({ method: 'GET', path: '/properties', ip: '127.0.0.1', body: null, ctx: asActor }, cfg)).toEqual([]);
    const platform = { ...asActor, roles: [{ role: 'platform_admin' as const, scopeType: 'platform' as const, scopeId: null }] };
    expect(policiesFor({ method: 'GET', path: '/orgs', ip: '1.2.3.4', body: null, ctx: platform }, cfg)).toEqual([]);
  });
});
