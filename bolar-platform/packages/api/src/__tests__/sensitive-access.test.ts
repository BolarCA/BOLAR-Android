import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { systemContext } from '@bolar/shared';
import { asUser } from './helpers.js';
import { requireSensitiveAccess, clearedClassificationFor } from '../shared/access.js';

describe('sensitive access gate (Day 14)', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  beforeAll(async () => { fx = await twoTenantFixture(); });

  it('request -> cannot self-approve -> approve by another -> expires/revokes', async () => {
    const m = await asUser(fx.managers.a);
    const req = await m.post('/sensitive-access/requests').send({ resourceType: 'tenant_profile', resourceId: 'tp_1', classification: 'restricted', purpose: 'lease_administration', justification: 'Need SSN last4 to verify identity for lease renewal.' });
    expect(req.status).toBe(201);
    const dup = await m.post('/sensitive-access/requests').send({ resourceType: 'tenant_profile', resourceId: 'tp_1', classification: 'restricted', purpose: 'lease_administration', justification: 'Need SSN last4 to verify identity for lease renewal.' });
    expect(dup.status).toBe(409);
    expect((await m.post(`/sensitive-access/requests/${req.body.id}/decide`).send({ decision: 'approved' })).status).toBe(403);
    const lawyer = await createUser(fx.a, 'lawyer');
    const l = await asUser(lawyer);
    const approved = await l.post(`/sensitive-access/requests/${req.body.id}/decide`).send({ decision: 'approved', ttlHours: 2 });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    const ctx = { ...systemContext(fx.a.id), actor: { userId: fx.managers.a.id, email: '', name: '', isPlatform: false, mfaVerified: true } };
    await expect(requireSensitiveAccess(ctx, { resourceType: 'tenant_profile', resourceId: 'tp_1', classification: 'restricted' })).resolves.toBeUndefined();
    await expect(requireSensitiveAccess(ctx, { resourceType: 'tenant_profile', resourceId: 'tp_2', classification: 'restricted' })).rejects.toMatchObject({ code: 'review_required' });
    expect(await clearedClassificationFor(ctx, 'tenant_profile', 'tp_1')).toBe('restricted');
    expect(await clearedClassificationFor(ctx, 'tenant_profile', 'tp_2')).toBe('internal');
    const revoked = await l.post(`/sensitive-access/requests/${req.body.id}/revoke`);
    expect(revoked.status).toBe(200);
    await expect(requireSensitiveAccess(ctx, { resourceType: 'tenant_profile', resourceId: 'tp_1', classification: 'restricted' })).rejects.toMatchObject({ code: 'review_required' });
    const audits = await prisma.auditLog.findMany({ where: { tenantOrgId: fx.a.id, action: 'sensitive.access' } });
    expect(audits.some((a) => a.outcome === 'allow')).toBe(true);
    expect(audits.some((a) => a.outcome === 'review_required')).toBe(true);
  });

  it('non-gated classifications pass; permission + purpose passes without a request', async () => {
    const ctx = { ...systemContext(fx.a.id), actor: { userId: fx.managers.a.id, email: '', name: '', isPlatform: false, mfaVerified: true } };
    await expect(requireSensitiveAccess(ctx, { resourceType: 'property', resourceId: 'p1', classification: 'internal' })).resolves.toBeUndefined();
    const withPerm = { ...ctx, permissions: new Set(['tenant_profile:read_sensitive'] as const), purpose: 'compliance_review' as const };
    await expect(requireSensitiveAccess(withPerm, { resourceType: 'tenant_profile', resourceId: 'tp_9', classification: 'confidential' }, 'tenant_profile:read_sensitive')).resolves.toBeUndefined();
    const noPurpose = { ...withPerm, purpose: null };
    await expect(requireSensitiveAccess(noPurpose, { resourceType: 'tenant_profile', resourceId: 'tp_9', classification: 'confidential' }, 'tenant_profile:read_sensitive')).rejects.toMatchObject({ code: 'review_required' });
  });

  it('requests list is scoped: requesters see own, approvers see all', async () => {
    const m = await asUser(fx.managers.a);
    const mine = await m.get('/sensitive-access/requests');
    expect(mine.body.items.every((r: { actorId: string }) => r.actorId === fx.managers.a.id)).toBe(true);
    const b = await asUser(fx.managers.b);
    expect((await b.get('/sensitive-access/requests')).body.items).toHaveLength(0);
  });
});
