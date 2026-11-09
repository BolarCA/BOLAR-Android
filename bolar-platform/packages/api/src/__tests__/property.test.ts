import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser, createProperty, createUnit, relate } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';
import { drainMemoryQueue } from '../shared/queue.js';

const base = { addressLine1: '1 Test Way', city: 'Austin', state: 'TX', postalCode: '78701' };

describe('property: portfolios, properties, buildings, units (Days 16-20)', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  beforeAll(async () => { fx = await twoTenantFixture(); });

  // ---- Day 16: property CRUD, validation, safe errors ----
  it('manager creates, reads, updates and archives a property; every mutation is audited and property.created is published', async () => {
    const m = await asUser(fx.managers.a);
    drainMemoryQueue();
    const bad = await m.post('/properties').send({ name: '', ...base, state: 'Texas' });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('validation_error');
    expect(bad.body.fieldErrors.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(['body.name', 'body.state']));

    const created = await m.post('/properties').send({ name: 'Harbor View', ...base, state: 'tx', propertyType: 'mixed' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Harbor View', state: 'TX', status: 'onboarding', propertyType: 'mixed', unitCounts: { total: 0 } });
    const id = created.body.id as string;
    expect(drainMemoryQueue('domain-events').some((j) => j.data.name === 'property.created' && (j.data.payload as { propertyId: string }).propertyId === id)).toBe(true);

    const detail = await m.get(`/properties/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id, buildings: [], portfolio: null, unitCounts: { total: 0, vacant: 0 } });

    const upd = await m.patch(`/properties/${id}`).send({ status: 'active', county: 'Travis' });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ status: 'active', county: 'Travis' });

    const arch = await m.post(`/properties/${id}/archive`);
    expect(arch.status).toBe(200);
    expect(arch.body.status).toBe('archived');
    expect((await m.post(`/properties/${id}/archive`)).status).toBe(409);
    expect((await m.patch(`/properties/${id}`).send({ name: 'x' })).status).toBe(409);
    // archived properties are hidden by default and visible on request
    const list = await m.get('/properties?limit=100');
    expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(id);
    const withArchived = await m.get('/properties?includeArchived=true&limit=100');
    expect(withArchived.body.items.map((p: { id: string }) => p.id)).toContain(id);

    const actions = (await prisma.auditLog.findMany({ where: { tenantOrgId: fx.a.id, resourceType: 'property', resourceId: id } })).map((a) => a.action).sort();
    expect(actions).toEqual(['property.archive', 'property.create', 'property.update']);
  });

  it('archive is blocked while units are occupied', async () => {
    const m = await asUser(fx.managers.a);
    const p = await createProperty(fx.a, { name: 'Occupied Place' });
    await prisma.unit.create({ data: { tenantOrgId: fx.a.id, propertyId: p.id, unitNumber: '1', status: 'occupied' } });
    const res = await m.post(`/properties/${p.id}/archive`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
  });

  it('list filters: status, city, state, portfolioId, subaccountId, q', async () => {
    const m = await asUser(fx.managers.a);
    const pf = await m.post('/portfolios').send({ name: 'Filter Portfolio' });
    expect(pf.status).toBe(201);
    const sub = await prisma.subaccount.findFirstOrThrow({ where: { tenantOrgId: fx.a.id } });
    const a = await m.post('/properties').send({ name: 'Filter Alpha Lofts', ...base, city: 'Denver', state: 'CO', status: 'active', portfolioId: pf.body.id, subaccountId: sub.id });
    const b = await m.post('/properties').send({ name: 'Filter Beta Flats', ...base, city: 'Austin', state: 'TX', status: 'inactive' });
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((p) => p.id);
    expect(ids(await m.get('/properties?city=denver'))).toEqual([a.body.id]);
    expect(ids(await m.get('/properties?state=CO'))).toEqual([a.body.id]);
    expect(ids(await m.get(`/properties?portfolioId=${pf.body.id}`))).toEqual([a.body.id]);
    expect(ids(await m.get(`/properties?subaccountId=${sub.id}`))).toEqual([a.body.id]);
    expect(ids(await m.get('/properties?status=inactive'))).toEqual([b.body.id]);
    expect(ids(await m.get('/properties?q=beta%20flats'))).toEqual([b.body.id]);
    expect(ids(await m.get('/properties?q=filter&limit=100')).sort()).toEqual([a.body.id, b.body.id].sort());
    expect((await m.post('/properties').send({ name: 'Bad link', ...base, portfolioId: 'nope' })).status).toBe(400);
  });

  // ---- Tenant isolation ----
  it('tenant isolation: org B cannot list, read, update, archive or add units to org A properties (404, no leak)', async () => {
    const b = await asUser(fx.admins.b);
    const list = await b.get('/properties?limit=100');
    expect(list.status).toBe(200);
    expect(list.body.items.map((p: { id: string }) => p.id)).not.toContain(fx.propA.id);
    expect(list.body.items.map((p: { id: string }) => p.id)).toContain(fx.propB.id);
    expect((await b.get(`/properties/${fx.propA.id}`)).status).toBe(404);
    expect((await b.patch(`/properties/${fx.propA.id}`).send({ name: 'pwned' })).status).toBe(404);
    expect((await b.post(`/properties/${fx.propA.id}/archive`)).status).toBe(404);
    expect((await b.post(`/properties/${fx.propA.id}/units`).send({ unitNumber: 'X' })).status).toBe(404);
    expect((await b.get(`/properties/${fx.propA.id}/units`)).status).toBe(404);
    expect((await b.get(`/properties/${fx.propA.id}/hierarchy`)).status).toBe(404);
    const unitA = await createUnit(fx.a, fx.propA.id, '900');
    expect((await b.get(`/units/${unitA.id}`)).status).toBe(404);
    expect((await b.post(`/units/${unitA.id}/status`).send({ toStatus: 'down', reason: 'cross tenant' })).status).toBe(404);
    expect((await prisma.unit.findUniqueOrThrow({ where: { id: unitA.id } })).status).toBe('vacant');
    expect((await prisma.property.findUniqueOrThrow({ where: { id: fx.propA.id } })).name).not.toBe('pwned');
  });

  // ---- Denied paths ----
  it('denied: tenant role is 403 on the collection; landlord without a relationship gets 404 and an access.denied audit row', async () => {
    const tenant = await createUser(fx.a, 'tenant');
    const t = await asUser(tenant);
    expect((await t.get('/properties')).status).toBe(403);
    expect((await t.post('/properties').send({ name: 'Nope', ...base })).status).toBe(403);

    const landlord = await createUser(fx.a, 'landlord');
    const l = await asUser(landlord);
    const res = await l.get(`/properties/${fx.propA.id}`);
    expect(res.status).toBe(404);
    const denied = await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, actorId: landlord.id, action: 'access.denied', resourceType: 'property', resourceId: fx.propA.id, outcome: 'deny' } });
    expect(denied).not.toBeNull();
    // landlord has property:read but not property:write
    expect((await l.post('/properties').send({ name: 'Nope', ...base })).status).toBe(403);
  });

  // ---- ReBAC list filtering ----
  it('landlord with owner_of sees exactly the owned properties (direct or via portfolio); property-scoped manager sees only their scope', async () => {
    const admin = await asUser(fx.admins.a);
    const pf = await admin.post('/portfolios').send({ name: 'Lena Holdings' });
    const owned = await createProperty(fx.a, { name: 'Owned Direct' });
    const inPortfolio = await createProperty(fx.a, { name: 'Owned Via Portfolio', portfolioId: pf.body.id });
    const notOwned = await createProperty(fx.a, { name: 'Not Owned' });
    const landlord = await createUser(fx.a, 'landlord');
    await relate(fx.a, landlord.id, 'owner_of', 'property', owned.id);
    await relate(fx.a, landlord.id, 'owner_of', 'portfolio', pf.body.id);
    const l = await asUser(landlord);
    const list = await l.get('/properties?limit=100');
    expect(list.status).toBe(200);
    expect(list.body.items.map((p: { id: string }) => p.id).sort()).toEqual([owned.id, inPortfolio.id].sort());
    expect((await l.get(`/properties/${owned.id}`)).status).toBe(200);
    expect((await l.get(`/properties/${inPortfolio.id}`)).status).toBe(200);
    expect((await l.get(`/properties/${notOwned.id}`)).status).toBe(404);
    const pfs = await l.get('/portfolios');
    expect(pfs.body.items.map((p: { id: string }) => p.id)).toEqual([pf.body.id]);
    expect((await l.get(`/portfolios/${pf.body.id}`)).status).toBe(200);
    // read-only: units visible, status change denied by coarse permission
    const u = await createUnit(fx.a, owned.id, '7');
    expect((await l.get(`/properties/${owned.id}/units`)).body.items.map((x: { id: string }) => x.id)).toEqual([u.id]);
    expect((await l.post(`/units/${u.id}/status`).send({ toStatus: 'down', reason: 'landlord cannot' })).status).toBe(403);

    const scoped = await createUser(fx.a, 'property_manager', undefined, { scopeType: 'property', scopeId: notOwned.id });
    const s = await asUser(scoped);
    expect((await s.get('/properties?limit=100')).body.items.map((p: { id: string }) => p.id)).toEqual([notOwned.id]);
    expect((await s.get(`/properties/${owned.id}`)).status).toBe(404);
    // scoped manager cannot create org-wide properties
    expect((await s.post('/properties').send({ name: 'Nope', ...base })).status).toBe(403);
    // a manages edge extends visibility
    await relate(fx.a, scoped.id, 'manages', 'property', owned.id);
    expect((await s.get('/properties?limit=100')).body.items.map((p: { id: string }) => p.id).sort()).toEqual([notOwned.id, owned.id].sort());
  });

  // ---- Day 17: units and status transitions ----
  it('unit CRUD: create (duplicate number is 409), buildings, update, detail with nextStatuses, unit list filters', async () => {
    const m = await asUser(fx.managers.a);
    const p = await createProperty(fx.a, { name: 'Unit Place' });
    const bld = await m.post(`/properties/${p.id}/buildings`).send({ name: 'North Wing', floors: 3 });
    expect(bld.status).toBe(201);
    const u1 = await m.post(`/properties/${p.id}/units`).send({ unitNumber: '101', bedrooms: 2, bathrooms: 1.5, squareFeet: 900, targetRentCents: 180000, buildingId: bld.body.id });
    expect(u1.status).toBe(201);
    expect(u1.body).toMatchObject({ unitNumber: '101', status: 'vacant', bathrooms: 1.5, targetRentCents: 180000, buildingId: bld.body.id });
    expect(u1.body.nextStatuses.sort()).toEqual(['down', 'make_ready', 'occupied', 'reserved']);
    expect((await m.post(`/properties/${p.id}/units`).send({ unitNumber: '101' })).status).toBe(409);
    expect((await m.post(`/properties/${p.id}/units`).send({ unitNumber: '102', buildingId: 'other' })).status).toBe(400);
    expect((await m.post(`/properties/${p.id}/units`).send({ unitNumber: '102', bathrooms: 1.3 })).status).toBe(400);
    const u2 = await m.post(`/properties/${p.id}/units`).send({ unitNumber: '102', status: 'down' });
    expect(u2.status).toBe(201);
    const upd = await m.patch(`/units/${u1.body.id}`).send({ targetRentCents: 185000, squareFeet: 950 });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ targetRentCents: 185000, squareFeet: 950 });
    expect((await m.patch(`/units/${u1.body.id}`).send({ unitNumber: '102' })).status).toBe(409);
    const detail = await m.get(`/units/${u1.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(u1.body.id);
    const list = await m.get(`/properties/${p.id}/units`);
    expect(list.body.items.map((u: { unitNumber: string }) => u.unitNumber)).toEqual(['101', '102']);
    expect((await m.get(`/properties/${p.id}/units?status=down`)).body.items.map((u: { id: string }) => u.id)).toEqual([u2.body.id]);
    expect((await m.get(`/properties/${p.id}/units?buildingId=${bld.body.id}`)).body.items.map((u: { id: string }) => u.id)).toEqual([u1.body.id]);
    const pd = await m.get(`/properties/${p.id}`);
    expect(pd.body.unitCounts).toMatchObject({ total: 2, vacant: 1, down: 1 });
    expect(pd.body.buildings[0]).toMatchObject({ name: 'North Wing', unitCount: 1 });
    const audits = await prisma.auditLog.findMany({ where: { tenantOrgId: fx.a.id, resourceType: 'unit', resourceId: u1.body.id } });
    expect(audits.map((a) => a.action).sort()).toEqual(['unit.create', 'unit.update']);
  });

  it('unit status state machine: legal chain writes history + audit + event; illegal transition is 409 invalid_transition; reason is required', async () => {
    const m = await asUser(fx.managers.a);
    const p = await createProperty(fx.a, { name: 'Transition Place' });
    const u = await createUnit(fx.a, p.id, '1A');
    drainMemoryQueue();
    const go = (to: string, reason = 'test transition') => m.post(`/units/${u.id}/status`).send({ toStatus: to, reason });
    expect((await go('reserved', '')).status).toBe(400);
    expect((await go('reserved')).body.status).toBe('reserved');
    expect((await go('occupied')).body.status).toBe('occupied');
    const bad = await go('reserved');
    expect(bad.status).toBe(409);
    expect(bad.body.code).toBe('invalid_transition');
    expect((await go('notice')).body.status).toBe('notice');
    const vac = await go('vacant', 'Tenant moved out');
    expect(vac.body.status).toBe('vacant');
    expect(vac.body.availableFrom).not.toBeNull();
    expect((await go('make_ready')).body.status).toBe('make_ready');
    expect((await go('down')).status).toBe(409);
    expect((await go('vacant')).body.status).toBe('vacant');
    expect((await go('down')).body.status).toBe('down');
    expect((await go('occupied')).status).toBe(409);

    const history = await m.get(`/units/${u.id}/history`);
    expect(history.status).toBe(200);
    expect(history.body.items.map((h: { fromStatus: string; toStatus: string }) => `${h.fromStatus}>${h.toStatus}`)).toEqual([
      'vacant>down', 'make_ready>vacant', 'vacant>make_ready', 'notice>vacant', 'occupied>notice', 'reserved>occupied', 'vacant>reserved',
    ]);
    expect(history.body.items[3].reason).toBe('Tenant moved out');
    const audits = await prisma.auditLog.count({ where: { tenantOrgId: fx.a.id, action: 'unit.status_change', resourceId: u.id } });
    expect(audits).toBe(7);
    const events = drainMemoryQueue('domain-events').filter((j) => j.data.name === 'unit.status_changed');
    expect(events).toHaveLength(7);
    expect(events[0]!.data.payload).toMatchObject({ unitId: u.id, propertyId: p.id, from: 'vacant', to: 'reserved' });
  });

  // ---- Day 19: hierarchy and pagination ----
  it('hierarchy groups units by building and lists unassigned units', async () => {
    const m = await asUser(fx.managers.a);
    const pf = await m.post('/portfolios').send({ name: 'Tree Portfolio' });
    const p = await createProperty(fx.a, { name: 'Tree Place', portfolioId: pf.body.id });
    const b1 = await m.post(`/properties/${p.id}/buildings`).send({ name: 'A' });
    await m.post(`/properties/${p.id}/units`).send({ unitNumber: 'A1', buildingId: b1.body.id });
    await m.post(`/properties/${p.id}/units`).send({ unitNumber: 'A2', buildingId: b1.body.id });
    await m.post(`/properties/${p.id}/units`).send({ unitNumber: 'Z9' });
    const h = await m.get(`/properties/${p.id}/hierarchy`);
    expect(h.status).toBe(200);
    expect(h.body.portfolio).toMatchObject({ id: pf.body.id, name: 'Tree Portfolio' });
    expect(h.body.buildings).toHaveLength(1);
    expect(h.body.buildings[0].units.map((u: { unitNumber: string }) => u.unitNumber)).toEqual(['A1', 'A2']);
    expect(h.body.unassignedUnits.map((u: { unitNumber: string }) => u.unitNumber)).toEqual(['Z9']);
    expect(h.body.unitCounts.total).toBe(3);
    expect(h.body.truncated).toBe(false);
  });

  it('cursor pagination walks every property and unit exactly once; limit is bounded', async () => {
    const m = await asUser(fx.managers.a);
    const p = await createProperty(fx.a, { name: 'Paged Place' });
    for (let i = 0; i < 23; i++) await prisma.unit.create({ data: { tenantOrgId: fx.a.id, propertyId: p.id, unitNumber: `U${String(i).padStart(2, '0')}` } });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res: { status: number; body: { items: { unitNumber: string }[]; nextCursor: string | null } } = await m.get(`/properties/${p.id}/units?limit=5${cursor ? `&cursor=${cursor}` : ''}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(5);
      seen.push(...res.body.items.map((u) => u.unitNumber));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);
    expect(seen).toEqual([...seen].sort());

    const all = (await m.get('/properties?includeArchived=true&limit=100')).body.items.map((x: { id: string }) => x.id);
    const paged: string[] = [];
    cursor = null;
    do {
      const res: { body: { items: { id: string }[]; nextCursor: string | null } } = await m.get(`/properties?includeArchived=true&limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      paged.push(...res.body.items.map((x) => x.id));
      cursor = res.body.nextCursor;
    } while (cursor);
    expect(paged).toEqual(all);
    expect(new Set(paged).size).toBe(paged.length);
    expect((await m.get('/properties?limit=101')).status).toBe(400);
    expect((await m.get('/properties?limit=0')).status).toBe(400);
    // a garbage cursor is ignored (first page), never a 500
    expect((await m.get('/properties?cursor=not-base64-json')).status).toBe(200);
  });

  // ---- Day 20: index explain check ----
  it('EXPLAIN uses the composite indexes property(tenantOrgId,status,city) and unit(tenantOrgId,propertyId,status)', async () => {
    // Enough synthetic rows + fresh statistics so the planner has a real choice between indexes (tiny tables make every index cost the same).
    const cities = ['Austin', 'Dallas', 'Houston', 'Denver', 'Phoenix'];
    const statuses = ['active', 'inactive', 'onboarding', 'archived'];
    const unitStatuses = ['vacant', 'occupied', 'notice', 'make_ready', 'down', 'reserved'];
    await prisma.property.createMany({ data: Array.from({ length: 1500 }, (_, i) => ({ tenantOrgId: fx.a.id, name: `Bulk ${i}`, addressLine1: `${i} Bulk Rd`, city: cities[i % cities.length]!, state: 'TX', postalCode: '78701', status: statuses[i % statuses.length]! })) });
    await prisma.unit.createMany({ data: Array.from({ length: 1500 }, (_, i) => ({ tenantOrgId: fx.a.id, propertyId: fx.propA.id, unitNumber: `B${i}`, status: unitStatuses[i % unitStatuses.length]! })) });
    await prisma.$executeRawUnsafe('ANALYZE "Property"');
    await prisma.$executeRawUnsafe('ANALYZE "Unit"');
    const plan = async (sql: string, params: unknown[]) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        const rows = await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(sql, ...params);
        return rows.map((r) => r['QUERY PLAN']).join('\n');
      });
    const propPlan = await plan('EXPLAIN SELECT id FROM "Property" WHERE "tenantOrgId" = $1 AND status = $2 AND city = $3', [fx.a.id, 'active', 'Austin']);
    expect(propPlan).toMatch(/Index Scan|Bitmap Index Scan|Index Only Scan/);
    expect(propPlan).toContain('Property_tenantOrgId_status_city_idx');
    const unitPlan = await plan('EXPLAIN SELECT id FROM "Unit" WHERE "tenantOrgId" = $1 AND "propertyId" = $2 AND status = $3', [fx.a.id, fx.propA.id, 'vacant']);
    expect(unitPlan).toMatch(/Index Scan|Bitmap Index Scan|Index Only Scan/);
    expect(unitPlan).toContain('Unit_tenantOrgId_propertyId_status_idx');
    const pagePlan = await plan('EXPLAIN SELECT id FROM "Property" WHERE "tenantOrgId" = $1 ORDER BY "createdAt" DESC, id DESC LIMIT 26', [fx.a.id]);
    expect(pagePlan).toContain('Property_tenantOrgId_createdAt_id_idx');
    console.info(`[explain] property filter:\n${propPlan}\n[explain] unit filter:\n${unitPlan}\n[explain] property keyset page:\n${pagePlan}`);
  });
});
