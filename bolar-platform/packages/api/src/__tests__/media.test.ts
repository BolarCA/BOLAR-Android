import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { twoTenantFixture, createUser, createUnit, relate } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser, testApp } from './helpers.js';
import { drainMemoryQueue } from '../shared/queue.js';

const pathOf = (url: string) => { const u = new URL(url); return `${u.pathname}${u.search}`; };
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('media (Day 27): upload with limits, relationship-gated access, denied paths', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let workOrderId: string;
  let unitId: string;
  let tenantUser: Awaited<ReturnType<typeof createUser>>;
  let assignedVendor: Awaited<ReturnType<typeof createUser>>;
  let otherVendor: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    fx = await twoTenantFixture();
    unitId = (await createUnit(fx.a, fx.propA.id, '201')).id;
    tenantUser = await createUser(fx.a, 'tenant');
    assignedVendor = await createUser(fx.a, 'vendor');
    otherVendor = await createUser(fx.a, 'vendor');
    const wo = await prisma.workOrder.create({ data: { tenantOrgId: fx.a.id, propertyId: fx.propA.id, unitId, requesterId: tenantUser.id, title: 'Leak', description: 'Under sink', category: 'plumbing' } });
    workOrderId = wo.id;
    await relate(fx.a, assignedVendor.id, 'assigned_to', 'work_order', workOrderId);
  });

  it('manager uploads inline media; list carries signed download URLs; media.uploaded is published', async () => {
    const m = await asUser(fx.managers.a);
    drainMemoryQueue('domain-events');
    const up = await m.post('/media').send({ ownerType: 'work_order', ownerId: workOrderId, fileName: 'before.png', mimeType: 'image/png', contentBase64: PNG.toString('base64') });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ status: 'uploaded', thumbnailKey: null, sizeBytes: PNG.length });
    expect(up.body.downloadUrl).toContain('/storage/object?');
    expect(drainMemoryQueue('domain-events').some((j) => (j.data as { name: string }).name === 'media.uploaded')).toBe(true);
    const list = await m.get(`/media?ownerType=work_order&ownerId=${workOrderId}`);
    expect(list.status).toBe(200);
    expect(list.body.items[0].downloadUrl).toBeDefined();
    const got = await request(testApp()).get(pathOf(list.body.items[0].downloadUrl));
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toContain('image/png');
    const dl = await m.get(`/media/${up.body.id}/download`);
    expect(dl.status).toBe(200);
    expect(await prisma.auditLog.findFirst({ where: { action: 'media.download', tenantOrgId: fx.a.id } })).not.toBeNull();
  });

  it('two-step media upload (signed PUT + finalize) for larger files', async () => {
    const m = await asUser(fx.managers.a);
    const created = await m.post('/media').send({ ownerType: 'unit', ownerId: unitId, fileName: 'inspection.pdf', mimeType: 'application/pdf', sizeBytes: 11 });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('uploading');
    expect(created.body.downloadUrl).toBeUndefined();
    const notYet = await m.post(`/media/${created.body.id}/finalize`);
    expect(notYet.status).toBe(409);
    const put = await request(testApp()).put(pathOf(created.body.uploadUrl)).set('Content-Type', 'application/pdf').send(Buffer.from('%PDF-1.4 x'));
    expect(put.status).toBe(200);
    const fin = await m.post(`/media/${created.body.id}/finalize`);
    expect(fin.status).toBe(200);
    expect(fin.body.status).toBe('uploaded');
    expect(fin.body.downloadUrl).toBeDefined();
  });

  it('size and type limits are enforced', async () => {
    const m = await asUser(fx.managers.a);
    expect((await m.post('/media').send({ ownerType: 'work_order', ownerId: workOrderId, fileName: 'x.exe', mimeType: 'application/x-msdownload', contentBase64: PNG.toString('base64') })).status).toBe(400);
    expect((await m.post('/media').send({ ownerType: 'work_order', ownerId: workOrderId, fileName: 'big.mp4', mimeType: 'video/mp4', sizeBytes: 11 * 1024 * 1024 })).status).toBe(400);
    expect((await m.post('/media').send({ ownerType: 'work_order', ownerId: workOrderId, fileName: 'nosize.mp4', mimeType: 'video/mp4' })).status).toBe(400);
    expect((await m.post('/media').send({ ownerType: 'work_order', ownerId: 'missing', fileName: 'a.png', mimeType: 'image/png', contentBase64: PNG.toString('base64') })).status).toBe(400);
  });

  it('relationship gate: assigned vendor and requesting tenant may read/upload; unrelated vendor gets 404 + access.denied audit', async () => {
    const v = await asUser(assignedVendor);
    const list = await v.get(`/media?ownerType=work_order&ownerId=${workOrderId}`);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    const vendorUpload = await v.post('/media').send({ ownerType: 'work_order', ownerId: workOrderId, fileName: 'after.png', mimeType: 'image/png', contentBase64: PNG.toString('base64') });
    expect(vendorUpload.status).toBe(201);
    const t = await asUser(tenantUser);
    expect((await t.get(`/media?ownerType=work_order&ownerId=${workOrderId}`)).status).toBe(200);
    expect((await t.get(`/media/${vendorUpload.body.id}/download`)).status).toBe(200);

    const o = await asUser(otherVendor);
    expect((await o.get(`/media?ownerType=work_order&ownerId=${workOrderId}`)).status).toBe(404);
    expect((await o.get(`/media/${vendorUpload.body.id}/download`)).status).toBe(404);
    expect((await o.post('/media').send({ ownerType: 'work_order', ownerId: workOrderId, fileName: 'x.png', mimeType: 'image/png', contentBase64: PNG.toString('base64') })).status).toBe(404);
    expect((await o.get(`/media?ownerType=unit&ownerId=${unitId}`)).status).toBe(404);
    const denied = await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'access.denied', actorId: otherVendor.id, resourceId: workOrderId } });
    expect(denied).not.toBeNull();
    expect((denied!.metadata as { permission: string }).permission).toBe('media:read');

    // the tenant may delete their own upload but not the vendor's
    const tenantUpload = await t.post('/media').send({ ownerType: 'work_order', ownerId: workOrderId, fileName: 'mine.png', mimeType: 'image/png', contentBase64: PNG.toString('base64') });
    expect((await t.delete(`/media/${vendorUpload.body.id}`)).status).toBe(404);
    expect((await t.delete(`/media/${tenantUpload.body.id}`)).status).toBe(204);
    expect((await t.get(`/media/${tenantUpload.body.id}`)).status).toBe(404);
  });

  it('tenant isolation: another org cannot list, read or upload against this owner', async () => {
    const b = await asUser(fx.managers.b);
    expect((await b.get(`/media?ownerType=work_order&ownerId=${workOrderId}`)).status).toBe(404);
    const asset = await prisma.mediaAsset.findFirst({ where: { tenantOrgId: fx.a.id } });
    expect((await b.get(`/media/${asset!.id}`)).status).toBe(404);
    expect((await b.delete(`/media/${asset!.id}`)).status).toBe(404);
    expect((await b.post('/media').send({ ownerType: 'work_order', ownerId: workOrderId, fileName: 'x.png', mimeType: 'image/png', contentBase64: PNG.toString('base64') })).status).toBe(400);
  });
});
