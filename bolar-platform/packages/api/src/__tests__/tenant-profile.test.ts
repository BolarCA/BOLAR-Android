import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';

const PROFILE = { displayName: 'Priya Prospect', email: 'priya.prospect@alpha.test', phone: '+15125550199', dateOfBirth: '1990-05-04', ssnLast4: '4321', kind: 'individual', status: 'applicant' };

describe('tenant profiles: CRUD, sensitive field classification, self-service read (Day 21)', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let profileId: string;
  beforeAll(async () => { fx = await twoTenantFixture(); });

  it('manager creates a profile; restricted and confidential fields come back redacted without clearance', async () => {
    const m = await asUser(fx.managers.a);
    const res = await m.post('/tenant-profiles').send(PROFILE);
    expect(res.status).toBe(201);
    profileId = res.body.id;
    expect(res.body.displayName).toBe('Priya Prospect');
    expect(res.body.classification).toBe('restricted');
    expect(res.body.dateOfBirth).toBeNull();
    expect(res.body.ssnLast4).toBeNull();
    expect(res.body.email).toBeNull();
    expect(res.body.phone).toBeNull();
    expect(res.body.redactedFields.sort()).toEqual(['dateOfBirth', 'email', 'phone', 'ssnLast4']);
    expect(res.body.clearedClassification).toBe('internal');
    const created = await prisma.auditLog.findFirst({ where: { action: 'tenant_profile.create', resourceId: profileId } });
    expect(created).not.toBeNull();
    // the audit payload never carries PII
    expect(JSON.stringify(created!.after)).not.toContain('4321');
    expect(JSON.stringify(created!.after)).not.toContain('priya.prospect');
  });

  it('list is filtered and redacted; ssnLast4 is validated', async () => {
    const m = await asUser(fx.managers.a);
    const bad = await m.post('/tenant-profiles').send({ displayName: 'Bad SSN', ssnLast4: '12' });
    expect(bad.status).toBe(400);
    const list = await m.get('/tenant-profiles?q=priya&status=applicant');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].ssnLast4).toBeNull();
    expect(list.body.items[0].redactedFields).toContain('ssnLast4');
    const none = await m.get('/tenant-profiles?status=blocked');
    expect(none.body.items).toHaveLength(0);
  });

  it('read_sensitive permission + declared purpose clears the record and is audited', async () => {
    const admin = await asUser(fx.admins.a, { 'X-Access-Purpose': 'lease_administration' });
    const res = await admin.get(`/tenant-profiles/${profileId}`);
    expect(res.status).toBe(200);
    expect(res.body.ssnLast4).toBe('4321');
    expect(res.body.dateOfBirth).toContain('1990-05-04');
    expect(res.body.email).toBe('priya.prospect@alpha.test');
    expect(res.body.redactedFields).toEqual([]);
    expect(res.body.clearedClassification).toBe('restricted');
    const allow = await prisma.auditLog.findFirst({ where: { action: 'sensitive.access', resourceId: profileId, outcome: 'allow', actorId: fx.admins.a.id } });
    expect(allow).not.toBeNull();
    // same permission without a purpose header does not clear the gate
    const noPurpose = await asUser(fx.admins.a);
    const redacted = await noPurpose.get(`/tenant-profiles/${profileId}`);
    expect(redacted.body.ssnLast4).toBeNull();
  });

  it('GET /sensitive answers review_required until an approved request exists, then returns full fields', async () => {
    const m = await asUser(fx.managers.a);
    const blocked = await m.get(`/tenant-profiles/${profileId}/sensitive`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('review_required');
    const reviewAudit = await prisma.auditLog.findFirst({ where: { action: 'sensitive.access', resourceId: profileId, outcome: 'review_required', actorId: fx.managers.a.id } });
    expect(reviewAudit).not.toBeNull();

    const req = await m.post('/sensitive-access/requests').send({ resourceType: 'tenant_profile', resourceId: profileId, classification: 'restricted', purpose: 'lease_administration', justification: 'Identity verification before lease signing.' });
    expect(req.status).toBe(201);
    const lawyer = await createUser(fx.a, 'lawyer');
    const l = await asUser(lawyer);
    expect((await l.post(`/sensitive-access/requests/${req.body.id}/decide`).send({ decision: 'approved', ttlHours: 1 })).status).toBe(200);

    const ok = await m.get(`/tenant-profiles/${profileId}/sensitive`);
    expect(ok.status).toBe(200);
    expect(ok.body.ssnLast4).toBe('4321');
    const detail = await m.get(`/tenant-profiles/${profileId}`);
    expect(detail.body.ssnLast4).toBe('4321');
    expect(detail.body.clearedClassification).toBe('restricted');
    // list redaction uses wildcard clearance only, so other records stay redacted
    const other = await m.post('/tenant-profiles').send({ displayName: 'Other Person', ssnLast4: '9999' });
    expect((await m.get(`/tenant-profiles/${other.body.id}`)).body.ssnLast4).toBeNull();
  });

  it('sub-resources: contacts and emergency contacts are confidential, occupants are internal', async () => {
    const m = await asUser(fx.managers.a);
    const other = (await m.get('/tenant-profiles?q=other')).body.items[0];
    expect((await m.post(`/tenant-profiles/${other.id}/contacts`).send({ kind: 'email', value: 'other.person@alpha.test', isPrimary: true })).status).toBe(201);
    expect((await m.post(`/tenant-profiles/${other.id}/contacts`).send({ kind: 'mail', value: '12 Elm St, Austin TX' })).status).toBe(201);
    expect((await m.post(`/tenant-profiles/${other.id}/emergency-contacts`).send({ name: 'Sam Sibling', relationship: 'sibling', phone: '+15125550111' })).status).toBe(201);
    const occ = await m.post(`/tenant-profiles/${other.id}/occupants`).send({ name: 'Kid Person', relationship: 'child', isMinor: true });
    expect(occ.status).toBe(201);

    const contacts = await m.get(`/tenant-profiles/${other.id}/contacts`);
    const email = contacts.body.items.find((c: { kind: string }) => c.kind === 'email');
    const mail = contacts.body.items.find((c: { kind: string }) => c.kind === 'mail');
    expect(email.value).toBeNull();
    expect(email.redactedFields).toEqual(['value']);
    expect(mail.value).toContain('Elm St');

    const emergency = await m.get(`/tenant-profiles/${other.id}/emergency-contacts`);
    expect(emergency.body.items[0].phone).toBeNull();
    expect(emergency.body.items[0].name).toBeNull();
    expect(emergency.body.items[0].relationship).toBe('sibling');

    const detail = await m.get(`/tenant-profiles/${other.id}`);
    expect(detail.body.redactedFields).toContain('emergencyContacts');
    expect(detail.body.occupants).toHaveLength(1);
    expect(detail.body.occupants[0].isMinor).toBe(true);

    const admin = await asUser(fx.admins.a, { 'X-Access-Purpose': 'lease_administration' });
    const full = await admin.get(`/tenant-profiles/${other.id}/emergency-contacts`);
    expect(full.body.items[0].phone).toBe('+15125550111');

    expect((await m.delete(`/tenant-profiles/${other.id}/occupants/${occ.body.id}`)).status).toBe(204);
    expect((await m.delete(`/tenant-profiles/${other.id}/occupants/${occ.body.id}`)).status).toBe(404);
    expect((await m.get(`/tenant-profiles/${other.id}`)).body.occupants).toHaveLength(0);
  });

  it('update changes status and is audited; linking a user twice conflicts', async () => {
    const m = await asUser(fx.managers.a);
    const upd = await m.patch(`/tenant-profiles/${profileId}`).send({ status: 'active', notes: 'Approved application.' });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe('active');
    const auditRow = await prisma.auditLog.findFirst({ where: { action: 'tenant_profile.update', resourceId: profileId } });
    expect(auditRow).not.toBeNull();
    const tenantUser = await createUser(fx.a, 'tenant');
    expect((await m.patch(`/tenant-profiles/${profileId}`).send({ userId: tenantUser.id })).status).toBe(200);
    const dup = await m.post('/tenant-profiles').send({ displayName: 'Dup Link', userId: tenantUser.id });
    expect(dup.status).toBe(409);
    expect((await m.patch(`/tenant-profiles/${profileId}`).send({ userId: 'nope' })).status).toBe(400);
  });

  it('tenants read their own profile in full but cannot list or read others (denied is 404 + access.denied audit)', async () => {
    const row = await prisma.tenantProfile.findUniqueOrThrow({ where: { id: profileId } });
    const tenantUser = await prisma.userProfile.findUniqueOrThrow({ where: { id: row.userId! } });
    const t = await asUser({ id: tenantUser.id, email: tenantUser.email, name: tenantUser.name, orgId: fx.a.id, role: 'tenant' });
    const mine = await t.get(`/tenant-profiles/${profileId}`);
    expect(mine.status).toBe(200);
    expect(mine.body.ssnLast4).toBe('4321');
    expect(mine.body.redactedFields).toEqual([]);
    expect((await t.get(`/tenant-profiles/${profileId}/sensitive`)).status).toBe(200);
    expect((await t.get('/tenant-profiles')).status).toBe(403);
    const other = await prisma.tenantProfile.findFirstOrThrow({ where: { tenantOrgId: fx.a.id, id: { not: profileId } } });
    expect((await t.get(`/tenant-profiles/${other.id}`)).status).toBe(404);
    const denied = await prisma.auditLog.findFirst({ where: { action: 'access.denied', actorId: tenantUser.id, resourceId: other.id } });
    expect(denied).not.toBeNull();
    expect((await t.patch(`/tenant-profiles/${profileId}`).send({ notes: 'x' })).status).toBe(403);
  });

  it('tenant isolation: org B cannot see or update org A profiles', async () => {
    const b = await asUser(fx.managers.b);
    expect((await b.get(`/tenant-profiles/${profileId}`)).status).toBe(404);
    expect((await b.get(`/tenant-profiles/${profileId}/sensitive`)).status).toBe(404);
    expect((await b.patch(`/tenant-profiles/${profileId}`).send({ status: 'blocked' })).status).toBe(404);
    expect((await b.post(`/tenant-profiles/${profileId}/occupants`).send({ name: 'Nope', relationship: 'other' })).status).toBe(404);
    const list = await b.get('/tenant-profiles');
    expect(list.body.items).toHaveLength(0);
    const own = await b.post('/tenant-profiles').send({ displayName: 'Beta Person' });
    expect(own.status).toBe(201);
    expect((await asUser(fx.managers.a).then((a) => a.get(`/tenant-profiles/${own.body.id}`))).status).toBe(404);
  });

  it('vendor role has no tenant profile access', async () => {
    const vendor = await createUser(fx.a, 'vendor');
    const v = await asUser(vendor);
    expect((await v.get('/tenant-profiles')).status).toBe(403);
    expect((await v.get(`/tenant-profiles/${profileId}`)).status).toBe(404);
    expect((await v.post('/tenant-profiles').send({ displayName: 'x' })).status).toBe(403);
  });
});
