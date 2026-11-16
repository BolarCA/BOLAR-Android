import { describe, it, expect, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { twoTenantFixture, createUser, createUnit } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { createStorageAdapter } from '@bolar/integrations';
import { asUser } from './helpers.js';
import { runExportJob } from '../modules/packet-export/service.js';
import { drainMemoryQueue } from '../shared/queue.js';

async function leaseWithDocs(orgId: string, propertyId: string, createdBy: string, unitNumber: string, label: string) {
  const unit = await createUnit({ id: orgId, slug: '', name: '' }, propertyId, unitNumber);
  const lease = await prisma.lease.create({ data: { tenantOrgId: orgId, propertyId, unitId: unit.id, status: 'active', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), rentCents: 150000, createdBy } });
  const profile = await prisma.tenantProfile.create({ data: { tenantOrgId: orgId, displayName: `${label} Resident`, email: `${label.toLowerCase()}@${label.toLowerCase()}.test`, ssnLast4: '4321', dateOfBirth: new Date('1988-05-05'), status: 'active' } });
  await prisma.leaseParty.create({ data: { tenantOrgId: orgId, leaseId: lease.id, tenantProfileId: profile.id, role: 'primary' } });
  const docs = [] as { id: string }[];
  for (const [i, title] of [`${label} signed lease`, `${label} move-in inspection`].entries()) {
    const doc = await prisma.document.create({ data: { tenantOrgId: orgId, ownerType: 'lease', ownerId: lease.id, title, category: i === 0 ? 'lease' : 'general', classification: 'confidential', createdBy } });
    const body = Buffer.from(`${title} contents`);
    await prisma.documentVersion.create({ data: { tenantOrgId: orgId, documentId: doc.id, version: 1, storageKey: `org/${orgId}/documents/${doc.id}/v1.pdf`, fileName: `${title}.pdf`, mimeType: 'application/pdf', sizeBytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), scanStatus: 'clean', createdBy } });
    await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: null } });
    docs.push(doc);
  }
  await prisma.auditLog.create({ data: { tenantOrgId: orgId, actorId: createdBy, action: 'lease.transition', resourceType: 'lease', resourceId: lease.id, requestId: `seed_${label}`, metadata: { from: 'signed', to: 'active' } } });
  return { lease, profile, docs };
}

