import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { twoTenantFixture, createUser, createUnit, relate } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser, testApp } from './helpers.js';
import { drainMemoryQueue } from '../shared/queue.js';
import { localStorage } from '../modules/storage/adapter.js';

/** Turn an absolute signed URL into the path+query supertest can hit on the in-process app. */
const pathOf = (url: string) => { const u = new URL(url); return `${u.pathname}${u.search}`; };

describe('documents + storage (Day 26): upload/download, signed URLs, classification gates, legal hold', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let leaseId: string;
  let unitId: string;
  let tenantUser: Awaited<ReturnType<typeof createUser>>;
  let vendorUser: Awaited<ReturnType<typeof createUser>>;
  let lawyer: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    fx = await twoTenantFixture();
    const unit = await createUnit(fx.a, fx.propA.id, '101');
    unitId = unit.id;
    tenantUser = await createUser(fx.a, 'tenant');
    vendorUser = await createUser(fx.a, 'vendor');
    lawyer = await createUser(fx.a, 'lawyer');
    const lease = await prisma.lease.create({ data: { tenantOrgId: fx.a.id, propertyId: fx.propA.id, unitId, status: 'active', startDate: new Date(), endDate: new Date(Date.now() + 365 * 86_400_000), rentCents: 150000, createdBy: fx.managers.a.id } });
    leaseId = lease.id;
    await relate(fx.a, tenantUser.id, 'tenant_of', 'lease', leaseId);
  });

  it('two-step upload: create -> signed PUT -> finalize computes sha256, scans, publishes document.uploaded; signed GET works, tampered/expired links are 404', async () => {
    const m = await asUser(fx.managers.a);
    const bytes = Buffer.from('Hello BOLAR lease addendum\n');
    const created = await m.post('/documents').send({ ownerType: 'lease', ownerId: leaseId, title: 'Lease addendum', classification: 'internal', category: 'lease', fileName: 'addendum.txt', mimeType: 'text/plain' });
    expect(created.status).toBe(201);
    expect(created.body.uploadUrl).toContain('/storage/object?');
    expect(created.body.version.scanStatus).toBe('pending');
    expect(created.body.currentVersionId).toBeNull();
    const storageKey = new URL(created.body.uploadUrl).searchParams.get('key')!;
    expect(storageKey.startsWith(`org/${fx.a.id}/documents/${created.body.id}/v1/`)).toBe(true);

    // PUT with the wrong method signature is rejected; the real PUT stores the bytes.
    const wrongMethod = await request(testApp()).get(pathOf(created.body.uploadUrl));
    expect(wrongMethod.status).toBe(404);
    const put = await request(testApp()).put(pathOf(created.body.uploadUrl)).set('Content-Type', 'text/plain').send(bytes);
    expect(put.status).toBe(200);
    expect(put.body.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));

    drainMemoryQueue('domain-events');
    const badSha = await m.post(`/documents/${created.body.id}/versions/${created.body.version.id}/finalize`).send({ sha256: 'a'.repeat(64) });
    expect(badSha.status).toBe(409);
    const fin = await m.post(`/documents/${created.body.id}/versions/${created.body.version.id}/finalize`).send({ sha256: put.body.sha256 });
    expect(fin.status).toBe(200);
    expect(fin.body.currentVersionId).toBe(created.body.version.id);
    expect(fin.body.versions[0]).toMatchObject({ scanStatus: 'clean', sizeBytes: bytes.length, sha256: put.body.sha256 });
    const events = drainMemoryQueue('domain-events');
    expect(events.some((j) => (j.data as { name: string }).name === 'document.uploaded')).toBe(true);

    const dl = await m.get(`/documents/${created.body.id}/versions/${created.body.version.id}/download`);
    expect(dl.status).toBe(200);
    expect(new Date(dl.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const got = await request(testApp()).get(pathOf(dl.body.url));
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toContain('text/plain');
    expect(got.text).toBe(bytes.toString());

    // Signed URL expiry invariant: tampered signature and expired timestamp both answer 404.
    const tampered = new URL(dl.body.url); tampered.searchParams.set('sig', 'f'.repeat(64));
    expect((await request(testApp()).get(pathOf(tampered.toString()))).status).toBe(404);
    const exp = Math.floor(Date.now() / 1000) - 60;
    const expiredSig = localStorage()!.sign(storageKey, 'GET', exp);
    expect((await request(testApp()).get(`/storage/object?key=${encodeURIComponent(storageKey)}&method=GET&exp=${exp}&sig=${expiredSig}`)).status).toBe(404);

    const audits = await prisma.auditLog.findMany({ where: { tenantOrgId: fx.a.id, resourceId: created.body.id } });
    const actions = audits.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['document.create', 'document.version_create', 'document.finalize', 'document.download']));
  });

  it('inline upload (contentBase64) finalizes immediately; new versions increment and switch the current version', async () => {
    const m = await asUser(fx.managers.a);
    const v1 = Buffer.from('v1 bytes');
    const created = await m.post('/documents').send({ ownerType: 'property', ownerId: fx.propA.id, title: 'Insurance certificate', category: 'insurance', fileName: 'cert.pdf', mimeType: 'application/pdf', contentBase64: v1.toString('base64') });
    expect(created.status).toBe(201);
    expect(created.body.uploadUrl).toBeUndefined();
    expect(created.body.version).toMatchObject({ version: 1, scanStatus: 'clean', sizeBytes: v1.length });
    expect(created.body.currentVersionId).toBe(created.body.version.id);
    const v2 = await m.post(`/documents/${created.body.id}/versions`).send({ fileName: 'cert-v2.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('v2 bytes!').toString('base64') });
    expect(v2.status).toBe(201);
    expect(v2.body.version.version).toBe(2);
    const detail = await m.get(`/documents/${created.body.id}`);
    expect(detail.body.currentVersionId).toBe(v2.body.version.id);
    expect(detail.body.versions).toHaveLength(2);
    const empty = await m.post(`/documents/${created.body.id}/versions`).send({ fileName: 'x.pdf', mimeType: 'application/pdf', contentBase64: '' });
    expect(empty.status).toBe(400);
  });

  it('list filters by owner/category and is tenant isolated; unknown owner is a validation error', async () => {
    const m = await asUser(fx.managers.a);
    const list = await m.get(`/documents?ownerType=property&ownerId=${fx.propA.id}&category=insurance`);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items.every((d: { ownerId: string }) => d.ownerId === fx.propA.id)).toBe(true);
    const docA = list.body.items[0].id as string;
    const b = await asUser(fx.managers.b);
    expect((await b.get('/documents')).body.items.map((d: { id: string }) => d.id)).not.toContain(docA);
    expect((await b.get(`/documents/${docA}`)).status).toBe(404);
    expect((await b.delete(`/documents/${docA}`)).status).toBe(404);
    const unknownOwner = await m.post('/documents').send({ ownerType: 'lease', ownerId: 'nope', title: 'x', fileName: 'x.txt', mimeType: 'text/plain' });
    expect(unknownOwner.status).toBe(400);
    const crossOwner = await b.post('/documents').send({ ownerType: 'property', ownerId: fx.propA.id, title: 'x', fileName: 'x.txt', mimeType: 'text/plain' });
    expect(crossOwner.status).toBe(400);
  });

  it('classification gate: confidential detail/download need clearance; restricted rows hidden from lists unless cleared', async () => {
    const m = await asUser(fx.managers.a);
    const conf = await m.post('/documents').send({ ownerType: 'lease', ownerId: leaseId, title: 'Signed lease', classification: 'confidential', category: 'lease', fileName: 'lease.txt', mimeType: 'text/plain', contentBase64: Buffer.from('signed').toString('base64') });
    expect(conf.status).toBe(201);
    expect(conf.body.gated).toBe(true);
    const restricted = await m.post('/documents').send({ ownerType: 'lease', ownerId: leaseId, title: 'Screening report', classification: 'restricted', category: 'screening_report', fileName: 'report.txt', mimeType: 'text/plain', contentBase64: Buffer.from('report').toString('base64') });
    expect(restricted.status).toBe(201);

    // Manager without clearance: listed (confidential) but detail/download are review_required.
    const list = await m.get(`/documents?ownerType=lease&ownerId=${leaseId}`);
    const ids = list.body.items.map((d: { id: string }) => d.id);
    expect(ids).toContain(conf.body.id);
    expect(ids).not.toContain(restricted.body.id);
    const detail = await m.get(`/documents/${conf.body.id}`);
    expect(detail.status).toBe(403);
    expect(detail.body.code).toBe('review_required');
    expect((await m.get(`/documents/${conf.body.id}/versions/${conf.body.version.id}/download`)).status).toBe(403);

    // Lawyer with document:read_restricted + declared purpose clears both, and the access is audited.
    const l = await asUser(lawyer, { 'X-Access-Purpose': 'legal_case' });
    const lawyerList = await m.get(`/documents?ownerType=lease&ownerId=${leaseId}`);
    expect(lawyerList.status).toBe(200);
    const cleared = await l.get(`/documents?ownerType=lease&ownerId=${leaseId}`);
    expect(cleared.body.items.map((d: { id: string }) => d.id)).toContain(restricted.body.id);
    expect((await l.get(`/documents/${restricted.body.id}`)).status).toBe(200);
    const dl = await l.get(`/documents/${conf.body.id}/versions/${conf.body.version.id}/download`);
    expect(dl.status).toBe(200);
    const noPurpose = await asUser(lawyer);
    expect((await noPurpose.get(`/documents/${restricted.body.id}`)).status).toBe(403);
    const sensitive = await prisma.auditLog.findMany({ where: { tenantOrgId: fx.a.id, action: 'sensitive.access', resourceId: conf.body.id } });
    expect(sensitive.some((a) => a.outcome === 'review_required')).toBe(true);
    expect(sensitive.some((a) => a.outcome === 'allow')).toBe(true);
  });

  it('relationship scoping: tenant sees lease docs via tenant_of; vendor without a relationship gets 404 and an access.denied audit row', async () => {
    const t = await asUser(tenantUser);
    const mine = await t.get('/documents');
    expect(mine.status).toBe(200);
    expect(mine.body.items.length).toBeGreaterThan(0);
    expect(mine.body.items.every((d: { ownerType: string; ownerId: string }) => d.ownerType === 'lease' && d.ownerId === leaseId)).toBe(true);
    const leaseDoc = mine.body.items.find((d: { classification: string }) => d.classification === 'internal');
    expect(leaseDoc).toBeDefined();
    expect((await t.get(`/documents/${leaseDoc.id}`)).status).toBe(200);
    expect((await t.get(`/documents?ownerType=property&ownerId=${fx.propA.id}`)).status).toBe(404);
    // tenant role has no document:write
    expect((await t.post('/documents').send({ ownerType: 'lease', ownerId: leaseId, title: 'x', fileName: 'x.txt', mimeType: 'text/plain' })).status).toBe(403);

    const v = await asUser(vendorUser);
    expect((await v.get('/documents')).body.items).toHaveLength(0);
    const denied = await v.get(`/documents/${leaseDoc.id}`);
    expect(denied.status).toBe(404);
    const row = await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'access.denied', actorId: vendorUser.id, resourceId: leaseId } });
    expect(row).not.toBeNull();
    expect(row!.outcome).toBe('deny');
  });

  it('delete is soft and blocked by legal hold (document flag or active hold scope) with 409 legal_hold', async () => {
    const m = await asUser(fx.managers.a);
    const doc = await m.post('/documents').send({ ownerType: 'unit', ownerId: unitId, title: 'Move-in checklist', fileName: 'checklist.txt', mimeType: 'text/plain', contentBase64: Buffer.from('ok').toString('base64') });
    const held = await m.post('/documents').send({ ownerType: 'unit', ownerId: unitId, title: 'Evidence photo log', fileName: 'log.txt', mimeType: 'text/plain', contentBase64: Buffer.from('ok').toString('base64') });
    await prisma.legalHold.create({ data: { tenantOrgId: fx.a.id, name: 'Case 1', reason: 'Litigation', scopeJson: { documentIds: [held.body.id] }, approvedBy: fx.admins.a.id, createdBy: fx.admins.a.id } });
    const blocked = await m.delete(`/documents/${held.body.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('legal_hold');
    expect((await m.post(`/documents/${held.body.id}/versions`).send({ fileName: 'x.txt', mimeType: 'text/plain', contentBase64: Buffer.from('x').toString('base64') })).status).toBe(409);
    await prisma.document.update({ where: { id: doc.body.id }, data: { legalHold: true } });
    expect((await m.delete(`/documents/${doc.body.id}`)).body.code).toBe('legal_hold');
    await prisma.document.update({ where: { id: doc.body.id }, data: { legalHold: false } });
    expect((await m.delete(`/documents/${doc.body.id}`)).status).toBe(204);
    expect((await m.get(`/documents/${doc.body.id}`)).status).toBe(404);
    expect((await prisma.document.findUnique({ where: { id: doc.body.id } }))!.deletedAt).not.toBeNull();
    const del = await prisma.auditLog.findFirst({ where: { action: 'document.delete', resourceId: doc.body.id, outcome: 'allow' } });
    expect(del).not.toBeNull();
  });

  it('storage endpoint rejects malformed requests without leaking: bad query 400, empty body 400, foreign-prefix key 404', async () => {
    expect((await request(testApp()).get('/storage/object?key=org/x/y&method=GET&exp=abc&sig=zz')).status).toBe(400);
    const exp = Math.floor(Date.now() / 1000) + 60;
    const local = localStorage()!;
    const goodKey = `org/${fx.a.id}/documents/scratch/v1/empty.txt`;
    const emptyPut = await request(testApp()).put(`/storage/object?key=${encodeURIComponent(goodKey)}&method=PUT&exp=${exp}&sig=${local.sign(goodKey, 'PUT', exp)}`).set('Content-Type', 'text/plain').send('');
    expect(emptyPut.status).toBe(400);
    const foreign = 'tmp/escape.txt';
    expect((await request(testApp()).put(`/storage/object?key=${encodeURIComponent(foreign)}&method=PUT&exp=${exp}&sig=${local.sign(foreign, 'PUT', exp)}`).set('Content-Type', 'text/plain').send('x')).status).toBe(404);
  });
});
