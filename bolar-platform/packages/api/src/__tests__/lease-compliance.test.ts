import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser, createProperty, createUnit } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';

/**
 * Cross-module integration (Days 24/45): a lease entering review is evaluated against the property's
 * jurisdiction rules; a block-level hit (CA deposit above one month) stops approval until the compliance
 * queue resolves it. Rules come from the base seed (packages/db/seed/index.ts).
 */
describe('lease review triggers compliance evaluation', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let leaseId: string;
  beforeAll(async () => {
    fx = await twoTenantFixture();
    const admin = await prisma.userProfile.findUniqueOrThrow({ where: { id: fx.admins.a.id } });
    await prisma.complianceRule.create({ data: { key: 'us-ca.deposit.max_one_month', version: 1, jurisdiction: 'US-CA', domain: 'deposit', title: 'California deposit cap (AB 12)', description: 'Deposit may not exceed one month rent.', severity: 'high', action: 'block', conditions: { all: [{ field: 'depositCents', op: 'gt_field', value: 'rentCents' }] }, effectiveFrom: new Date('2024-07-01'), status: 'active', approvedBy: admin.id } });
    const ca = await createProperty(fx.a, { name: 'Sunset CA', city: 'Los Angeles', state: 'CA' });
    const unit = await createUnit(fx.a, ca.id, '7');
    const m = await asUser(fx.managers.a);
    const profile = (await m.post('/tenant-profiles').send({ displayName: 'Dana Deposit', email: 'dana@alpha.test' })).body;
    const lease = await m.post('/leases').send({ propertyId: ca.id, unitId: unit.id, startDate: '2031-01-01', endDate: '2031-12-31', rentCents: 200000, depositCents: 400000, tenantProfileId: profile.id, termsJson: { term: '12 months' } });
    expect(lease.status).toBe(201);
    leaseId = lease.body.id;
  });

  it('persists a block evaluation on review and refuses approval until resolved', async () => {
    const m = await asUser(fx.managers.a);
    expect((await m.post(`/leases/${leaseId}/transition`).send({ to: 'review' })).status).toBe(200);
    const evals = await prisma.ruleEvaluation.findMany({ where: { tenantOrgId: fx.a.id, resourceType: 'lease', resourceId: leaseId } });
    expect(evals.map((e) => e.ruleKey)).toContain('us-ca.deposit.max_one_month');
    expect(evals.find((e) => e.ruleKey === 'us-ca.deposit.max_one_month')!.result).toBe('block');

    const a = await asUser(fx.admins.a);
    const blocked = await a.post(`/leases/${leaseId}/transition`).send({ to: 'approved' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/us-ca.deposit.max_one_month/);

    const officer = await createUser(fx.a, 'compliance_officer');
    const o = await asUser(officer);
    const queue = await o.get(`/rules/evaluations?resourceType=lease&resourceId=${leaseId}&reviewed=false`);
    expect(queue.status).toBe(200);
    const item = queue.body.items.find((e: { ruleKey: string }) => e.ruleKey === 'us-ca.deposit.max_one_month');
    expect((await o.post(`/rules/evaluations/${item.id}/resolve`).send({ resolution: 'remediated', note: 'Deposit reduced to one month per AB 12 before signing.' })).status).toBe(200);

    expect((await a.post(`/leases/${leaseId}/transition`).send({ to: 'approved' })).status).toBe(200);
    const audits = await prisma.auditLog.findMany({ where: { tenantOrgId: fx.a.id, action: 'compliance.evaluate', resourceId: leaseId } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
