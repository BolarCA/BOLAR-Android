import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { twoTenantFixture, createUser, createUnit } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser, testApp } from './helpers.js';
import type { MockIdentityVerificationProvider } from '@bolar/integrations';
import { identityProvider, resetIntakeRateForTests } from '../modules/privacy/service.js';

const SUBJECT = 'subject.one@alpha.test';

describe('privacy requests (Day 48): intake, identity, discovery, exceptions, decision, fulfilment', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let lawyer: Awaited<ReturnType<typeof createUser>>;
  let lawyerB: Awaited<ReturnType<typeof createUser>>;
  let profileId: string; let heldDocId: string; let freeDocId: string; let leaseId: string;
  let requestId: string; let externalId: string;

  beforeAll(async () => {
    fx = await twoTenantFixture();
    resetIntakeRateForTests();
    lawyer = await createUser(fx.a, 'lawyer', 'counsel@alpha.test');
    lawyerB = await createUser(fx.b, 'lawyer', 'counsel@beta.test');
    await prisma.retentionPolicy.create({ data: { key: 'lease.records', name: 'Lease records', resourceType: 'lease', retainDays: 365 * 7, disposition: 'review' } });
    await prisma.retentionPolicy.create({ data: { key: 'documents.general', name: 'General documents', resourceType: 'document', retainDays: 365 * 5, disposition: 'review' } });
    const subjectUser = await createUser(fx.a, 'tenant', SUBJECT);
    const profile = await prisma.tenantProfile.create({ data: { tenantOrgId: fx.a.id, userId: subjectUser.id, displayName: 'Subject One', email: SUBJECT, phone: '+15125550123', ssnLast4: '1234', dateOfBirth: new Date('1990-01-01'), status: 'active' } });
    profileId = profile.id;
    await prisma.contactMethod.create({ data: { tenantOrgId: fx.a.id, tenantProfileId: profile.id, kind: 'phone', value: '+15125550123', isPrimary: true } });
    await prisma.emergencyContact.create({ data: { tenantOrgId: fx.a.id, tenantProfileId: profile.id, name: 'Em Contact', relationship: 'sibling', phone: '+15125550124' } });
    const unit = await createUnit(fx.a, fx.propA.id, '301');
    const lease = await prisma.lease.create({ data: { tenantOrgId: fx.a.id, propertyId: fx.propA.id, unitId: unit.id, status: 'active', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), rentCents: 150000, createdBy: fx.managers.a.id } });
    leaseId = lease.id;
    await prisma.leaseParty.create({ data: { tenantOrgId: fx.a.id, leaseId: lease.id, tenantProfileId: profile.id, role: 'primary' } });
    freeDocId = (await prisma.document.create({ data: { tenantOrgId: fx.a.id, ownerType: 'tenant_profile', ownerId: profile.id, title: 'ID copy', category: 'id', classification: 'restricted', createdBy: fx.managers.a.id } })).id;
    heldDocId = (await prisma.document.create({ data: { tenantOrgId: fx.a.id, ownerType: 'tenant_profile', ownerId: profile.id, title: 'Dispute evidence', category: 'general', classification: 'confidential', createdBy: fx.managers.a.id } })).id;
    await prisma.legalHold.create({ data: { tenantOrgId: fx.a.id, name: 'Dispute hold', reason: 'Preserve dispute evidence for pending claim.', scopeJson: { documentIds: [heldDocId] }, status: 'active', approvedBy: lawyer.id, createdBy: lawyer.id } });
    await prisma.notification.create({ data: { tenantOrgId: fx.a.id, channel: 'email', recipientId: subjectUser.id, recipientAddress: SUBJECT, templateKey: 'invoice.issued', status: 'sent' } });
  });

  it('public intake creates the request with the SLA due date and starts identity verification', async () => {
    const unknown = await request(testApp()).post('/privacy-requests/intake').send({ orgSlug: 'nope-pm', kind: 'deletion', email: SUBJECT });
    expect(unknown.status).toBe(404);
    const res = await request(testApp()).post('/privacy-requests/intake').send({ orgSlug: fx.a.slug, kind: 'deletion', email: SUBJECT.toUpperCase() });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('identity_verification');
    expect(res.body.verificationUrl).toContain('mock.id.me');
    const days = Math.round((new Date(res.body.dueAt).getTime() - Date.now()) / 86_400_000);
    expect(days).toBe(45);
    requestId = res.body.id;
    const row = await prisma.privacyRequest.findUnique({ where: { id: requestId } });
    expect(row!.tenantOrgId).toBe(fx.a.id);
    expect(row!.subjectEmail).toBe(SUBJECT);
    externalId = (row!.discoveryJson as { identity: { externalId: string } }).identity.externalId;
    expect(await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'privacy_request.received', resourceId: requestId } })).not.toBeNull();
    const event = await prisma.auditLog.findFirst({ where: { action: 'privacy_request.identity_started', resourceId: requestId } });
    expect(event).not.toBeNull();
  });

  it('identity callback: wrong external id is 404; the mock verifies and records the method', async () => {
    expect((await request(testApp()).post(`/privacy-requests/${requestId}/verify`).send({ externalId: 'idme_mock_wrong' })).status).toBe(404);
    const res = await request(testApp()).post(`/privacy-requests/${requestId}/verify`).send({ externalId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ identityVerified: true, identityStatus: 'verified' });
    const row = await prisma.privacyRequest.findUnique({ where: { id: requestId } });
    expect(row!.identityMethod).toBe('idme-mock');
    expect(row!.identityVerifiedAt).not.toBeNull();
  });

  it('a failed verification leaves the request unverified and discovery is refused', async () => {
    const res = await request(testApp()).post('/privacy-requests/intake').send({ orgSlug: fx.a.slug, kind: 'access', email: 'someone.else@alpha.test' });
    expect(res.status).toBe(201);
    const row = await prisma.privacyRequest.findUnique({ where: { id: res.body.id } });
    const ext = (row!.discoveryJson as { identity: { externalId: string } }).identity.externalId;
    // Force the mock provider to report a failed check for this verification.
    (identityProvider() as MockIdentityVerificationProvider).results.set(ext, { externalId: ext, status: 'failed' });
    const verify = await request(testApp()).post(`/privacy-requests/${res.body.id}/verify`).send({ externalId: ext });
    expect(verify.body).toMatchObject({ identityVerified: false, identityStatus: 'failed' });
    const m = await asUser(fx.managers.a);
    const discover = await m.post(`/privacy-requests/${res.body.id}/discover`);
    expect(discover.status).toBe(409);
  });

  it('intake is rate limited per address', async () => {
    resetIntakeRateForTests();
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await request(testApp()).post('/privacy-requests/intake').send({ orgSlug: fx.a.slug, kind: 'access', email: `burst${i}@alpha.test` })).status;
    expect(last).toBe(429);
    resetIntakeRateForTests();
  });

  it('staff discovery collects the subject footprint inside the org only; email is masked without the sensitive permission', async () => {
    const m = await asUser(fx.managers.a);
    const res = await m.post(`/privacy-requests/${requestId}/discover`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('discovery');
    expect(res.body.subjectProfileId).toBe(profileId);
    expect(res.body.discoveryJson.counts).toMatchObject({ userProfiles: 1, tenantProfiles: 1, leases: 1, documents: 2, notifications: 1, contactMethods: 1, emergencyContacts: 1 });
    expect(res.body.discoveryJson.ids.leaseIds).toEqual([leaseId]);
    expect(res.body.subjectEmail).toBe('s***@alpha.test');
    const l = await asUser(lawyer);
    expect((await l.get(`/privacy-requests/${requestId}`)).body.subjectEmail).toBe(SUBJECT);
    const queue = await m.get('/privacy-requests?status=discovery');
    expect(queue.body.items.map((r: { id: string }) => r.id)).toContain(requestId);
  });

  it('exception review flags legal holds, retention duties, audit immutability and processors', async () => {
    const m = await asUser(fx.managers.a);
    const res = await m.post(`/privacy-requests/${requestId}/review-exceptions`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('exception_review');
    const types = res.body.exceptionsJson.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['legal_hold', 'retention', 'audit_log', 'third_party']));
    const hold = res.body.exceptionsJson.find((e: { type: string; resourceType?: string }) => e.type === 'legal_hold' && e.resourceType === 'document');
    expect(hold.ids).toEqual([heldDocId]);
    const retention = res.body.exceptionsJson.find((e: { type: string; resourceType?: string }) => e.type === 'retention' && e.resourceType === 'lease');
    expect(retention.policyKey).toBe('lease.records');
  });

  it('decision is a human gate: manager cannot decide, lawyer approves with a note; invalid transitions are 409', async () => {
    const m = await asUser(fx.managers.a);
    expect((await m.post(`/privacy-requests/${requestId}/decide`).send({ decision: 'approved', note: 'manager approving' })).status).toBe(403);
    expect((await m.post(`/privacy-requests/${requestId}/fulfill`).send({})).status).toBe(409);
    const l = await asUser(lawyer);
    const res = await l.post(`/privacy-requests/${requestId}/decide`).send({ decision: 'partial', note: 'Approve deletion except held evidence and retained lease records.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.decision).toBe('partial');
    expect(res.body.decidedBy).toBe(lawyer.id);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'privacy_request.partial', resourceId: requestId } });
    expect((audit!.metadata as { note: string }).note).toContain('held evidence');
    expect((await l.post(`/privacy-requests/${requestId}/decide`).send({ decision: 'denied', note: 'second decision' })).status).toBe(409);
  });

  it('fulfilment anonymizes the subject, soft-deletes free documents, keeps held documents and audit, renders the confirmation draft', async () => {
    const m = await asUser(fx.managers.a);
    const res = await m.post(`/privacy-requests/${requestId}/fulfill`).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('fulfilled');
    expect(res.body.confirmationDraft).toContain(requestId);
    expect(res.body.confirmationDraft).toContain('deletion');
    expect(res.body.manifestJson.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.manifestJson.actions.anonymizedTenantProfiles).toEqual([profileId]);
    expect(res.body.manifestJson.actions.softDeletedDocuments).toEqual([freeDocId]);
    expect(res.body.manifestJson.actions.heldDocuments).toEqual([heldDocId]);
    const profile = await prisma.tenantProfile.findUnique({ where: { id: profileId } });
    expect(profile).toMatchObject({ displayName: 'Deleted subject', email: null, phone: null, ssnLast4: null, dateOfBirth: null });
    expect(await prisma.contactMethod.count({ where: { tenantProfileId: profileId } })).toBe(0);
    expect(await prisma.emergencyContact.count({ where: { tenantProfileId: profileId } })).toBe(0);
    expect((await prisma.document.findUnique({ where: { id: freeDocId } }))!.deletedAt).not.toBeNull();
    expect((await prisma.document.findUnique({ where: { id: heldDocId } }))!.deletedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { tenantOrgId: fx.a.id, resourceId: requestId } })).toBeGreaterThan(3);
    const close = await m.post(`/privacy-requests/${requestId}/close`).send({ note: 'Confirmation sent to subject.' });
    expect(close.body.status).toBe('closed');
  });

  it('access requests build a data manifest instead of deleting', async () => {
    const intake = await request(testApp()).post('/privacy-requests/intake').send({ orgSlug: fx.a.slug, kind: 'access', email: 'pm@alpha.test' });
    const row = await prisma.privacyRequest.findUnique({ where: { id: intake.body.id } });
    await request(testApp()).post(`/privacy-requests/${intake.body.id}/verify`).send({ externalId: (row!.discoveryJson as { identity: { externalId: string } }).identity.externalId });
    const m = await asUser(fx.managers.a);
    await m.post(`/privacy-requests/${intake.body.id}/discover`);
    await m.post(`/privacy-requests/${intake.body.id}/review-exceptions`);
    await (await asUser(lawyer)).post(`/privacy-requests/${intake.body.id}/decide`).send({ decision: 'approved', note: 'Access request approved.' });
    const res = await m.post(`/privacy-requests/${intake.body.id}/fulfill`).send({});
    expect(res.body.status).toBe('fulfilled');
    expect(res.body.manifestJson.actions.auditEventCount).toBeGreaterThan(0);
    expect((await prisma.userProfile.findFirst({ where: { email: 'pm@alpha.test' } }))!.name).not.toBe('Deleted subject');
  });

  it('tenant isolation and denied paths', async () => {
    const b = await asUser(lawyerB);
    expect((await b.get('/privacy-requests')).body.items).toHaveLength(0);
    expect((await b.get(`/privacy-requests/${requestId}`)).status).toBe(404);
    expect((await b.post(`/privacy-requests/${requestId}/decide`).send({ decision: 'denied', note: 'cross tenant decision' })).status).toBe(404);
    const tenant = await asUser(await createUser(fx.a, 'tenant'));
    expect((await tenant.get('/privacy-requests')).status).toBe(403);
    const vendor = await asUser(await createUser(fx.a, 'vendor'));
    expect((await vendor.get('/privacy-requests')).status).toBe(403);
  });
});
