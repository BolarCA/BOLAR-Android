import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { twoTenantFixture, createUser, createUnit, type UserFixture } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { MockSignatureProvider } from '@bolar/integrations';
import { asUser, testApp } from './helpers.js';
import { signatureProvider } from '../modules/signature/routes.js';

type Api = Awaited<ReturnType<typeof asUser>>;

describe('signature: envelopes linked to lease versions and idempotent DocuSign webhooks (Day 57)', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let landlord: UserFixture;
  let tenantUser: UserFixture;
  let unit: { id: string };
  let profileId: string;
  let m: Api;
  let l: Api;
  const mock = signatureProvider as MockSignatureProvider;

  beforeAll(async () => {
    fx = await twoTenantFixture();
    landlord = await createUser(fx.a, 'landlord');
    tenantUser = await createUser(fx.a, 'tenant');
    unit = await createUnit(fx.a, fx.propA.id, '301');
    m = await asUser(fx.managers.a);
    l = await asUser(landlord);
    profileId = (await m.post('/tenant-profiles').send({ displayName: 'Sig Signer', email: 'sig.signer@alpha.test', userId: tenantUser.id })).body.id;
    expect(mock).toBeInstanceOf(MockSignatureProvider);
  });

  async function approvedLease(start: string, end: string, withTerms = true) {
    const res = await m.post('/leases').send({ propertyId: fx.propA.id, unitId: unit.id, startDate: start, endDate: end, rentCents: 100000, tenantProfileId: profileId, ...(withTerms ? { termsJson: { term: '12 months' } } : {}) });
    expect(res.status).toBe(201);
    expect((await m.post(`/leases/${res.body.id}/transition`).send({ to: 'review' })).status).toBe(200);
    expect((await l.post(`/leases/${res.body.id}/transition`).send({ to: 'approved' })).status).toBe(200);
    return res.body.id as string;
  }
  async function webhook(envelopeId: string, event: Parameters<MockSignatureProvider['signedWebhook']>[1]) {
    const { headers, body } = await mock.signedWebhook(envelopeId, event);
    return request(testApp()).post('/webhooks/docusign').set('Content-Type', 'application/json').set(headers).send(body);
  }

  it('creating an envelope links the current version, records recipients, and moves the lease to sent', async () => {
    const leaseId = await approvedLease('2031-01-01', '2031-12-31');
    const env = await m.post(`/leases/${leaseId}/envelopes`).send({});
    expect(env.status).toBe(201);
    expect(env.body).toMatchObject({ provider: 'docusign', status: 'sent', leaseId });
    expect(env.body.externalId).toMatch(/^env_mock_/);
    expect(env.body.leaseVersionId).toBeTruthy();
    expect(env.body.recipients[0]).toMatchObject({ name: 'Sig Signer', email: 'sig.signer@alpha.test', role: 'primary' });
    const lease = await m.get(`/leases/${leaseId}`);
    expect(lease.body.status).toBe('sent');
    expect(env.body.leaseVersionId).toBe(lease.body.currentVersionId);
    expect(mock.log.calls.at(-1)!.input).toMatchObject({ documentName: expect.stringContaining('v1.pdf') });
    expect(Buffer.from((mock.log.calls.at(-1)!.input as { documentBase64: string }).documentBase64, 'base64').toString('utf8')).toContain('%PDF-1.4');
    // a second envelope while one is open is refused; the list shows the open one
    expect((await m.post(`/leases/${leaseId}/envelopes`).send({})).status).toBe(409);
    const list = await m.get(`/leases/${leaseId}/envelopes`);
    expect(list.body.items).toHaveLength(1);
    expect(await prisma.auditLog.findFirst({ where: { action: 'signature.envelope.create', resourceId: leaseId } })).not.toBeNull();
  });

  it('envelope-completed webhook signs the lease exactly once; replays and late events are idempotent', async () => {
    const lease = (await m.get('/leases?status=sent')).body.items[0];
    const env = (await m.get(`/leases/${lease.id}/envelopes`)).body.items[0];
    const bad = await request(testApp()).post('/webhooks/docusign').set('Content-Type', 'application/json').set('x-docusign-signature-1', 'nope').send(JSON.stringify({ event: 'envelope-completed', data: { envelopeId: env.externalId } }));
    expect(bad.status).toBe(400);
    const delivered = await webhook(env.externalId, 'envelope-delivered');
    expect(delivered.body.outcome).toBe('processed');
    expect((await m.get(`/leases/${lease.id}/envelopes`)).body.items[0].status).toBe('delivered');

    const completed = await webhook(env.externalId, 'envelope-completed');
    expect(completed.status).toBe(200);
    expect(completed.body.outcome).toBe('processed');
    const signed = await m.get(`/leases/${lease.id}`);
    expect(signed.body.status).toBe('signed');
    expect(signed.body.parties[0].signedAt).not.toBeNull();
    const envAfter = (await m.get(`/leases/${lease.id}/envelopes`)).body.items[0];
    expect(envAfter.status).toBe('completed');
    expect(envAfter.lastEventId).toContain('envelope-completed');

    // exact replay -> duplicate, no second transition; late "delivered" never regresses the terminal status
    expect((await webhook(env.externalId, 'envelope-completed')).body.outcome).toBe('duplicate');
    const { headers, body } = await mock.signedWebhook(env.externalId, 'envelope-delivered');
    const late = await request(testApp()).post('/webhooks/docusign').set('Content-Type', 'application/json').set(headers).send(body);
    expect(late.body.outcome).toBe('duplicate');
    expect((await m.get(`/leases/${lease.id}/envelopes`)).body.items[0].status).toBe('completed');
    const transitions = await prisma.auditLog.findMany({ where: { action: 'lease.transition', resourceId: lease.id } });
    expect(transitions.filter((t) => (t.after as { status: string }).status === 'signed')).toHaveLength(1);
    expect(transitions.find((t) => (t.after as { status: string }).status === 'signed')!.actorId).toBeNull();
    expect(await prisma.webhookEvent.count({ where: { provider: 'docusign' } })).toBeGreaterThanOrEqual(2);
    expect((await m.post(`/leases/${lease.id}/transition`).send({ to: 'active', activate: true })).status).toBe(200);
  });

  it('voiding an open envelope reopens a sent lease as draft with the reason in the audit note', async () => {
    const leaseId = await approvedLease('2033-01-01', '2033-12-31');
    const env = await m.post(`/leases/${leaseId}/envelopes`).send({});
    expect(env.status).toBe(201);
    expect((await m.post(`/envelopes/${env.body.id}/void`).send({ reason: 'x' })).status).toBe(400);
    const voided = await m.post(`/envelopes/${env.body.id}/void`).send({ reason: 'Wrong deposit amount on page 2.' });
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe('voided');
    expect(await mock.getStatus(env.body.externalId)).toBe('voided');
    const lease = await m.get(`/leases/${leaseId}`);
    expect(lease.body.status).toBe('draft');
    const reopen = await prisma.auditLog.findFirst({ where: { action: 'lease.transition', resourceId: leaseId, metadata: { path: ['to'], equals: 'draft' } } });
    expect((reopen!.metadata as { note: string }).note).toContain('Wrong deposit amount');
    expect((await m.post(`/envelopes/${env.body.id}/void`).send({ reason: 'again please' })).status).toBe(409);
    // after fixing the draft the lease can be re-approved and sent with a fresh envelope
    expect((await m.post(`/leases/${leaseId}/transition`).send({ to: 'review' })).status).toBe(200);
    expect((await l.post(`/leases/${leaseId}/transition`).send({ to: 'approved' })).status).toBe(200);
    const again = await m.post(`/leases/${leaseId}/envelopes`).send({});
    expect(again.status).toBe(201);
    expect((await m.get(`/leases/${leaseId}/envelopes`)).body.items).toHaveLength(2);
    expect((await m.post(`/leases/${leaseId}/transition`).send({ to: 'canceled' })).status).toBe(200);
  });

  it('declined webhook rolls the lease back to draft; unknown envelopes are ignored', async () => {
    const leaseId = await approvedLease('2035-01-01', '2035-12-31');
    const env = await m.post(`/leases/${leaseId}/envelopes`).send({});
    const declined = await webhook(env.body.externalId, 'envelope-declined');
    expect(declined.body.outcome).toBe('processed');
    expect((await m.get(`/leases/${leaseId}`)).body.status).toBe('draft');
    expect((await m.get(`/leases/${leaseId}/envelopes`)).body.items[0].status).toBe('declined');
    const unknown = await webhook('env_mock_does_not_exist', 'envelope-completed');
    expect(unknown.body.outcome).toBe('ignored');
    expect((await m.post(`/leases/${leaseId}/transition`).send({ to: 'canceled' })).status).toBe(200);
  });

  it('permissions: landlord cannot send, tenant party can list envelopes but not create, org B is isolated, sending needs terms', async () => {
    const leaseId = await approvedLease('2037-01-01', '2037-12-31');
    expect((await l.post(`/leases/${leaseId}/envelopes`).send({})).status).toBe(403);
    const t = await asUser(tenantUser);
    expect((await t.get(`/leases/${leaseId}/envelopes`)).status).toBe(200);
    expect((await t.post(`/leases/${leaseId}/envelopes`).send({})).status).toBe(403);
    const b = await asUser(fx.managers.b);
    expect((await b.post(`/leases/${leaseId}/envelopes`).send({})).status).toBe(404);
    expect((await b.get(`/leases/${leaseId}/envelopes`)).status).toBe(404);
    const noTerms = await m.post('/leases').send({ propertyId: fx.propA.id, unitId: unit.id, startDate: '2039-01-01', endDate: '2039-12-31', rentCents: 100000, tenantProfileId: profileId });
    expect((await m.post(`/leases/${noTerms.body.id}/envelopes`).send({})).status).toBe(409);
    const draftEnv = await m.post(`/leases/${leaseId}/envelopes`).send({});
    expect(draftEnv.status).toBe(201);
    const envOfOther = await b.post(`/envelopes/${draftEnv.body.id}/void`).send({ reason: 'cross tenant attempt' });
    expect(envOfOther.status).toBe(404);
  });
});
