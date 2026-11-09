import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser, createUnit } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';
import { isHeld } from '../modules/legal-hold/service.js';

async function leaseWithDoc(orgId: string, propertyId: string, createdBy: string, unitNumber: string) {
  const unit = await createUnit({ id: orgId, slug: '', name: '' }, propertyId, unitNumber);
  const lease = await prisma.lease.create({ data: { tenantOrgId: orgId, propertyId, unitId: unit.id, status: 'active', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), rentCents: 150000, createdBy } });
  const doc = await prisma.document.create({ data: { tenantOrgId: orgId, ownerType: 'lease', ownerId: lease.id, title: 'Lease file', classification: 'confidential', category: 'lease', createdBy } });
  return { lease, doc };
}

describe('legal holds (Day 49): scope, parent resolution, counsel release, isolation', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let lawyerA: Awaited<ReturnType<typeof createUser>>;
  let lawyerA2: Awaited<ReturnType<typeof createUser>>;
  let lawyerB: Awaited<ReturnType<typeof createUser>>;
  let leaseA: { id: string }; let docA: { id: string }; let leaseA2: { id: string }; let docA2: { id: string };
  let holdId: string;

  beforeAll(async () => {
    fx = await twoTenantFixture();
    lawyerA = await createUser(fx.a, 'lawyer', 'counsel1@alpha.test');
    lawyerA2 = await createUser(fx.a, 'lawyer', 'counsel2@alpha.test');
    lawyerB = await createUser(fx.b, 'lawyer', 'counsel@beta.test');
    ({ lease: leaseA, doc: docA } = await leaseWithDoc(fx.a.id, fx.propA.id, fx.managers.a.id, '101'));
    ({ lease: leaseA2, doc: docA2 } = await leaseWithDoc(fx.a.id, fx.propA.id, fx.managers.a.id, '102'));
  });

  it('counsel creates a hold scoped to a lease; the lease and its documents are held, unrelated records are not', async () => {
    const l = await asUser(lawyerA);
    const noNote = await l.post('/legal-holds').send({ name: 'Eviction matter 101', reason: 'Anticipated litigation; preserve the lease file.', scopeJson: { leaseIds: [leaseA.id] } });
    expect(noNote.status).toBe(400);
    const res = await l.post('/legal-holds').send({ name: 'Eviction matter 101', reason: 'Anticipated litigation; preserve the lease file.', scopeJson: { leaseIds: [leaseA.id] }, note: 'Approved by counsel after client instruction.' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    expect(res.body.approvedBy).toBe(lawyerA.id);
    holdId = res.body.id;
    const leaseCheck = await l.get(`/legal-holds/check?resourceType=lease&resourceId=${leaseA.id}`);
    expect(leaseCheck.body).toEqual({ held: true, holdIds: [holdId] });
    const docCheck = await l.get(`/legal-holds/check?resourceType=document&resourceId=${docA.id}`);
    expect(docCheck.body.held).toBe(true);
    const other = await l.get(`/legal-holds/check?resourceType=document&resourceId=${docA2.id}`);
    expect(other.body).toEqual({ held: false, holdIds: [] });
    expect((await prisma.document.findUnique({ where: { id: docA.id } }))!.legalHold).toBe(true);
    expect((await prisma.document.findUnique({ where: { id: docA2.id } }))!.legalHold).toBe(false);
    const created = await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'legal_hold.created', resourceId: holdId } });
    expect(created).not.toBeNull();
    expect((created!.metadata as { note: string }).note).toContain('Approved by counsel');
    // service helper used by other modules
    expect((await isHeld(fx.a.id, 'lease', leaseA2.id)).held).toBe(false);
  });

  it('a property-scoped hold covers leases and documents under that property', async () => {
    const l = await asUser(lawyerA);
    const res = await l.post('/legal-holds').send({ name: 'Property-wide preservation', reason: 'Regulatory inquiry covering the whole building.', scopeJson: { propertyIds: [fx.propA.id] }, note: 'Scope confirmed with compliance.' });
    expect(res.status).toBe(201);
    const check = await l.get(`/legal-holds/check?resourceType=document&resourceId=${docA2.id}`);
    expect(check.body.held).toBe(true);
    expect(check.body.holdIds).toContain(res.body.id);
    const release = await (await asUser(lawyerA2)).post(`/legal-holds/${res.body.id}/release`).send({ note: 'Inquiry closed; preservation no longer required.' });
    expect(release.status).toBe(200);
    expect((await l.get(`/legal-holds/check?resourceType=document&resourceId=${docA2.id}`)).body.held).toBe(false);
    // docA remains flagged because the lease hold is still active
    expect((await prisma.document.findUnique({ where: { id: docA.id } }))!.legalHold).toBe(true);
  });

  it('scope ids from another tenant are rejected and never referenced', async () => {
    const leaseB = await prisma.lease.create({ data: { tenantOrgId: fx.b.id, propertyId: fx.propB.id, unitId: (await createUnit(fx.b, fx.propB.id, '201')).id, status: 'active', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), rentCents: 100000, createdBy: fx.managers.b.id } });
    const l = await asUser(lawyerA);
    const res = await l.post('/legal-holds').send({ name: 'Cross tenant attempt', reason: 'Should not be possible at all.', scopeJson: { leaseIds: [leaseB.id] }, note: 'test note here' });
    expect(res.status).toBe(400);
  });

  it('release requires different counsel; re-release is an invalid transition; access is logged', async () => {
    const creator = await asUser(lawyerA);
    const self = await creator.post(`/legal-holds/${holdId}/release`).send({ note: 'Trying to release my own hold.' });
    expect(self.status).toBe(403);
    const detail = await creator.get(`/legal-holds/${holdId}`);
    expect(detail.status).toBe(200);
    expect(await prisma.auditLog.findFirst({ where: { action: 'legal_hold.accessed', resourceId: holdId } })).not.toBeNull();
    const other = await asUser(lawyerA2);
    const rel = await other.post(`/legal-holds/${holdId}/release`).send({ note: 'Matter settled; counsel approves release.' });
    expect(rel.status).toBe(200);
    expect(rel.body.status).toBe('released');
    expect(rel.body.releasedBy).toBe(lawyerA2.id);
    const again = await other.post(`/legal-holds/${holdId}/release`).send({ note: 'Second release attempt.' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('invalid_transition');
    const released = await prisma.auditLog.findFirst({ where: { action: 'legal_hold.released', resourceId: holdId } });
    expect((released!.metadata as { note: string }).note).toContain('Matter settled');
    expect((await creator.get(`/legal-holds/check?resourceType=lease&resourceId=${leaseA.id}`)).body.held).toBe(false);
    expect((await prisma.document.findUnique({ where: { id: docA.id } }))!.legalHold).toBe(false);
  });

  it('tenant isolation: org B cannot list, read or release org A holds', async () => {
    const b = await asUser(lawyerB);
    const list = await b.get('/legal-holds');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(0);
    expect((await b.get(`/legal-holds/${holdId}`)).status).toBe(404);
    expect((await b.post(`/legal-holds/${holdId}/release`).send({ note: 'cross tenant release' })).status).toBe(404);
    expect((await b.get(`/legal-holds/check?resourceType=lease&resourceId=${leaseA.id}`)).body.held).toBe(false);
  });

  it('denied path: a tenant cannot create holds and a manager cannot release', async () => {
    const tenant = await asUser(await createUser(fx.a, 'tenant'));
    expect((await tenant.post('/legal-holds').send({ name: 'Nope hold', reason: 'Tenants cannot do this ever.', scopeJson: { leaseIds: [leaseA.id] }, note: 'note note' })).status).toBe(403);
    expect((await tenant.get('/legal-holds')).status).toBe(403);
    const manager = await asUser(fx.managers.a);
    expect((await manager.get('/legal-holds')).status).toBe(200);
    expect((await manager.post(`/legal-holds/${holdId}/release`).send({ note: 'manager release' })).status).toBe(403);
  });
});
