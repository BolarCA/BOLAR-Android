import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser, createUnit, relate } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';

describe('legal cases and agency requests (p34/p52): privileged access, holds, approval chain, data minimization', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let lead: Awaited<ReturnType<typeof createUser>>;
  let otherLawyer: Awaited<ReturnType<typeof createUser>>;
  let gov: Awaited<ReturnType<typeof createUser>>;
  let lawyerB: Awaited<ReturnType<typeof createUser>>;
  let leaseId: string; let profileId: string; let caseId: string; let agencyId: string; let exportJobId: string;

  beforeAll(async () => {
    fx = await twoTenantFixture();
    lead = await createUser(fx.a, 'lawyer', 'lead@alpha.test');
    otherLawyer = await createUser(fx.a, 'lawyer', 'other@alpha.test');
    gov = await createUser(fx.a, 'government', 'agency@alpha.test');
    lawyerB = await createUser(fx.b, 'lawyer', 'counsel@beta.test');
    const unit = await createUnit(fx.a, fx.propA.id, '401');
    const lease = await prisma.lease.create({ data: { tenantOrgId: fx.a.id, propertyId: fx.propA.id, unitId: unit.id, status: 'active', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), rentCents: 150000, createdBy: fx.managers.a.id } });
    leaseId = lease.id;
    const profile = await prisma.tenantProfile.create({ data: { tenantOrgId: fx.a.id, displayName: 'Casey Resident', email: 'casey@alpha.test', ssnLast4: '9876', status: 'active' } });
    profileId = profile.id;
    await prisma.leaseParty.create({ data: { tenantOrgId: fx.a.id, leaseId: lease.id, tenantProfileId: profile.id, role: 'primary' } });
    await prisma.document.create({ data: { tenantOrgId: fx.a.id, ownerType: 'lease', ownerId: lease.id, title: 'Signed lease', category: 'lease', classification: 'confidential', createdBy: fx.managers.a.id } });
  });

  it('lawyer opens a privileged case linked to a lease; the lead gets a represents relationship', async () => {
    const l = await asUser(lead);
    expect((await l.post('/cases').send({ title: 'Unknown lease', kind: 'eviction', leaseId: 'lease_nope' })).status).toBe(400);
    const res = await l.post('/cases').send({ title: 'Unit 401 non-payment', kind: 'eviction', leaseId, tenantProfileId: profileId });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'open', privileged: true, leadLawyerId: lead.id, propertyId: fx.propA.id, activeHoldIds: [] });
    caseId = res.body.id;
    const edge = await prisma.relationshipEdge.findFirst({ where: { tenantOrgId: fx.a.id, subjectId: lead.id, relation: 'represents', objectType: 'case', objectId: caseId } });
    expect(edge).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: 'case.created', resourceId: caseId } })).not.toBeNull();
  });

  it('privileged case is hidden (404 + access.denied) from lawyers without representation; a represents edge grants access', async () => {
    const o = await asUser(otherLawyer);
    const denied = await o.get(`/cases/${caseId}`);
    expect(denied.status).toBe(404);
    const deniedAudit = await prisma.auditLog.findFirst({ where: { action: 'access.denied', resourceType: 'case', resourceId: caseId, actorId: otherLawyer.id, outcome: 'deny' } });
    expect(deniedAudit).not.toBeNull();
    expect((await o.get('/cases')).body.items.map((c: { id: string }) => c.id)).not.toContain(caseId);
    await relate(fx.a, otherLawyer.id, 'represents', 'case', caseId);
    const ok = await o.get(`/cases/${caseId}`);
    expect(ok.status).toBe(200);
    expect((await o.get('/cases')).body.items.map((c: { id: string }) => c.id)).toContain(caseId);
    expect(await prisma.auditLog.findFirst({ where: { action: 'case.accessed', resourceId: caseId, actorId: otherLawyer.id } })).not.toBeNull();
    // a manager with case:read but no relationship still cannot see a privileged case
    expect((await (await asUser(fx.managers.a)).get(`/cases/${caseId}`)).status).toBe(404);
  });

  it('status transitions are guarded; deadlines can be added; the timeline shows case and lease events', async () => {
    const l = await asUser(lead);
    const bad = await l.patch(`/cases/${caseId}`).send({ status: 'open', note: 'noop' });
    expect(bad.status).toBe(200); // same status: no transition
    const active = await l.patch(`/cases/${caseId}`).send({ status: 'active', note: 'Notice served.' });
    expect(active.body.status).toBe('active');
    const dl = await l.post(`/cases/${caseId}/deadlines`).send({ title: 'File petition', dueAt: new Date(Date.now() + 10 * 86_400_000).toISOString() });
    expect(dl.status).toBe(201);
    expect(dl.body.deadlines).toHaveLength(1);
    expect(dl.body.deadlines[0]).toMatchObject({ title: 'File petition', done: false });
    const closed = await l.patch(`/cases/${caseId}`).send({ status: 'closed', deadlines: [{ ...dl.body.deadlines[0], done: true }] });
    expect(closed.body.status).toBe('closed');
    expect(closed.body.deadlines[0].done).toBe(true);
    const reopen = await l.patch(`/cases/${caseId}`).send({ status: 'active' });
    expect(reopen.status).toBe(409);
    expect(reopen.body.code).toBe('invalid_transition');
    await prisma.case.update({ where: { id: caseId }, data: { status: 'active' } });
    const timeline = await l.get(`/cases/${caseId}/timeline`);
    expect(timeline.status).toBe(200);
    const actions = timeline.body.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['case.created', 'case.transitioned', 'case.deadline_added']));
    expect(actions).not.toContain('access.denied');
  });

  it('case legal-hold convenience scopes the hold to the case, lease, property and tenant profile', async () => {
    const l = await asUser(lead);
    const res = await l.post(`/cases/${caseId}/legal-hold`).send({ reason: 'Litigation hold for the eviction matter.', note: 'Counsel approved scope.' });
    expect(res.status).toBe(201);
    expect(res.body.scopeJson).toMatchObject({ caseIds: [caseId], leaseIds: [leaseId], propertyIds: [fx.propA.id], tenantProfileIds: [profileId] });
    expect((await l.get(`/legal-holds/check?resourceType=lease&resourceId=${leaseId}`)).body.held).toBe(true);
    expect((await l.get(`/cases/${caseId}`)).body.activeHoldIds).toEqual([res.body.id]);
    expect((await l.get(`/legal-holds?caseId=${caseId}`)).body.items.map((h: { id: string }) => h.id)).toEqual([res.body.id]);
  });

  it('government submits a request; law-enforcement needs a legal reference; visibility follows role', async () => {
    const g = await asUser(gov);
    const missingRef = await g.post('/agency-requests').send({ agencyName: 'County Sheriff', kind: 'law_enforcement', legalBasis: 'Criminal investigation under warrant for records relating to unit 401.', scopeJson: { leaseIds: [leaseId] } });
    expect(missingRef.status).toBe(400);
    const le = await g.post('/agency-requests').send({ agencyName: 'County Sheriff', kind: 'law_enforcement', legalBasis: 'Criminal investigation under warrant for records relating to unit 401.', legalReference: 'Warrant 26-CR-0042', scopeJson: { leaseIds: [leaseId] } });
    expect(le.status).toBe(201);
    const res = await g.post('/agency-requests').send({ agencyName: 'City Housing Authority', kind: 'records', legalBasis: 'Municipal code inspection records request for the annual review.', scopeJson: { propertyIds: [fx.propA.id], description: 'Inspection history only' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'received', requesterUserId: gov.id });
    agencyId = res.body.id;
    const own = await g.get('/agency-requests');
    expect(own.body.items).toHaveLength(2);
    const otherGov = await asUser(await createUser(fx.a, 'government'));
    expect((await otherGov.get('/agency-requests')).body.items).toHaveLength(0);
    expect((await otherGov.get(`/agency-requests/${agencyId}`)).status).toBe(404);
    const l = await asUser(lead);
    expect((await l.get('/agency-requests')).body.items).toHaveLength(2);
    const leList = await l.get('/law-enforcement-requests');
    expect(leList.body.items.map((r: { id: string }) => r.id)).toEqual([le.body.id]);
    expect(leList.body.items[0].scopeJson.legalReference).toBe('Warrant 26-CR-0042');
    expect((await g.post(`/agency-requests/${agencyId}/legal-review`).send({ minimizationNotes: 'government cannot review' })).status).toBe(403);
  });

  it('legal review requires minimization notes; approval by counsel (not the requester) opens a gated export job', async () => {
    const l = await asUser(lead);
    expect((await l.post(`/agency-requests/${agencyId}/decide`).send({ decision: 'approved', note: 'too early' })).status).toBe(409);
    expect((await l.post(`/agency-requests/${agencyId}/legal-review`).send({ minimizationNotes: 'short' })).status).toBe(400);
    const review = await l.post(`/agency-requests/${agencyId}/legal-review`).send({ minimizationNotes: 'Limit to inspection records; exclude tenant identities, payment history and screening data.' });
    expect(review.body.status).toBe('legal_review');
    // requester cannot approve their own request even if they had the permission
    await prisma.roleAssignment.create({ data: { tenantOrgId: fx.a.id, userId: gov.id, role: 'lawyer', scopeType: 'org', scopeId: fx.a.id } });
    const selfApprove = await (await asUser(gov)).post(`/agency-requests/${agencyId}/decide`).send({ decision: 'approved', note: 'self approval' });
    expect(selfApprove.status).toBe(403);
    await prisma.roleAssignment.deleteMany({ where: { userId: gov.id, role: 'lawyer' } });
    const approved = await l.post(`/agency-requests/${agencyId}/decide`).send({ decision: 'approved', note: 'Approved with minimization applied.' });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('approved');
    expect(approved.body.approvedBy).toBe(lead.id);
    exportJobId = approved.body.exportJobId;
    const job = await prisma.exportJob.findUnique({ where: { id: exportJobId } });
    expect(job).toMatchObject({ status: 'requested', kind: 'agency_request', sourceType: 'agency_request', sourceId: agencyId, requestedBy: gov.id });
    expect((job!.redactionJson as { fields: string[] }).fields).toContain('ssnLast4');
    const decided = await prisma.auditLog.findFirst({ where: { action: 'agency_request.approved', resourceId: agencyId } });
    expect((decided!.metadata as { note: string }).note).toContain('minimization');
  });

  it('fulfilment waits for the export to complete; the export approval gate is separate from the request approval', async () => {
    const l = await asUser(lead);
    const early = await l.post(`/agency-requests/${agencyId}/fulfill`).send({});
    expect(early.status).toBe(409);
    const approve = await l.post(`/exports/${exportJobId}/approve`).send({ note: 'Packet reviewed; release to agency.' });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe('complete');
    const done = await l.post(`/agency-requests/${agencyId}/fulfill`).send({ note: 'Delivered.' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('fulfilled');
    const g = await asUser(gov);
    const mine = await g.get(`/exports/${exportJobId}`);
    expect(mine.status).toBe(200);
    expect(mine.body.download.url).toContain('manifest.json');
    expect(mine.body.manifestJson.subjects.every((s: Record<string, unknown>) => !('ssnLast4' in s))).toBe(true);
  });

  it('tenant isolation: org B sees none of org A cases or requests', async () => {
    const b = await asUser(lawyerB);
    expect((await b.get('/cases')).body.items).toHaveLength(0);
    expect((await b.get(`/cases/${caseId}`)).status).toBe(404);
    expect((await b.patch(`/cases/${caseId}`).send({ status: 'closed' })).status).toBe(404);
    expect((await b.get('/agency-requests')).body.items).toHaveLength(0);
    expect((await b.post(`/agency-requests/${agencyId}/decide`).send({ decision: 'denied', note: 'cross tenant' })).status).toBe(404);
    const tenant = await asUser(await createUser(fx.a, 'tenant'));
    expect((await tenant.get('/cases')).status).toBe(403);
    expect((await tenant.post('/agency-requests').send({ agencyName: 'x', kind: 'records', legalBasis: 'tenants cannot file these', scopeJson: {} })).status).toBe(403);
  });
});
