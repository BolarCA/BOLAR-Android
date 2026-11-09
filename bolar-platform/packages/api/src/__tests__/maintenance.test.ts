import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser, createUnit, relate } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';
import { drainMemoryQueue } from '../shared/queue.js';

type Agent = Awaited<ReturnType<typeof asUser>>;
const HOUR = 3_600_000;

/** Org A: Maple unit 101 with a resident, an approved plumbing vendor with a portal login; org B mirrors the shape. */
async function setup() {
  const fx = await twoTenantFixture();
  const unitA = await createUnit(fx.a, fx.propA.id, '101');
  const tenantA = await createUser(fx.a, 'tenant', 'resident@alpha.test');
  await relate(fx.a, tenantA.id, 'tenant_of', 'unit', unitA.id);
  const otherTenantA = await createUser(fx.a, 'tenant', 'other.resident@alpha.test');
  const vendorUserA = await createUser(fx.a, 'vendor', 'plumber@alpha.test');
  const vendorA = await prisma.vendorProfile.create({ data: { tenantOrgId: fx.a.id, userId: vendorUserA.id, name: 'Alpha Plumbing', status: 'approved', trades: ['plumbing', 'hvac'], insuranceExpiresAt: new Date(Date.now() + 90 * 24 * HOUR), coverageJson: { propertyIds: [] }, budgetLimitCents: 100_000 } });
  const unitB = await createUnit(fx.b, fx.propB.id, '101');
  const tenantB = await createUser(fx.b, 'tenant', 'resident@beta.test');
  await relate(fx.b, tenantB.id, 'tenant_of', 'unit', unitB.id);
  return { fx, unitA, tenantA, otherTenantA, vendorUserA, vendorA, unitB, tenantB };
}

const request = (overrides: Record<string, unknown> = {}) => ({ title: 'Kitchen sink leaking badly', description: 'Water is pooling under the sink and the cabinet floor is soaked.', category: 'plumbing', priority: 'emergency', entryPermission: 'granted', ...overrides });

