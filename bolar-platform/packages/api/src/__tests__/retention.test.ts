import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';

const DAY = 86_400_000;

describe('retention engine (Day 47): policies, assignments, sweep proposes only, gated disposal, holds', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let compliance: Awaited<ReturnType<typeof createUser>>;
  let lawyer: Awaited<ReturnType<typeof createUser>>;
  let docA: { id: string }; let heldDoc: { id: string }; let docB: { id: string };
  let assignmentId: string; let heldAssignmentId: string;

  beforeAll(async () => {
    fx = await twoTenantFixture();
    compliance = await createUser(fx.a, 'compliance_officer', 'compliance@alpha.test');
    lawyer = await createUser(fx.a, 'lawyer', 'counsel@alpha.test');
    // Platform defaults (the fixture truncates the base seed)
    await prisma.retentionPolicy.create({ data: { key: 'documents.general', name: 'General documents', resourceType: 'document', retainDays: 365 * 5, disposition: 'review' } });
    await prisma.retentionPolicy.create({ data: { key: 'notifications', name: 'Notifications', resourceType: 'notification', retainDays: 365, disposition: 'delete' } });
    docA = await prisma.document.create({ data: { tenantOrgId: fx.a.id, ownerType: 'property', ownerId: fx.propA.id, title: 'Old insurance certificate', category: 'insurance', createdBy: fx.managers.a.id } });
    heldDoc = await prisma.document.create({ data: { tenantOrgId: fx.a.id, ownerType: 'property', ownerId: fx.propA.id, title: 'Held inspection report', category: 'general', createdBy: fx.managers.a.id } });
    docB = await prisma.document.create({ data: { tenantOrgId: fx.b.id, ownerType: 'property', ownerId: fx.propB.id, title: 'Beta document', category: 'general', createdBy: fx.managers.b.id } });
    await prisma.legalHold.create({ data: { tenantOrgId: fx.a.id, name: 'Inspection dispute', reason: 'Preserve inspection reports for the dispute.', scopeJson: { documentIds: [heldDoc.id] }, status: 'active', approvedBy: lawyer.id, createdBy: lawyer.id } });
  });

  it('lists platform defaults, lets the org override one by key, and keeps platform defaults read-only', async () => {
    const c = await asUser(compliance);
    const before = await c.get('/retention/policies');
    expect(before.status).toBe(200);
    const platformDoc = before.body.items.find((p: { key: string }) => p.key === 'documents.general');
    expect(platformDoc.isPlatformDefault).toBe(true);
    expect((await c.patch(`/retention/policies/${platformDoc.id}`).send({ retainDays: 10 })).status).toBe(404);
    const created = await c.post('/retention/policies').send({ key: 'documents.general', name: 'Org documents (short)', resourceType: 'document', retainDays: 30, disposition: 'review' });
    expect(created.status).toBe(201);
    expect(created.body.isPlatformDefault).toBe(false);
    expect((await c.post('/retention/policies').send({ key: 'documents.general', name: 'dup', resourceType: 'document', retainDays: 30 })).status).toBe(409);
    const after = await c.get('/retention/policies');
    const effective = after.body.items.find((p: { key: string }) => p.key === 'documents.general');
    expect(effective.id).toBe(created.body.id);
    expect(effective.retainDays).toBe(30);
    const patched = await c.patch(`/retention/policies/${created.body.id}`).send({ retainDays: 45 });
    expect(patched.status).toBe(200);
    expect(patched.body.retainDays).toBe(45);
    expect(await prisma.auditLog.findFirst({ where: { action: 'retention.policy_updated', resourceId: created.body.id } })).not.toBeNull();
    // org B sees only the platform default
    const b = await asUser(fx.admins.b);
    expect((await b.get('/retention/policies')).body.items.find((p: { key: string }) => p.key === 'documents.general').isPlatformDefault).toBe(true);
  });

  it('assigns a policy (retainUntil = anchor + retainDays), upserts per resource and rejects resource type mismatch', async () => {
    const c = await asUser(compliance);
    const anchor = new Date(Date.now() - 400 * DAY);
    const res = await c.post('/retention/assignments').send({ policyKey: 'documents.general', resourceType: 'document', resourceId: docA.id, anchorDate: anchor.toISOString() });
    expect(res.status).toBe(201);
    expect(res.body.state).toBe('retained');
    expect(res.body.policyKey).toBe('documents.general');
    expect(new Date(res.body.retainUntil).getTime()).toBe(anchor.getTime() + 45 * DAY);
    assignmentId = res.body.id;
    const again = await c.post('/retention/assignments').send({ policyKey: 'documents.general', resourceType: 'document', resourceId: docA.id, anchorDate: anchor.toISOString() });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(assignmentId);
    expect((await c.post('/retention/assignments').send({ policyKey: 'notifications', resourceType: 'document', resourceId: docA.id })).status).toBe(400);
    expect((await c.post('/retention/assignments').send({ policyKey: 'does.not.exist', resourceType: 'document', resourceId: docA.id })).status).toBe(400);
    const held = await c.post('/retention/assignments').send({ policyKey: 'documents.general', resourceType: 'document', resourceId: heldDoc.id, anchorDate: anchor.toISOString() });
    heldAssignmentId = held.body.id;
    const future = await c.post('/retention/assignments').send({ policyKey: 'documents.general', resourceType: 'document', resourceId: 'doc_future_1' });
    expect(future.status).toBe(201);
    const list = await c.get('/retention/assignments?state=retained');
    expect(list.body.items.map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining([assignmentId, heldAssignmentId, future.body.id]));
    const due = await c.get(`/retention/assignments?dueBefore=${new Date().toISOString()}`);
    expect(due.body.items.map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining([assignmentId, heldAssignmentId]));
    expect(due.body.items.map((a: { id: string }) => a.id)).not.toContain(future.body.id);
  });

  it('sweep proposes due records, marks held ones held, never deletes, and is idempotent', async () => {
    const c = await asUser(compliance);
    const first = await c.post('/retention/sweep');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ scanned: 2, proposed: 1, held: 1 });
    const second = await c.post('/retention/sweep');
    expect(second.body).toMatchObject({ scanned: 0, proposed: 0, held: 0 });
    expect((await prisma.retentionAssignment.findUnique({ where: { id: assignmentId } }))!.state).toBe('proposed');
    expect((await prisma.retentionAssignment.findUnique({ where: { id: heldAssignmentId } }))!.state).toBe('held');
    expect((await prisma.document.findUnique({ where: { id: docA.id } }))!.deletedAt).toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: 'retention.proposed', resourceId: docA.id } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: 'retention.held', resourceId: heldDoc.id } })).not.toBeNull();
  });

  it('approval is a human gate (lawyer or compliance approve), disposal executes only after approval', async () => {
    const c = await asUser(compliance);
    const tooEarly = await c.post(`/retention/assignments/${assignmentId}/dispose`).send({});
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.code).toBe('invalid_transition');
    const manager = await asUser(fx.managers.a);
    expect((await manager.post(`/retention/assignments/${assignmentId}/approve`).send({ note: 'manager cannot approve' })).status).toBe(403);
    const approved = await (await asUser(lawyer)).post(`/retention/assignments/${assignmentId}/approve`).send({ note: 'Certificate superseded; safe to dispose.' });
    expect(approved.status).toBe(200);
    expect(approved.body.state).toBe('approved');
    expect(approved.body.approvedBy).toBe(lawyer.id);
    const approvedAudit = await prisma.auditLog.findFirst({ where: { action: 'retention.approved', resourceId: docA.id } });
    expect((approvedAudit!.metadata as { note: string }).note).toContain('superseded');
    const disposed = await c.post(`/retention/assignments/${assignmentId}/dispose`).send({ note: 'Disposed per approval.' });
    expect(disposed.status).toBe(200);
    expect(disposed.body.state).toBe('disposed');
    expect(disposed.body.dispositionNote).toBe('soft_deleted');
    expect((await prisma.document.findUnique({ where: { id: docA.id } }))!.deletedAt).not.toBeNull();
    expect((await c.post(`/retention/assignments/${assignmentId}/hold`).send({ note: 'too late' })).status).toBe(409);
  });

  it('disposal of a held record is blocked with 409 legal_hold even after approval', async () => {
    const c = await asUser(compliance);
    await prisma.retentionAssignment.update({ where: { id: heldAssignmentId }, data: { state: 'approved', approvedBy: lawyer.id } });
    const res = await c.post(`/retention/assignments/${heldAssignmentId}/dispose`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('legal_hold');
    expect((await prisma.retentionAssignment.findUnique({ where: { id: heldAssignmentId } }))!.state).toBe('held');
    expect((await prisma.document.findUnique({ where: { id: heldDoc.id } }))!.deletedAt).toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: 'retention.dispose_blocked', resourceId: heldDoc.id, outcome: 'deny' } })).not.toBeNull();
  });

  it('notification disposition hard-deletes the row', async () => {
    const c = await asUser(compliance);
    const n = await prisma.notification.create({ data: { tenantOrgId: fx.a.id, channel: 'email', recipientId: fx.managers.a.id, recipientAddress: 'pm@alpha.test', templateKey: 'invoice.issued', status: 'sent' } });
    const a = await c.post('/retention/assignments').send({ policyKey: 'notifications', resourceType: 'notification', resourceId: n.id, anchorDate: new Date(Date.now() - 400 * DAY).toISOString() });
    await c.post('/retention/sweep');
    await (await asUser(lawyer)).post(`/retention/assignments/${a.body.id}/approve`).send({ note: 'Expired notification.' });
    const d = await c.post(`/retention/assignments/${a.body.id}/dispose`).send({});
    expect(d.body.dispositionNote).toBe('hard_deleted');
    expect(await prisma.notification.findUnique({ where: { id: n.id } })).toBeNull();
  });

  it('tenant isolation and denied paths', async () => {
    const b = await asUser(fx.admins.b);
    const listB = await b.get('/retention/assignments');
    expect(listB.body.items).toHaveLength(0);
    expect((await b.post(`/retention/assignments/${assignmentId}/hold`).send({ note: 'cross tenant' })).status).toBe(404);
    expect((await b.post('/retention/assignments').send({ policyKey: 'documents.general', resourceType: 'document', resourceId: docB.id })).status).toBe(201);
    expect((await (await asUser(fx.admins.a)).get('/retention/assignments')).body.items.map((x: { resourceId: string }) => x.resourceId)).not.toContain(docB.id);
    const tenant = await asUser(await createUser(fx.a, 'tenant'));
    expect((await tenant.get('/retention/policies')).status).toBe(403);
    expect((await tenant.post('/retention/sweep')).status).toBe(403);
  });
});