describe('evidence packet export (Day 50): approval gate, manifest completeness, redaction, no cross-tenant records', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let lawyer: Awaited<ReturnType<typeof createUser>>;
  let a: Awaited<ReturnType<typeof leaseWithDocs>>;
  let b: Awaited<ReturnType<typeof leaseWithDocs>>;
  let jobId: string;

  beforeAll(async () => {
    fx = await twoTenantFixture();
    lawyer = await createUser(fx.a, 'lawyer', 'counsel@alpha.test');
    a = await leaseWithDocs(fx.a.id, fx.propA.id, fx.managers.a.id, '501', 'Alpha');
    b = await leaseWithDocs(fx.b.id, fx.propB.id, fx.managers.b.id, '501', 'Beta');
    drainMemoryQueue();
  });

  it('request -> approve (not by the requester) -> job runs -> manifest is complete and tenant-pure', async () => {
    const l = await asUser(lawyer);
    expect((await l.post('/exports').send({ kind: 'evidence_packet', sourceType: 'lease', sourceId: b.lease.id })).status).toBe(400);
    const req = await l.post('/exports').send({ kind: 'evidence_packet', sourceType: 'lease', sourceId: a.lease.id, filters: { includeAudit: true }, redaction: { fields: ['ssnLast4', 'dateOfBirth'], note: 'Minimize subject identifiers.' } });
    expect(req.status).toBe(201);
    expect(req.body.status).toBe('requested');
    jobId = req.body.id;
    expect((await l.post(`/exports/${jobId}/approve`).send({ note: 'self approval' })).status).toBe(403);
    const before = await l.get(`/exports/${jobId}`);
    expect(before.body.download).toBeNull();
    const admin = await asUser(fx.admins.a);
    const approved = await admin.post(`/exports/${jobId}/approve`).send({ note: 'Packet reviewed for the eviction hearing.' });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('complete');
    expect(approved.body.approvedBy).toBe(fx.admins.a.id);
    const queued = drainMemoryQueue('exports');
    expect(queued.map((j) => j.data.exportJobId)).toContain(jobId);
    const detail = await l.get(`/exports/${jobId}`);
    expect(detail.status).toBe(200);
    const m = detail.body.manifestJson;
    expect(m.counts).toMatchObject({ files: 2, subjects: 1 });
    expect(m.files.map((f: { documentId: string }) => f.documentId).sort()).toEqual(a.docs.map((d) => d.id).sort());
    expect(m.files.every((f: { sha256: string | null; storageKey: string | null }) => f.sha256 && f.storageKey)).toBe(true);
    expect(m.files.map((f: { documentId: string }) => f.documentId)).not.toEqual(expect.arrayContaining(b.docs.map((d) => d.id)));
    expect(m.auditEvents.length).toBeGreaterThan(0);
    expect(m.auditEvents.some((e: { resourceId: string }) => e.resourceId === a.lease.id)).toBe(true);
    expect(m.auditEvents.some((e: { resourceId: string }) => e.resourceId === b.lease.id)).toBe(false);
    expect(m.subjects[0].id).toBe(a.profile.id);
    expect(m.subjects[0]).not.toHaveProperty('ssnLast4');
    expect(m.subjects[0]).not.toHaveProperty('dateOfBirth');
    expect(m.reviewer).toEqual({ requestedBy: lawyer.id, approvedBy: fx.admins.a.id });
    expect(m.tenantOrgId).toBe(fx.a.id);
    expect(detail.body.download.url).toContain(encodeURIComponent(`org/${fx.a.id}/exports/${jobId}/manifest.json`));
    // Stored object hash matches the recorded manifest hash
    const stored = await createStorageAdapter().getObject(`org/${fx.a.id}/exports/${jobId}/manifest.json`);
    expect(stored).not.toBeNull();
    expect(createHash('sha256').update(stored!.body).digest('hex')).toBe(detail.body.manifestSha256);
    expect(JSON.stringify(stored!.body.toString())).not.toContain(b.docs[0]!.id);
    expect(await prisma.auditLog.findFirst({ where: { action: 'export.completed', resourceId: jobId } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: 'export.approved', resourceId: jobId } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: 'export.downloaded', resourceId: jobId, actorId: lawyer.id } })).not.toBeNull();
  });

  it('running the job again is idempotent and a non-approved job refuses to run', async () => {
    const again = await runExportJob(jobId);
    expect(again.status).toBe('complete');
    expect(again.sha256).toBe((await prisma.exportJob.findUnique({ where: { id: jobId } }))!.manifestSha256);
    const l = await asUser(lawyer);
    const pending = await l.post('/exports').send({ kind: 'evidence_packet', sourceType: 'property', sourceId: fx.propA.id });
    await expect(runExportJob(pending.body.id)).rejects.toThrow(/approval required/);
    const denied = await (await asUser(fx.admins.a)).post(`/exports/${pending.body.id}/deny`).send({ note: 'Scope too broad; narrow to the lease.' });
    expect(denied.body.status).toBe('denied');
    expect((await (await asUser(fx.admins.a)).post(`/exports/${pending.body.id}/approve`).send({ note: 'late' })).status).toBe(409);
  });

  it('requesters see only their own jobs; approvers see all; cross-tenant jobs are 404', async () => {
    const gov = await asUser(await createUser(fx.a, 'government'));
    expect((await gov.get('/exports')).body.items).toHaveLength(0);
    expect((await gov.get(`/exports/${jobId}`)).status).toBe(404);
    const own = await gov.post('/exports').send({ kind: 'compliance_review', sourceType: 'property', sourceId: fx.propA.id });
    expect(own.status).toBe(201);
    expect((await gov.get('/exports')).body.items.map((j: { id: string }) => j.id)).toEqual([own.body.id]);
    const admin = await asUser(fx.admins.a);
    expect((await admin.get('/exports')).body.items.length).toBeGreaterThanOrEqual(3);
    const bLawyer = await asUser(await createUser(fx.b, 'lawyer'));
    expect((await bLawyer.get('/exports')).body.items).toHaveLength(0);
    expect((await bLawyer.get(`/exports/${jobId}`)).status).toBe(404);
    expect((await bLawyer.post(`/exports/${jobId}/approve`).send({ note: 'cross tenant' })).status).toBe(404);
    const tenant = await asUser(await createUser(fx.a, 'tenant'));
    expect((await tenant.post('/exports').send({ kind: 'evidence_packet', sourceType: 'lease', sourceId: a.lease.id })).status).toBe(403);
  });

  it('privileged case packets can only be requested by someone who may open the case', async () => {
    const l = await asUser(lawyer);
    const c = await l.post('/cases').send({ title: 'Packet case', kind: 'dispute', leaseId: a.lease.id });
    const stranger = await asUser(await createUser(fx.a, 'lawyer'));
    const denied = await stranger.post('/exports').send({ kind: 'evidence_packet', sourceType: 'case', sourceId: c.body.id });
    expect(denied.status).toBe(404);
    expect(await prisma.auditLog.findFirst({ where: { action: 'access.denied', resourceType: 'case', resourceId: c.body.id, outcome: 'deny' } })).not.toBeNull();
    const ok = await l.post('/exports').send({ kind: 'evidence_packet', sourceType: 'case', sourceId: c.body.id });
    expect(ok.status).toBe(201);
    await (await asUser(fx.admins.a)).post(`/exports/${ok.body.id}/approve`).send({ note: 'approved for hearing' });
    const detail = await l.get(`/exports/${ok.body.id}`);
    expect(detail.body.manifestJson.counts.files).toBe(2);
    expect(detail.body.manifestJson.auditEvents.some((e: { action: string }) => e.action === 'case.created')).toBe(true);
  });

  it('audit manifest export returns the rows with a verifiable sha256 and is permission gated', async () => {
    const l = await asUser(lawyer);
    const res = await l.get(`/audit/export?resourceType=lease&resourceId=${a.lease.id}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    expect(res.body.rows.every((r: { resourceId: string }) => r.resourceId === a.lease.id)).toBe(true);
    expect(res.body.sha256).toBe(createHash('sha256').update(JSON.stringify(res.body.rows)).digest('hex'));
    expect(await prisma.auditLog.findFirst({ where: { action: 'audit.export', resourceId: a.lease.id } })).not.toBeNull();
    const bLawyer = await asUser(await createUser(fx.b, 'lawyer'));
    expect((await bLawyer.get(`/audit/export?resourceType=lease&resourceId=${a.lease.id}`)).body.count).toBe(0);
    const manager = await asUser(fx.managers.a);
    expect((await manager.get(`/audit/export?resourceType=lease&resourceId=${a.lease.id}`)).status).toBe(403);
  });
});
