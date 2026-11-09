import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser, createUnit, createProperty, relate } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';
import { evaluateAssignment, insuranceStatus } from '../modules/vendor/assignment.js';

type Agent = Awaited<ReturnType<typeof asUser>>;
const DAY = 86_400_000;

async function setup() {
  const fx = await twoTenantFixture();
  const unitA = await createUnit(fx.a, fx.propA.id, '201');
  const elmA = await createProperty(fx.a, { name: 'Elm Row' });
  const tenantA = await createUser(fx.a, 'tenant', 'resident@alpha.test');
  await relate(fx.a, tenantA.id, 'tenant_of', 'unit', unitA.id);
  const vendorUserA = await createUser(fx.a, 'vendor', 'plumber@alpha.test');
  const vendorB = await prisma.vendorProfile.create({ data: { tenantOrgId: fx.b.id, name: 'Beta Plumbing', status: 'approved', trades: ['plumbing'], insuranceExpiresAt: new Date(Date.now() + 90 * DAY) } });
  return { fx, unitA, elmA, tenantA, vendorUserA, vendorB };
}

describe('vendor: rolodex, approval, contracts, invitation, assignment rules (Day 33)', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  let manager: Agent; let managerB: Agent; let tenant: Agent;
  let vendorId: string; let workOrderId: string;
  beforeAll(async () => {
    s = await setup();
    manager = await asUser(s.fx.managers.a); managerB = await asUser(s.fx.managers.b); tenant = await asUser(s.tenantA);
  });

  it('assignment rule evaluation is pure and explains every failure', () => {
    const wo = { category: 'plumbing', propertyId: 'p1', estimateCents: 50_000 };
    const good = { status: 'approved', trades: ['plumbing'], coverageJson: { propertyIds: ['p1'] }, insuranceExpiresAt: new Date(Date.now() + 10 * DAY), budgetLimitCents: 60_000, userId: 'u' };
    expect(evaluateAssignment(good, wo)).toEqual({ eligible: true, reasons: [] });
    expect(evaluateAssignment({ ...good, status: 'pending' }, wo).reasons).toEqual(['vendor_not_approved']);
    expect(evaluateAssignment({ ...good, trades: ['electrical'] }, wo).reasons).toEqual(['trade_mismatch']);
    expect(evaluateAssignment({ ...good, trades: ['general'] }, wo).eligible).toBe(true); // general covers plumbing
    expect(evaluateAssignment({ ...good, coverageJson: { propertyIds: ['p2'] } }, wo).reasons).toEqual(['outside_coverage']);
    expect(evaluateAssignment({ ...good, coverageJson: {} }, wo).eligible).toBe(true); // empty coverage = all properties
    expect(evaluateAssignment({ ...good, insuranceExpiresAt: null }, wo).reasons).toEqual(['insurance_missing']);
    expect(evaluateAssignment({ ...good, insuranceExpiresAt: new Date(Date.now() - DAY) }, wo).reasons).toEqual(['insurance_expired']);
    expect(evaluateAssignment({ ...good, budgetLimitCents: 10_000 }, wo).reasons).toEqual(['over_budget']);
    expect(evaluateAssignment({ ...good, budgetLimitCents: 10_000 }, { ...wo, estimateCents: null }).eligible).toBe(true);
    expect(evaluateAssignment({ ...good, trades: ['cleaning'] }, { ...wo, category: 'other' }).eligible).toBe(true); // "other" accepts any trade
    expect(evaluateAssignment({ ...good, status: 'suspended', trades: ['pest'], insuranceExpiresAt: null, budgetLimitCents: 1 }, wo).reasons).toEqual(['vendor_not_approved', 'trade_mismatch', 'insurance_missing', 'over_budget']);
    expect(insuranceStatus(new Date(Date.now() + 5 * DAY))).toBe('expiring');
  });

  it('manager creates a pending vendor, approves it, and sees it in the rolodex; duplicates and tenants are refused', async () => {
    const created = await manager.post('/vendors').send({ name: 'Alpha Plumbing', trades: ['plumbing', 'hvac'], email: 'Dispatch@AlphaPlumbing.test', phone: '+15125550123', insuranceExpiresAt: new Date(Date.now() + 120 * DAY).toISOString(), coverage: { propertyIds: [s.fx.propA.id] }, budgetLimitCents: 150_000, userId: s.vendorUserA.id });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'pending', trades: ['plumbing', 'hvac'], email: 'dispatch@alphaplumbing.test', insuranceStatus: 'valid', openWorkOrders: 0, coverageJson: { propertyIds: [s.fx.propA.id], regions: [] } });
    vendorId = created.body.id;
    expect((await manager.post('/vendors').send({ name: 'alpha plumbing', trades: ['plumbing'] })).status).toBe(409);
    expect((await manager.post('/vendors').send({ name: 'No trades', trades: [] })).status).toBe(400);
    expect((await manager.post('/vendors').send({ name: 'Bad coverage', trades: ['pest'], coverage: { propertyIds: [s.fx.propB.id] } })).status).toBe(400);
    expect((await tenant.get('/vendors')).status).toBe(403);
    expect((await tenant.post('/vendors').send({ name: 'Nope', trades: ['pest'] })).status).toBe(403);
    const approved = await manager.post(`/vendors/${vendorId}/approve`);
    expect(approved.status).toBe(200); expect(approved.body.status).toBe('approved');
    expect((await manager.post(`/vendors/${vendorId}/approve`)).status).toBe(409);
    const list = await manager.get('/vendors?status=approved&trade=hvac');
    expect(list.body.items.map((v: { id: string }) => v.id)).toEqual([vendorId]);
    expect(await prisma.auditLog.findFirst({ where: { action: 'vendor.approve', resourceId: vendorId } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: 'vendor.create', resourceId: vendorId } })).not.toBeNull();
  });

  it('tenant isolation: org B cannot read, update or approve org A vendors and never lists them', async () => {
    expect((await managerB.get(`/vendors/${vendorId}`)).status).toBe(404);
    expect((await managerB.patch(`/vendors/${vendorId}`).send({ name: 'pwned' })).status).toBe(404);
    expect((await managerB.post(`/vendors/${vendorId}/suspend`)).status).toBe(404);
    expect((await managerB.post(`/vendors/${vendorId}/contracts`).send({ kind: 'msa', storageKey: 'x/y.pdf' })).status).toBe(404);
    const list = await managerB.get('/vendors');
    expect(list.body.items.map((v: { id: string }) => v.id)).toEqual([s.vendorB.id]);
    expect((await prisma.vendorProfile.findUnique({ where: { id: vendorId } }))!.name).toBe('Alpha Plumbing');
    // linking a user from another org is refused
    expect((await manager.patch(`/vendors/${vendorId}`).send({ userId: s.fx.managers.b.id })).status).toBe(400);
  });

  it('eligible vendors for a work order come back with reasons; assignment rejects ineligible vendors with field errors', async () => {
    const wo = await tenant.post('/work-orders').send({ title: 'Leaking shower valve', description: 'Constant drip behind the wall, tile is getting damp.', category: 'plumbing', priority: 'high' });
    workOrderId = wo.body.id;
    await manager.post(`/work-orders/${workOrderId}/transition`).send({ to: 'triaged' });
    const electrician = await manager.post('/vendors').send({ name: 'Sparky Electric', trades: ['electrical'], insuranceExpiresAt: new Date(Date.now() + 30 * DAY).toISOString() });
    await manager.post(`/vendors/${electrician.body.id}/approve`);
    const uninsured = await manager.post('/vendors').send({ name: 'Cheap Pipes', trades: ['plumbing'], insuranceExpiresAt: new Date(Date.now() - DAY).toISOString(), coverage: { propertyIds: [s.elmA.id] } });
    expect(uninsured.status).toBe(201);
    const eligible = await manager.get(`/vendors/eligible?workOrderId=${workOrderId}`);
    expect(eligible.status).toBe(200);
    expect(eligible.body.category).toBe('plumbing');
    const byName = Object.fromEntries(eligible.body.items.map((i: { vendor: { name: string }; eligible: boolean; reasons: string[] }) => [i.vendor.name, i]));
    expect(byName['Alpha Plumbing']).toMatchObject({ eligible: true, reasons: [] });
    expect(byName['Sparky Electric']).toMatchObject({ eligible: false, reasons: ['trade_mismatch'] });
    expect(byName['Cheap Pipes'].reasons).toEqual(['vendor_not_approved', 'outside_coverage', 'insurance_expired']);
    expect(eligible.body.items[0].vendor.name).toBe('Alpha Plumbing'); // eligible first
    const bad = await manager.post(`/work-orders/${workOrderId}/assign`).send({ vendorId: uninsured.body.id });
    expect(bad.status).toBe(400);
    expect(bad.body.fieldErrors.map((f: { message: string }) => f.message)).toEqual(['vendor_not_approved', 'outside_coverage', 'insurance_expired']);
    // over budget: estimate above the vendor cap
    await manager.patch(`/work-orders/${workOrderId}`).send({ estimateCents: 200_000 });
    const over = await manager.post(`/work-orders/${workOrderId}/assign`).send({ vendorId });
    expect(over.status).toBe(400); expect(over.body.fieldErrors[0].message).toBe('over_budget');
    await manager.patch(`/work-orders/${workOrderId}`).send({ estimateCents: 90_000 });
    expect((await manager.post(`/work-orders/${workOrderId}/assign`).send({ vendorId, userId: s.fx.managers.a.id })).status).toBe(400); // exactly one
    const ok = await manager.post(`/work-orders/${workOrderId}/assign`).send({ vendorId });
    expect(ok.status).toBe(200); expect(ok.body.status).toBe('assigned');
    expect((await managerB.get(`/vendors/eligible?workOrderId=${workOrderId}`)).status).toBe(404);
    expect((await tenant.get(`/vendors/eligible?workOrderId=${workOrderId}`)).status).toBe(403);
    const detail = await manager.get(`/vendors/${vendorId}`);
    expect(detail.body.openWorkOrders).toBe(1);
    const jobs = await manager.get(`/vendors/${vendorId}/work-orders`);
    expect(jobs.body.items.map((w: { id: string }) => w.id)).toEqual([workOrderId]);
  });

  it('suspending a vendor blocks new assignments but keeps existing jobs visible to the vendor login', async () => {
    const suspended = await manager.post(`/vendors/${vendorId}/suspend`);
    expect(suspended.status).toBe(200); expect(suspended.body.status).toBe('suspended');
    const wo2 = await tenant.post('/work-orders').send({ title: 'Second plumbing issue', description: 'Toilet runs continuously after flushing.', category: 'plumbing', priority: 'normal' });
    await manager.post(`/work-orders/${wo2.body.id}/transition`).send({ to: 'triaged' });
    const res = await manager.post(`/work-orders/${wo2.body.id}/assign`).send({ vendorId });
    expect(res.status).toBe(400); expect(res.body.fieldErrors[0].message).toBe('vendor_not_approved');
    const vendorAgent = await asUser(s.vendorUserA);
    expect((await vendorAgent.get(`/work-orders/${workOrderId}`)).status).toBe(200);
    expect((await vendorAgent.get(`/work-orders/${wo2.body.id}`)).status).toBe(404);
    await manager.post(`/vendors/${vendorId}/approve`);
  });

  it('contracts: insurance certificate updates the expiry; list is paginated and tenant-scoped', async () => {
    const until = new Date(Date.now() + 365 * DAY).toISOString();
    const cert = await manager.post(`/vendors/${vendorId}/contracts`).send({ kind: 'insurance_certificate', storageKey: 'vendors/alpha/coi-2026.pdf', startsAt: new Date().toISOString(), endsAt: until });
    expect(cert.status).toBe(201); expect(cert.body.kind).toBe('insurance_certificate');
    expect((await manager.get(`/vendors/${vendorId}`)).body.insuranceExpiresAt).toBe(until);
    expect((await manager.post(`/vendors/${vendorId}/contracts`).send({ kind: 'msa' })).status).toBe(400); // storageKey or documentId
    expect((await manager.post(`/vendors/${vendorId}/contracts`).send({ kind: 'msa', documentId: 'doc_123' })).status).toBe(201);
    const list = await manager.get(`/vendors/${vendorId}/contracts`);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.map((c: { kind: string }) => c.kind).sort()).toEqual(['insurance_certificate', 'msa']);
    expect((await managerB.get(`/vendors/${vendorId}/contracts`)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'vendor.contract.create', resourceId: vendorId } })).toBe(2);
  });

  it('invite: creates a vendor-role invitation with a 7-day token; already-linked vendors and duplicate emails are refused', async () => {
    const fresh = await manager.post('/vendors').send({ name: 'Green Lawns', trades: ['landscaping'] });
    const inv = await manager.post(`/vendors/${fresh.body.id}/invite`).send({ email: 'Crew@GreenLawns.test' });
    expect(inv.status).toBe(201);
    expect(inv.body).toMatchObject({ role: 'vendor', status: 'pending', email: 'crew@greenlawns.test' });
    expect(inv.body.acceptUrl).toContain('token=');
    const row = await prisma.invitation.findUnique({ where: { id: inv.body.invitationId } });
    expect(row).toMatchObject({ role: 'vendor', scopeType: 'org', tenantOrgId: s.fx.a.id });
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * DAY);
    expect((await manager.get(`/vendors/${fresh.body.id}`)).body.email).toBe('crew@greenlawns.test');
    expect((await manager.post(`/vendors/${fresh.body.id}/invite`).send({ email: 'crew@greenlawns.test' })).status).toBe(409);
    expect((await manager.post(`/vendors/${vendorId}/invite`).send({ email: 'someone@alpha.test' })).status).toBe(409); // already linked
    expect((await manager.post(`/vendors/${fresh.body.id}/invite`).send({ email: s.fx.managers.a.email })).status).toBe(409); // existing user
    expect(await prisma.auditLog.findFirst({ where: { action: 'vendor.invite', resourceId: fresh.body.id } })).not.toBeNull();
  });

  it('update: trades/coverage/budget/insurance change the eligibility outcome', async () => {
    const wo = await tenant.post('/work-orders').send({ title: 'Breaker trips', description: 'Kitchen breaker trips when the microwave and kettle run together.', category: 'electrical', priority: 'normal' });
    await manager.post(`/work-orders/${wo.body.id}/transition`).send({ to: 'triaged' });
    let eligible = await manager.get(`/vendors/eligible?workOrderId=${wo.body.id}`);
    const alpha = () => eligible.body.items.find((i: { vendor: { id: string } }) => i.vendor.id === vendorId);
    expect(alpha().reasons).toEqual(['trade_mismatch']);
    const upd = await manager.patch(`/vendors/${vendorId}`).send({ trades: ['plumbing', 'hvac', 'electrical'], coverage: { propertyIds: [], regions: ['Austin'] }, budgetLimitCents: null });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ trades: ['plumbing', 'hvac', 'electrical'], budgetLimitCents: null, coverageJson: { propertyIds: [], regions: ['Austin'] } });
    eligible = await manager.get(`/vendors/eligible?workOrderId=${wo.body.id}`);
    expect(alpha().eligible).toBe(true);
    expect((await manager.patch(`/vendors/${vendorId}`).send({ insuranceExpiresAt: new Date(Date.now() - DAY).toISOString() })).body.insuranceStatus).toBe('expired');
    eligible = await manager.get(`/vendors/eligible?workOrderId=${wo.body.id}`);
    expect(alpha().reasons).toEqual(['insurance_expired']);
    expect(await prisma.auditLog.count({ where: { action: 'vendor.update', resourceId: vendorId } })).toBe(2);
  });
});
