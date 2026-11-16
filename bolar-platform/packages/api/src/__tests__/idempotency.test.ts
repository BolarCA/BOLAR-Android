import { describe, it, expect, beforeAll } from 'vitest';
import { resetDatabase, createOrg, createUser } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';

describe('idempotency and org control plane', () => {
  let pa: Awaited<ReturnType<typeof createUser>>;
  beforeAll(async () => {
    await resetDatabase();
    const platform = await createOrg('bolar-platform', 'Platform');
    pa = await createUser(platform, 'platform_admin', 'pa@platform.test', { isPlatform: true });
  });

  it('createOrg requires Idempotency-Key, replays identical requests, rejects changed payload', async () => {
    const p = await asUser(pa);
    const body = { slug: 'gamma-pm', name: 'Gamma PM', adminEmail: 'admin@gamma.test', adminName: 'Gail' };
    expect((await p.post('/orgs').send(body)).status).toBe(400);
    const first = await p.post('/orgs').set('Idempotency-Key', 'key-0001-abcdef').send(body);
    expect(first.status).toBe(201);
    const replay = await p.post('/orgs').set('Idempotency-Key', 'key-0001-abcdef').send(body);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
    expect(await prisma.tenantOrg.count({ where: { slug: 'gamma-pm' } })).toBe(1);
    const changed = await p.post('/orgs').set('Idempotency-Key', 'key-0001-abcdef').send({ ...body, name: 'Different' });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe('idempotency_conflict');
    const inv = await prisma.invitation.findFirst({ where: { tenantOrgId: first.body.id } });
    expect(inv?.role).toBe('org_admin');
    expect((await p.get('/orgs')).body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('concurrent requests with one key execute once (loser gets 409 in-progress or the replay); keys are actor-scoped', async () => {
    const p = await asUser(pa);
    const body = { slug: 'delta-pm', name: 'Delta PM', adminEmail: 'admin@delta.test', adminName: 'Dee' };
    const [r1, r2] = await Promise.all([
      p.post('/orgs').set('Idempotency-Key', 'key-0002-concurrent').send(body),
      p.post('/orgs').set('Idempotency-Key', 'key-0002-concurrent').send(body),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(201);
    expect([201, 409]).toContain(statuses[1]);
    if (statuses[1] === 409) expect([r1.body.code, r2.body.code]).toContain('idempotency_in_progress');
    expect(await prisma.tenantOrg.count({ where: { slug: 'delta-pm' } })).toBe(1);
    // the stored key is scoped to the acting user, so another user's identical key never replays this response
    const row = await prisma.idempotencyKey.findFirst({ where: { key: 'key-0002-concurrent' } });
    expect(row?.scope).toBe(`createOrg:${pa.id}`);
    expect(row?.responseCode).toBe(201);
    // after completion the same key replays
    const replay = await p.post('/orgs').set('Idempotency-Key', 'key-0002-concurrent').send(body);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
  });

  it('unknown routes return the error contract', async () => {
    const p = await asUser(pa);
    const res = await p.get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'not_found' });
    expect(res.body.requestId).toBeTruthy();
  });
});
