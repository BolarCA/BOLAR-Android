import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser, createUnit, type UserFixture } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';
import { drainMemoryQueue } from '../shared/queue.js';

type Api = Awaited<ReturnType<typeof asUser>>;

describe('leases: draft model, overlap, lifecycle state machine, permissions (Days 22-25)', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let landlord: UserFixture;
  let tenantUser: UserFixture;
  let unitA: { id: string; unitNumber: string };
  let unitB: { id: string };
  let profileId: string;
  let profile2Id: string;
  let m: Api;
  let l: Api;
  let a: Api;

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);

  beforeAll(async () => {
    fx = await twoTenantFixture();
    landlord = await createUser(fx.a, 'landlord');
    tenantUser = await createUser(fx.a, 'tenant');
    unitA = await createUnit(fx.a, fx.propA.id, '101');
    unitB = await createUnit(fx.a, fx.propA.id, '102');
    m = await asUser(fx.managers.a);
    l = await asUser(landlord);
    a = await asUser(fx.admins.a);
    profileId = (await m.post('/tenant-profiles').send({ displayName: 'Theo Tenant', email: 'theo@alpha.test', userId: tenantUser.id, status: 'applicant' })).body.id;
    profile2Id = (await m.post('/tenant-profiles').send({ displayName: 'Casey Cotenant', email: 'casey@alpha.test' })).body.id;
  });

  async function draft(api: Api, overrides: Record<string, unknown> = {}) {
    const res = await api.post('/leases').send({ propertyId: fx.propA.id, unitId: unitA.id, startDate: '2031-01-01', endDate: '2031-12-31', rentCents: 150000, depositCents: 150000, tenantProfileId: profileId, termsJson: { term: '12 months', pets: 'none' }, ...overrides });
    return res;
  }
  const go = (api: Api, id: string, to: string, extra: Record<string, unknown> = {}) => api.post(`/leases/${id}/transition`).send({ to, ...extra });

  it('validates property/unit/tenant and date range on create; returns parties, charges, version and next states', async () => {
    const wrongProperty = await m.post('/leases').send({ propertyId: fx.propB.id, unitId: unitA.id, startDate: '2031-01-01', endDate: '2031-12-31', rentCents: 100000 });
    expect(wrongProperty.status).toBe(400);
    const badDates = await draft(m, { startDate: '2031-12-31', endDate: '2031-01-01' });
    expect(badDates.status).toBe(400);
    const badTenant = await draft(m, { tenantProfileId: 'nope' });
    expect(badTenant.status).toBe(400);
    const zeroRent = await draft(m, { rentCents: 0 });
    expect(zeroRent.status).toBe(400);

    const res = await draft(m);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.parties).toHaveLength(1);
    expect(res.body.parties[0]).toMatchObject({ role: 'primary', displayName: 'Theo Tenant' });
    expect(res.body.charges[0]).toMatchObject({ type: 'rent', amountCents: 150000 });
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.currentVersion.version).toBe(1);
    expect(res.body.unit.unitNumber).toBe('101');
    expect(res.body.property.name).toBe('Shared Name Tower');
    expect(res.body.allowedNextStates.sort()).toEqual(['canceled', 'review']);
    expect(await prisma.auditLog.findFirst({ where: { action: 'lease.create', resourceId: res.body.id } })).not.toBeNull();
    expect(drainMemoryQueue('domain-events').some((j) => j.data.name === 'lease.created')).toBe(true);
  });

  it('enforces no active-lease overlap on the same unit (drafts do not block; approved+ do) and on PATCH', async () => {
    const first = (await m.get('/leases?status=draft')).body.items[0];
    const second = await draft(m); // another draft on the same dates is fine
    expect(second.status).toBe(201);
    expect((await go(m, first.id, 'review')).status).toBe(200);
    expect((await go(l, first.id, 'approved')).status).toBe(200);
    const blocked = await draft(m, { startDate: '2031-06-01', endDate: '2032-05-31' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('conflict');
    const adjacent = await draft(m, { startDate: '2032-01-01', endDate: '2032-12-31' });
    expect(adjacent.status).toBe(201);
    // the overlapping draft now shows the blocker in its detail and cannot be approved
    const detail = await m.get(`/leases/${second.body.id}`);
    expect(detail.body.overlaps).toHaveLength(1);
    expect(detail.body.overlaps[0].id).toBe(first.id);
    expect((await go(m, second.body.id, 'review')).status).toBe(200);
    const approve = await go(l, second.body.id, 'approved');
    expect(approve.status).toBe(409);
    expect(approve.body.code).toBe('conflict');
    const l2 = await l.get(`/leases/${second.body.id}`);
    expect(l2.body.transitions.find((t: { to: string }) => t.to === 'approved')).toMatchObject({ allowed: false });
    // PATCH into the occupied window is rejected; PATCH on a non-draft is rejected
    expect((await m.patch(`/leases/${adjacent.body.id}`).send({ startDate: '2031-11-01' })).status).toBe(409);
    expect((await m.patch(`/leases/${adjacent.body.id}`).send({ rentCents: 160000 })).status).toBe(200);
    expect((await m.patch(`/leases/${first.id}`).send({ rentCents: 1 })).status).toBe(409);
    expect((await go(m, second.body.id, 'draft', { note: 'Unit double-booked; re-plan dates.' })).status).toBe(200);
    expect((await go(m, second.body.id, 'canceled')).status).toBe(200);
    expect((await go(m, adjacent.body.id, 'canceled')).status).toBe(200);
  });

  it('runs the full lifecycle with actor rules, required artifacts, occupancy side effects and audit/events', async () => {
    const lease = (await m.get('/leases?status=approved')).body.items[0];
    drainMemoryQueue();
    // approved -> sent needs lease:send (manager has it); landlord does not
    expect((await go(l, lease.id, 'sent')).status).toBe(403);
    expect((await go(m, lease.id, 'sent')).status).toBe(200);
    // sent -> signed needs an artifact
    const noArtifact = await go(m, lease.id, 'signed');
    expect(noArtifact.status).toBe(409);
    expect(noArtifact.body.code).toBe('invalid_transition');
    const signed = await go(m, lease.id, 'signed', { signedAt: '2030-12-15' });
    expect(signed.status).toBe(200);
    expect(signed.body.parties[0].signedAt).toContain('2030-12-15');
    // signed -> active: start date is years away, so explicit activation is required
    const tooEarly = await go(m, lease.id, 'active');
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.message).toMatch(/explicit activation/);
    const active = await go(m, lease.id, 'active', { activate: true });
    expect(active.status).toBe(200);
    expect(active.body.unit.status).toBe('occupied');
    const history = await prisma.unitStatusHistory.findMany({ where: { unitId: unitA.id } });
    expect(history.map((h) => h.toStatus)).toContain('occupied');
    // renewal needs a new version before it can go active again
    expect((await go(m, lease.id, 'renewal')).status).toBe(200);
    expect((await go(m, lease.id, 'active')).status).toBe(409);
    expect((await m.post(`/leases/${lease.id}/versions`).send({ termsJson: { term: '12 months', rentCents: 155000 } })).status).toBe(201);
    const renewed = await go(m, lease.id, 'active');
    expect(renewed.status).toBe(200);
    expect(renewed.body.currentVersion.version).toBe(2);
    // termination: approver only, note required, unit goes to notice
    expect((await go(m, lease.id, 'terminated', { note: 'x' })).status).toBe(403);
    expect((await go(l, lease.id, 'terminated')).status).toBe(400);
    const terminated = await go(l, lease.id, 'terminated', { note: 'Tenant gave 60-day notice.' });
    expect(terminated.status).toBe(200);
    expect(terminated.body.unit.status).toBe('notice');
    expect(terminated.body.allowedNextStates).toEqual([]);
    // illegal transition from a terminal state
    const illegal = await go(m, lease.id, 'active');
    expect(illegal.status).toBe(409);
    expect(illegal.body.code).toBe('invalid_transition');

    const transitions = await prisma.auditLog.findMany({ where: { action: 'lease.transition', resourceId: lease.id }, orderBy: { createdAt: 'asc' } });
    const path = transitions.map((t) => (t.after as { status: string }).status);
    expect(path).toEqual(['review', 'approved', 'sent', 'signed', 'active', 'renewal', 'active', 'terminated']);
    expect((transitions.at(-1)!.metadata as { note: string }).note).toBe('Tenant gave 60-day notice.');
    const events = drainMemoryQueue('domain-events').map((j) => j.data.name);
    expect(events.filter((n) => n === 'lease.transitioned')).toHaveLength(6);
    expect(events).toContain('lease.signed');
    expect(events).toContain('unit.status_changed');
    const timeline = await m.get(`/leases/${lease.id}/timeline`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.items.length).toBeGreaterThanOrEqual(9);
  });

  it('review gate: approver cannot be the creator, reject requires a note, review failures reopen as draft', async () => {
    const own = await a.post('/leases').send({ propertyId: fx.propA.id, unitId: unitB.id, startDate: '2031-01-01', endDate: '2031-12-31', rentCents: 120000, tenantProfileId: profile2Id, termsJson: { term: '12 months' } });
    expect(own.status).toBe(201);
    expect((await go(a, own.body.id, 'review')).status).toBe(200);
    const self = await go(a, own.body.id, 'approved');
    expect(self.status).toBe(403);
    expect(self.body.message).toMatch(/creator/);
    expect((await go(l, own.body.id, 'draft')).status).toBe(400);
    const rejected = await go(l, own.body.id, 'draft', { note: 'Counsel: late fee clause exceeds TX cap; revise section 4.' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe('draft');
    // a lease without any party cannot be submitted for review; one without terms cannot be sent
    const empty = await m.post('/leases').send({ propertyId: fx.propA.id, unitId: unitB.id, startDate: '2033-01-01', endDate: '2033-12-31', rentCents: 120000 });
    expect(empty.status).toBe(201);
    const noParty = await go(m, empty.body.id, 'review');
    expect(noParty.status).toBe(409);
    expect(noParty.body.message).toMatch(/party/);
    expect((await m.post(`/leases/${empty.body.id}/parties`).send({ tenantProfileId: profile2Id, role: 'primary' })).status).toBe(201);
    expect((await m.post(`/leases/${empty.body.id}/parties`).send({ tenantProfileId: profile2Id, role: 'co_tenant' })).status).toBe(409);
    expect((await m.post(`/leases/${empty.body.id}/charges`).send({ type: 'parking', amountCents: 7500 })).status).toBe(201);
    expect((await go(m, empty.body.id, 'review')).status).toBe(200);
    expect((await go(l, empty.body.id, 'approved')).status).toBe(200);
    const noTerms = await go(m, empty.body.id, 'sent');
    expect(noTerms.status).toBe(409);
    expect(noTerms.body.message).toMatch(/version/);
    expect((await go(m, empty.body.id, 'canceled')).status).toBe(200);
    expect((await go(a, own.body.id, 'canceled')).status).toBe(200);
  });

  it('tenants see only leases they are a party to; other leases are 404 with an access.denied audit; writes are 403', async () => {
    const t = await asUser(tenantUser);
    const mine = await t.get('/leases');
    expect(mine.status).toBe(200);
    expect(mine.body.items.length).toBeGreaterThan(0);
    expect(mine.body.items.every((x: { parties: { userId: string | null }[] }) => x.parties.some((p) => p.userId === tenantUser.id))).toBe(true);
    const detail = await t.get(`/leases/${mine.body.items[0].id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.allowedNextStates).toEqual([]);
    const notMine = await prisma.lease.findFirstOrThrow({ where: { tenantOrgId: fx.a.id, parties: { none: { tenantProfileId: profileId } } } });
    expect((await t.get(`/leases/${notMine.id}`)).status).toBe(404);
    expect(await prisma.auditLog.findFirst({ where: { action: 'access.denied', actorId: tenantUser.id, resourceId: notMine.id } })).not.toBeNull();
    expect((await t.post('/leases').send({ propertyId: fx.propA.id, unitId: unitA.id, startDate: '2040-01-01', endDate: '2040-12-31', rentCents: 1000 })).status).toBe(403);
    expect((await t.post(`/leases/${mine.body.items[0].id}/transition`).send({ to: 'canceled' })).status).toBe(403);
    expect((await t.get('/leases/form-options')).status).toBe(403);
  });

  it('permission matrix: vendor denied, lawyer/bookkeeper read-only, property-scoped manager limited to own property', async () => {
    const vendor = await asUser(await createUser(fx.a, 'vendor'));
    expect((await vendor.get('/leases')).status).toBe(403);
    const lawyer = await asUser(await createUser(fx.a, 'lawyer'));
    const any = (await lawyer.get('/leases')).body.items[0];
    expect((await lawyer.get(`/leases/${any.id}`)).status).toBe(200);
    expect((await lawyer.post(`/leases/${any.id}/transition`).send({ to: 'canceled' })).status).toBe(403);
    const books = await asUser(await createUser(fx.a, 'bookkeeper'));
    expect((await books.get('/leases')).status).toBe(200);
    expect((await books.post('/leases').send({})).status).toBe(403);
    const otherProp = await prisma.property.create({ data: { tenantOrgId: fx.a.id, name: 'Elsewhere', addressLine1: '1 Far Rd', city: 'Dallas', state: 'TX', postalCode: '75201' } });
    const scoped = await asUser(await createUser(fx.a, 'property_manager', undefined, { scopeType: 'property', scopeId: otherProp.id }));
    expect((await scoped.get('/leases')).body.items).toHaveLength(0);
    expect((await scoped.get(`/leases/${any.id}`)).status).toBe(404);
    const opts = await scoped.get('/leases/form-options');
    expect(opts.body.properties.map((p: { id: string }) => p.id)).toEqual([otherProp.id]);
    const full = await m.get('/leases/form-options');
    expect(full.body.properties.find((p: { id: string }) => p.id === fx.propA.id).units.length).toBe(2);
  });

  it('tenant isolation: org B cannot read, update or transition org A leases', async () => {
    const b = await asUser(fx.managers.b);
    const any = (await m.get('/leases')).body.items[0];
    expect((await b.get(`/leases/${any.id}`)).status).toBe(404);
    expect((await b.patch(`/leases/${any.id}`).send({ rentCents: 1 })).status).toBe(404);
    expect((await b.post(`/leases/${any.id}/transition`).send({ to: 'canceled' })).status).toBe(404);
    expect((await b.post(`/leases/${any.id}/parties`).send({ tenantProfileId: profileId })).status).toBe(404);
    expect((await b.get('/leases')).body.items).toHaveLength(0);
    expect((await b.post('/leases').send({ propertyId: fx.propA.id, unitId: unitA.id, startDate: '2041-01-01', endDate: '2041-12-31', rentCents: 1000 })).status).toBe(400);
  });

  it('activation within the 30-day window needs no explicit flag', async () => {
    const soon = await m.post('/leases').send({ propertyId: fx.propA.id, unitId: unitB.id, startDate: iso(daysFromNow(5)), endDate: iso(daysFromNow(370)), rentCents: 100000, tenantProfileId: profile2Id, termsJson: { term: '12 months' } });
    expect(soon.status).toBe(201);
    expect((await go(m, soon.body.id, 'review')).status).toBe(200);
    expect((await go(l, soon.body.id, 'approved')).status).toBe(200);
    expect((await go(m, soon.body.id, 'sent')).status).toBe(200);
    expect((await go(m, soon.body.id, 'signed', { signedAt: new Date().toISOString() })).status).toBe(200);
    const active = await go(m, soon.body.id, 'active');
    expect(active.status).toBe(200);
    expect(active.body.unit.status).toBe('occupied');
  });
});