describe('maintenance: requests, work order state machine, SLA, access (Days 31-35)', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  let tenant: Agent; let manager: Agent; let vendor: Agent; let managerB: Agent;
  beforeAll(async () => {
    s = await setup();
    tenant = await asUser(s.tenantA); manager = await asUser(s.fx.managers.a); vendor = await asUser(s.vendorUserA); managerB = await asUser(s.fx.managers.b);
  });

  it('tenant submits an emergency request: unit resolved from occupancy, 24h SLA, created event, audit + domain event', async () => {
    drainMemoryQueue();
    const res = await tenant.post('/work-orders').send(request({ availability: [{ start: new Date(Date.now() + HOUR).toISOString(), end: new Date(Date.now() + 3 * HOUR).toISOString() }] }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'new', requesterKind: 'tenant', unitId: s.unitA.id, propertyId: s.fx.propA.id, priority: 'emergency', possibleDuplicateId: null, overdue: false });
    expect(res.body.number).toMatch(/^WO-[A-Z0-9]{6}$/);
    expect(res.body.unit.unitNumber).toBe('101');
    const sla = new Date(res.body.slaDueAt).getTime() - new Date(res.body.createdAt).getTime();
    expect(Math.abs(sla - 24 * HOUR)).toBeLessThan(5000);
    const events = await prisma.workOrderEvent.findMany({ where: { workOrderId: res.body.id } });
    expect(events.map((e) => e.eventType)).toEqual(['created']);
    expect(await prisma.auditLog.findFirst({ where: { action: 'work_order.create', resourceId: res.body.id, actorId: s.tenantA.id } })).not.toBeNull();
    const published = drainMemoryQueue('domain-events').map((j) => (j.data as { name: string }).name);
    expect(published).toContain('work_order.created');
  });

  it('validates the request: short description, bad availability window, unknown category', async () => {
    expect((await tenant.post('/work-orders').send(request({ description: 'short' }))).status).toBe(400);
    const bad = await tenant.post('/work-orders').send(request({ availability: [{ start: new Date(Date.now() + 2 * HOUR).toISOString(), end: new Date(Date.now() + HOUR).toISOString() }] }));
    expect(bad.status).toBe(400);
    expect(bad.body.fieldErrors[0].path).toContain('availability');
    expect((await tenant.post('/work-orders').send(request({ category: 'magic' }))).status).toBe(400);
  });

  it('a resident without an occupied unit cannot file, and staff creation needs an explicit property in scope', async () => {
    const noUnit = await asUser(s.otherTenantA);
    const res = await noUnit.post('/work-orders').send(request());
    expect(res.status).toBe(400);
    expect(res.body.fieldErrors[0].path).toBe('body.unitId');
    const staff = await manager.post('/work-orders').send(request({ title: 'Hallway light out', category: 'electrical', priority: 'low', propertyId: s.fx.propA.id }));
    expect(staff.status).toBe(201);
    expect(staff.body).toMatchObject({ requesterKind: 'staff', unitId: null });
    expect(Math.abs(new Date(staff.body.slaDueAt).getTime() - new Date(staff.body.createdAt).getTime() - 14 * 24 * HOUR)).toBeLessThan(5000);
    const crossOrg = await manager.post('/work-orders').send(request({ propertyId: s.fx.propB.id }));
    expect(crossOrg.status).toBe(400);
  });

  it('duplicate hint for same unit + category within 7 days; manager marks duplicate which cancels it', async () => {
    const first = await tenant.post('/work-orders').send(request({ title: 'Bathroom faucet drips', priority: 'normal' }));
    const second = await tenant.post('/work-orders').send(request({ title: 'Faucet still dripping', priority: 'normal' }));
    expect(second.status).toBe(201);
    expect(second.body.possibleDuplicateId).toBeTruthy();
    const self = await manager.post(`/work-orders/${second.body.id}/mark-duplicate`).send({ duplicateOfId: second.body.id });
    expect(self.status).toBe(400);
    const dup = await manager.post(`/work-orders/${second.body.id}/mark-duplicate`).send({ duplicateOfId: first.body.id });
    expect(dup.status).toBe(200);
    expect(dup.body).toMatchObject({ status: 'canceled', duplicateOfId: first.body.id });
    const types = (await prisma.workOrderEvent.findMany({ where: { workOrderId: second.body.id }, orderBy: { createdAt: 'asc' } })).map((e) => e.eventType);
    expect(types).toEqual(['created', 'duplicate', 'status_changed']);
    // canceled orders are hidden from the default list but visible with includeCanceled
    const list = await manager.get('/work-orders?limit=100');
    expect(list.body.items.map((w: { id: string }) => w.id)).not.toContain(second.body.id);
    const all = await manager.get('/work-orders?limit=100&includeCanceled=true');
    expect(all.body.items.map((w: { id: string }) => w.id)).toContain(second.body.id);
  });

  it('tenant isolation: org B never sees org A work orders (list, detail, transition)', async () => {
    const mine = await tenant.post('/work-orders').send(request({ title: 'Isolation probe', category: 'hvac', priority: 'high' }));
    const listB = await managerB.get('/work-orders?limit=100');
    expect(listB.status).toBe(200);
    expect(listB.body.items.map((w: { id: string }) => w.id)).not.toContain(mine.body.id);
    expect((await managerB.get(`/work-orders/${mine.body.id}`)).status).toBe(404);
    expect((await managerB.post(`/work-orders/${mine.body.id}/transition`).send({ to: 'triaged' })).status).toBe(404);
    expect((await managerB.patch(`/work-orders/${mine.body.id}`).send({ priority: 'low' })).status).toBe(404);
    expect((await prisma.workOrder.findUnique({ where: { id: mine.body.id } }))!.status).toBe('new');
  });

  it('residents only see their own requests or their unit; denial is 404 with an access.denied audit row', async () => {
    const mine = await tenant.post('/work-orders').send(request({ title: 'Private request', category: 'pest', priority: 'low' }));
    const other = await asUser(s.otherTenantA);
    const res = await other.get(`/work-orders/${mine.body.id}`);
    expect(res.status).toBe(404);
    const denied = await prisma.auditLog.findFirst({ where: { tenantOrgId: s.fx.a.id, action: 'access.denied', resourceType: 'work_order', resourceId: mine.body.id, actorId: s.otherTenantA.id, outcome: 'deny' } });
    expect(denied).not.toBeNull();
    const list = await other.get('/work-orders');
    expect(list.body.items).toEqual([]);
    const own = await tenant.get('/work-orders?limit=100');
    expect(own.body.items.every((w: { requesterId: string; unitId: string }) => w.requesterId === s.tenantA.id || w.unitId === s.unitA.id)).toBe(true);
  });

  it('state machine: triage -> assign (auto assigned + assigned_to edge) -> vendor schedules -> in_progress -> blocked (note) -> review -> complete -> tenant reopens', async () => {
    const created = await tenant.post('/work-orders').send(request({ title: 'Journey leak' }));
    const id = created.body.id as string;
    // tenant cannot triage; vendor cannot see it yet
    expect((await tenant.post(`/work-orders/${id}/transition`).send({ to: 'triaged' })).status).toBe(403);
    expect((await vendor.get(`/work-orders/${id}`)).status).toBe(404);
    // illegal jump
    const jump = await manager.post(`/work-orders/${id}/transition`).send({ to: 'complete' });
    expect(jump.status).toBe(409); expect(jump.body.code).toBe('invalid_transition');
    // assign before triage is a conflict
    expect((await manager.post(`/work-orders/${id}/assign`).send({ vendorId: s.vendorA.id })).status).toBe(409);
    const triaged = await manager.post(`/work-orders/${id}/transition`).send({ to: 'triaged' });
    expect(triaged.status).toBe(200);
    expect(triaged.body.allowedTransitions).toEqual(expect.arrayContaining(['canceled']));
    expect(triaged.body.allowedTransitions).not.toContain('assigned'); // no assignee yet
    // assigned transition without assignee is refused by the guard
    expect((await manager.post(`/work-orders/${id}/transition`).send({ to: 'assigned' })).status).toBe(409);
    drainMemoryQueue();
    const assigned = await manager.post(`/work-orders/${id}/assign`).send({ vendorId: s.vendorA.id });
    expect(assigned.status).toBe(200);
    expect(assigned.body).toMatchObject({ status: 'assigned', assignedVendorId: s.vendorA.id });
    expect(assigned.body.vendor.name).toBe('Alpha Plumbing');
    const edge = await prisma.relationshipEdge.findFirst({ where: { tenantOrgId: s.fx.a.id, subjectId: s.vendorUserA.id, relation: 'assigned_to', objectType: 'work_order', objectId: id, endsAt: null } });
    expect(edge).not.toBeNull();
    expect(drainMemoryQueue('domain-events').map((j) => (j.data as { name: string }).name)).toEqual(expect.arrayContaining(['work_order.assigned', 'work_order.transitioned']));
    // vendor now sees it, with vendor actor kind, and must provide scheduledFor
    const asVendor = await vendor.get(`/work-orders/${id}`);
    expect(asVendor.status).toBe(200);
    expect(asVendor.body.actorKinds).toEqual(['vendor']);
    expect(asVendor.body.allowedTransitions).toEqual(expect.arrayContaining(['scheduled', 'triaged']));
    expect((await vendor.post(`/work-orders/${id}/transition`).send({ to: 'scheduled' })).status).toBe(409);
    const when = new Date(Date.now() + 26 * HOUR).toISOString();
    const scheduled = await vendor.post(`/work-orders/${id}/transition`).send({ to: 'scheduled', scheduledFor: when });
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.scheduledFor).toBe(when);
    // vendor may not use manager-only transitions
    expect((await vendor.post(`/work-orders/${id}/transition`).send({ to: 'canceled', note: 'nope' })).status).toBe(403);
    expect((await vendor.post(`/work-orders/${id}/transition`).send({ to: 'in_progress' })).status).toBe(200);
    expect((await vendor.post(`/work-orders/${id}/transition`).send({ to: 'blocked' })).status).toBe(409); // note required
    expect((await vendor.post(`/work-orders/${id}/transition`).send({ to: 'blocked', note: 'Waiting on a replacement valve' })).status).toBe(200);
    expect((await vendor.post(`/work-orders/${id}/transition`).send({ to: 'in_progress' })).status).toBe(200);
    const review = await vendor.post(`/work-orders/${id}/transition`).send({ to: 'review', actualCents: 42_000 });
    expect(review.status).toBe(200); expect(review.body.actualCents).toBe(42_000);
    // vendor cannot complete; tenant cannot complete; manager completes
    expect((await vendor.post(`/work-orders/${id}/transition`).send({ to: 'complete' })).status).toBe(403);
    expect((await tenant.post(`/work-orders/${id}/transition`).send({ to: 'complete' })).status).toBe(403);
    const complete = await manager.post(`/work-orders/${id}/transition`).send({ to: 'complete' });
    expect(complete.status).toBe(200); expect(complete.body.completedAt).toBeTruthy(); expect(complete.body.overdue).toBe(false);
    // tenant requester reopens within 30 days
    const reopened = await tenant.post(`/work-orders/${id}/transition`).send({ to: 'reopened', note: 'Leak is back' });
    expect(reopened.status).toBe(200); expect(reopened.body.reopenedCount).toBe(1);
    expect((await manager.post(`/work-orders/${id}/transition`).send({ to: 'triaged' })).status).toBe(200);
    const statuses = (await prisma.workOrderEvent.findMany({ where: { workOrderId: id, eventType: 'status_changed' }, orderBy: { createdAt: 'asc' } })).map((e) => (e.payload as { to: string }).to);
    expect(statuses).toEqual(['triaged', 'assigned', 'scheduled', 'in_progress', 'blocked', 'in_progress', 'review', 'complete', 'reopened', 'triaged']);
    expect(await prisma.auditLog.count({ where: { action: 'work_order.transition', resourceId: id } })).toBe(10);
  });

  it('reopen window closes after 30 days', async () => {
    const wo = await prisma.workOrder.create({ data: { tenantOrgId: s.fx.a.id, propertyId: s.fx.propA.id, unitId: s.unitA.id, requesterId: s.tenantA.id, title: 'Old fix', description: 'Completed long ago.', category: 'appliance', status: 'complete', completedAt: new Date(Date.now() - 45 * 24 * HOUR) } });
    const res = await tenant.post(`/work-orders/${wo.id}/transition`).send({ to: 'reopened' });
    expect(res.status).toBe(409); expect(res.body.code).toBe('invalid_transition');
  });

  it('vendor denial: assigned vendor declines with a note -> back to triaged, assignment cleared, edge ended', async () => {
    const created = await manager.post('/work-orders').send(request({ title: 'Declined job', propertyId: s.fx.propA.id, unitId: s.unitA.id }));
    const id = created.body.id as string;
    await manager.post(`/work-orders/${id}/transition`).send({ to: 'triaged' });
    await manager.post(`/work-orders/${id}/assign`).send({ vendorId: s.vendorA.id });
    expect((await vendor.post(`/work-orders/${id}/transition`).send({ to: 'triaged' })).status).toBe(409);
    const declined = await vendor.post(`/work-orders/${id}/transition`).send({ to: 'triaged', note: 'No capacity this week' });
    expect(declined.status).toBe(200);
    expect(declined.body).toMatchObject({ status: 'triaged', assignedVendorId: null, vendor: null });
    expect(await prisma.relationshipEdge.findFirst({ where: { relation: 'assigned_to', objectId: id, endsAt: null } })).toBeNull();
    expect((await vendor.get(`/work-orders/${id}`)).status).toBe(404);
    expect((await prisma.workOrderEvent.findMany({ where: { workOrderId: id } })).map((e) => e.eventType)).toContain('unassigned');
  });

  it('vendor access is limited to assigned jobs: list, detail, transition and notes on unassigned orders are denied and audited', async () => {
    const unassigned = await tenant.post('/work-orders').send(request({ title: 'Not yours', category: 'electrical', priority: 'normal' }));
    const list = await vendor.get('/work-orders?limit=100');
    expect(list.status).toBe(200);
    expect(list.body.items.every((w: { assignedVendorId: string | null }) => w.assignedVendorId === s.vendorA.id)).toBe(true);
    expect(list.body.items.map((w: { id: string }) => w.id)).not.toContain(unassigned.body.id);
    expect((await vendor.get(`/work-orders/${unassigned.body.id}`)).status).toBe(404);
    expect((await vendor.post(`/work-orders/${unassigned.body.id}/transition`).send({ to: 'in_progress' })).status).toBe(404);
    expect((await vendor.post(`/work-orders/${unassigned.body.id}/notes`).send({ body: 'hi' })).status).toBe(404);
    expect((await vendor.patch(`/work-orders/${unassigned.body.id}`).send({ priority: 'low' })).status).toBe(403); // no work_order:write at all
    expect((await vendor.post(`/work-orders/${unassigned.body.id}/assign`).send({ vendorId: s.vendorA.id })).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: 'access.denied', resourceId: unassigned.body.id, actorId: s.vendorUserA.id } })).toBeGreaterThanOrEqual(3);
  });

  it('tenant may cancel only while new/triaged and only with a note', async () => {
    const a = await tenant.post('/work-orders').send(request({ title: 'Cancel me', category: 'other', priority: 'low' }));
    expect((await tenant.post(`/work-orders/${a.body.id}/transition`).send({ to: 'canceled' })).status).toBe(409);
    expect((await tenant.post(`/work-orders/${a.body.id}/transition`).send({ to: 'canceled', note: 'Fixed it myself' })).status).toBe(200);
    const b = await tenant.post('/work-orders').send(request({ title: 'Too late to cancel', category: 'structural', priority: 'high' }));
    await manager.post(`/work-orders/${b.body.id}/transition`).send({ to: 'triaged' });
    await manager.post(`/work-orders/${b.body.id}/assign`).send({ userId: s.fx.managers.a.id });
    const late = await tenant.post(`/work-orders/${b.body.id}/transition`).send({ to: 'canceled', note: 'changed my mind' });
    expect(late.status).toBe(409);
    expect((await manager.post(`/work-orders/${b.body.id}/transition`).send({ to: 'canceled', note: 'Owner declined the repair' })).status).toBe(200);
  });

  it('SLA: priority change recomputes slaDueAt; scan marks overdue open orders once and publishes work_order.sla_breached', async () => {
    const created = await manager.post('/work-orders').send(request({ title: 'Slow drain', priority: 'normal', propertyId: s.fx.propA.id, unitId: s.unitA.id }));
    const id = created.body.id as string;
    const bumped = await manager.patch(`/work-orders/${id}`).send({ priority: 'high' });
    expect(bumped.status).toBe(200);
    expect(Math.abs(new Date(bumped.body.slaDueAt).getTime() - new Date(bumped.body.createdAt).getTime() - 72 * HOUR)).toBeLessThan(5000);
    expect((await prisma.workOrderEvent.findMany({ where: { workOrderId: id } })).map((e) => e.eventType)).toContain('escalated');
    await prisma.workOrder.update({ where: { id }, data: { slaDueAt: new Date(Date.now() - 2 * HOUR) } });
    const overdueList = await manager.get('/work-orders?overdue=true&limit=100');
    expect(overdueList.body.items.map((w: { id: string }) => w.id)).toContain(id);
    expect(overdueList.body.items.find((w: { id: string }) => w.id === id).overdue).toBe(true);
    expect((await tenant.post('/work-orders/sla/scan')).status).toBe(403);
    drainMemoryQueue();
    const scan = await manager.post('/work-orders/sla/scan');
    expect(scan.status).toBe(200);
    expect(scan.body.breached).toContain(id);
    expect(drainMemoryQueue('domain-events').map((j) => (j.data as { name: string }).name)).toContain('work_order.sla_breached');
    const again = await manager.post('/work-orders/sla/scan');
    expect(again.body.breached).not.toContain(id);
    expect(await prisma.workOrderEvent.count({ where: { workOrderId: id, eventType: 'sla_breached' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'work_order.sla_breached', resourceId: id } })).toBe(1);
    // completing clears overdue
    await manager.post(`/work-orders/${id}/transition`).send({ to: 'triaged' });
    await manager.post(`/work-orders/${id}/transition`).send({ to: 'canceled', note: 'Resident fixed it' });
    expect((await manager.get(`/work-orders/${id}`)).body.overdue).toBe(false);
  });

  it('notes and timeline: requester and manager add notes; events endpoint paginates in order', async () => {
    const created = await tenant.post('/work-orders').send(request({ title: 'Notes thread', category: 'safety', priority: 'high' }));
    const id = created.body.id as string;
    const n1 = await tenant.post(`/work-orders/${id}/notes`).send({ body: 'Smoke detector chirps every minute.', kind: 'message' });
    expect(n1.status).toBe(201); expect(n1.body.eventType).toBe('message'); expect(n1.body.actorName).toBe(s.tenantA.name);
    expect((await manager.post(`/work-orders/${id}/notes`).send({ body: 'Battery swap scheduled.' })).status).toBe(201);
    const events = await manager.get(`/work-orders/${id}/events?limit=2`);
    expect(events.body.items.map((e: { eventType: string }) => e.eventType)).toEqual(['created', 'message']);
    expect(events.body.nextCursor).toBeTruthy();
    const next = await manager.get(`/work-orders/${id}/events?limit=2&cursor=${events.body.nextCursor}`);
    expect(next.body.items[0].eventType).toBe('note');
    const detail = await tenant.get(`/work-orders/${id}`);
    expect(detail.body.events).toHaveLength(3);
    expect(detail.body.actorKinds).toEqual(['tenant']);
  });

  it('list filters: status[], priority, property, assignedVendorId, mine, q', async () => {
    const byStatus = await manager.get('/work-orders?status=new,triaged&limit=100');
    expect(byStatus.body.items.every((w: { status: string }) => ['new', 'triaged'].includes(w.status))).toBe(true);
    const byPriority = await manager.get('/work-orders?priority=emergency&limit=100');
    expect(byPriority.body.items.every((w: { priority: string }) => w.priority === 'emergency')).toBe(true);
    const byVendor = await manager.get(`/work-orders?assignedVendorId=${s.vendorA.id}&includeCanceled=true&limit=100`);
    expect(byVendor.body.items.every((w: { assignedVendorId: string }) => w.assignedVendorId === s.vendorA.id)).toBe(true);
    const mine = await manager.get('/work-orders?mine=true&limit=100');
    expect(mine.body.items.length).toBeGreaterThan(0);
    expect(mine.body.items.every((w: { requesterId: string; assignedUserId: string | null }) => w.requesterId === s.fx.managers.a.id || w.assignedUserId === s.fx.managers.a.id)).toBe(true);
    const q = await manager.get('/work-orders?q=journey&limit=100');
    expect(q.body.items.map((w: { title: string }) => w.title)).toContain('Journey leak');
    expect((await manager.get('/work-orders?status=bogus')).status).toBe(400);
  });

  it('property-scoped manager only sees orders on their property; a manages relationship widens it', async () => {
    const other = await prisma.property.create({ data: { tenantOrgId: s.fx.a.id, name: 'Elm Row', addressLine1: '1 Elm', city: 'Austin', state: 'TX', postalCode: '78702' } });
    const onOther = await manager.post('/work-orders').send(request({ title: 'Elm gutter', category: 'structural', priority: 'low', propertyId: other.id }));
    const scopedUser = await createUser(s.fx.a, 'property_manager', 'scoped@alpha.test', { scopeType: 'property', scopeId: s.fx.propA.id });
    const scoped = await asUser(scopedUser);
    const list = await scoped.get('/work-orders?limit=100');
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items.every((w: { propertyId: string }) => w.propertyId === s.fx.propA.id)).toBe(true);
    expect((await scoped.get(`/work-orders/${onOther.body.id}`)).status).toBe(404);
    await relate(s.fx.a, scopedUser.id, 'manages', 'property', other.id);
    expect((await scoped.get(`/work-orders/${onOther.body.id}`)).status).toBe(200);
    expect((await scoped.post(`/work-orders/${onOther.body.id}/transition`).send({ to: 'triaged' })).status).toBe(200);
  });
});
