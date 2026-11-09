import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { prisma } from '@bolar/db';
import { MockPaymentProvider } from '@bolar/integrations';
import { drainMemoryQueue } from '../shared/queue.js';
import { asUser, testApp } from './helpers.js';
import { financeFixture, monthStart, periodOf } from './finance.fixture.js';

/** Days 39-40: payment adapter path, idempotency, partial/failed payments, refunds with approval gate, duplicate webhooks, bank data gate. */
describe('finance: payments, webhooks, refunds and bank links', () => {
  let fx: Awaited<ReturnType<typeof financeFixture>>;
  let invoiceId: string;
  const provider = new MockPaymentProvider();
  beforeAll(async () => {
    fx = await financeFixture();
    const b = await asUser(fx.books.a);
    await b.post('/accounts/seed-default');
    const gen = await b.post('/invoices/generate').send({ period: periodOf(monthStart(1)) });
    invoiceId = gen.body.invoiceIds[0];
    drainMemoryQueue();
  });

  it('requires an Idempotency-Key and replays the same payment; partial payment allocates and posts Cash/AR once', async () => {
    const t = await asUser(fx.tenants.a);
    expect((await t.post('/payments').send({ invoiceId, amountCents: 50000, method: 'card', paymentMethodRef: 'pm_mock_visa' })).status).toBe(400);
    const key = 'tenant-pay-0001-abc';
    const first = await t.post('/payments').set('Idempotency-Key', key).send({ invoiceId, amountCents: 50000, method: 'card', paymentMethodRef: 'pm_mock_visa' });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'succeeded', amountCents: 50000, externalId: null, invoice: { status: 'partially_paid', paidCents: 50000 } });
    expect(first.body.events[0].externalEventId).toBe('[redacted]');
    const replay = await t.post('/payments').set('Idempotency-Key', key).send({ invoiceId, amountCents: 50000, method: 'card', paymentMethodRef: 'pm_mock_visa' });
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
    expect(await prisma.payment.count({ where: { invoiceId } })).toBe(1);
    expect(await prisma.journalEntry.count({ where: { sourceType: 'payment', sourceId: first.body.id } })).toBe(1);
    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { idempotencyKey: `payment:${first.body.id}:succeeded` }, include: { lines: { include: { account: true } } } });
    expect(je.lines.find((l) => l.account.code === '1000')?.debitCents).toBe(50000);
    expect(je.lines.find((l) => l.account.code === '1100')?.creditCents).toBe(50000);
    expect(drainMemoryQueue('domain-events').some((j) => j.data.name === 'payment.succeeded')).toBe(true);
    // changing the payload under the same key is an idempotency conflict
    expect((await t.post('/payments').set('Idempotency-Key', key).send({ invoiceId, amountCents: 1, method: 'card', paymentMethodRef: 'pm_mock_visa' })).status).toBe(409);
    // over-payment is rejected
    expect((await t.post('/payments').set('Idempotency-Key', 'tenant-pay-0002-abc').send({ invoiceId, amountCents: 100001, method: 'card', paymentMethodRef: 'pm_mock_visa' })).status).toBe(400);
  });

  it('failed payment is recorded with its reason, leaves the invoice untouched and publishes payment.failed', async () => {
    const t = await asUser(fx.tenants.a);
    const failed = await t.post('/payments').set('Idempotency-Key', 'tenant-pay-fail-0001').send({ invoiceId, amountCents: 9999, method: 'card', paymentMethodRef: 'pm_mock_declined' });
    expect(failed.status).toBe(201);
    expect(failed.body).toMatchObject({ status: 'failed', failureReason: 'card_declined', invoice: { paidCents: 50000, status: 'partially_paid' } });
    expect(await prisma.journalEntry.count({ where: { sourceType: 'payment', sourceId: failed.body.id } })).toBe(0);
    expect(drainMemoryQueue('domain-events').some((j) => j.data.name === 'payment.failed')).toBe(true);
    const list = await t.get('/payments?status=failed');
    expect(list.body.items.map((p: { id: string }) => p.id)).toEqual([failed.body.id]);
  });

  it('tenants cannot pay or read invoices they are not party to (404 + access.denied audit)', async () => {
    const s = await asUser(fx.strangerTenant);
    const res = await s.post('/payments').set('Idempotency-Key', 'stranger-pay-0001').send({ invoiceId, amountCents: 100, method: 'card', paymentMethodRef: 'pm_mock_visa' });
    expect(res.status).toBe(404);
    expect(await prisma.auditLog.count({ where: { actorId: fx.strangerTenant.id, action: 'access.denied', resourceId: invoiceId } })).toBe(1);
    expect((await s.get('/payments')).body.items).toHaveLength(0);
    const tB = await asUser(fx.tenants.b);
    expect((await tB.post('/payments').set('Idempotency-Key', 'beta-pay-0001-abc').send({ invoiceId, amountCents: 100, method: 'card', paymentMethodRef: 'pm' })).status).toBe(404);
    const payA = await prisma.payment.findFirstOrThrow({ where: { invoiceId, status: 'succeeded' } });
    expect((await tB.get(`/payments/${payA.id}`)).status).toBe(404);
    // landlord may read payments of their property but holds no bank data
    const l = await asUser(fx.landlord);
    const seen = await l.get(`/payments/${payA.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.externalId).toBeNull();
    // bookkeeper holds bank:read and sees the provider reference
    const b = await asUser(fx.books.a);
    expect((await b.get(`/payments/${payA.id}`)).body.externalId).toMatch(/^pi_mock_/);
  });

  it('pending payment converges through the webhook; duplicate delivery yields exactly one journal entry', async () => {
    const t = await asUser(fx.tenants.a);
    const pending = await t.post('/payments').set('Idempotency-Key', 'tenant-pay-pend-0001').send({ invoiceId, amountCents: 20098, method: 'ach', paymentMethodRef: 'ba_mock_checking' });
    expect(pending.status).toBe(201);
    expect(pending.body.status).toBe('pending');
    expect(await prisma.journalEntry.count({ where: { sourceType: 'payment', sourceId: pending.body.id } })).toBe(0);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: pending.body.id } });
    const evt = await provider.signedWebhook({ id: 'evt_pend_0001', type: 'payment_intent.succeeded', data: { object: { id: row.externalId, amount: 20098, status: 'succeeded' } } });
    const post = () => request(testApp()).post('/webhooks/stripe').set('Content-Type', 'application/json').set(evt.headers).send(evt.body);
    const first = await post();
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe('processed');
    const dup = await post();
    expect(dup.body.outcome).toBe('duplicate');
    // a re-sent event with a new id for the same intent is acknowledged but not re-applied
    const again = await provider.signedWebhook({ id: 'evt_pend_0002', type: 'payment_intent.succeeded', data: { object: { id: row.externalId, amount: 20098, status: 'succeeded' } } });
    const third = await request(testApp()).post('/webhooks/stripe').set('Content-Type', 'application/json').set(again.headers).send(again.body);
    expect(third.body.outcome).toBe('ignored');
    expect(await prisma.journalEntry.count({ where: { sourceType: 'payment', sourceId: pending.body.id } })).toBe(1);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(inv).toMatchObject({ paidCents: 70098, status: 'partially_paid' });
    expect(await prisma.paymentEvent.count({ where: { paymentId: pending.body.id } })).toBe(3); // sync pending + 2 webhook ids
    // bad signature and unknown intent
    expect((await request(testApp()).post('/webhooks/stripe').set('Content-Type', 'application/json').set('stripe-signature', 'nope').send(evt.body)).status).toBe(400);
    const unknown = await provider.signedWebhook({ id: 'evt_unknown_0001', type: 'payment_intent.succeeded', data: { object: { id: 'pi_nobody' } } });
    expect((await request(testApp()).post('/webhooks/stripe').set('Content-Type', 'application/json').set(unknown.headers).send(unknown.body)).body.outcome).toBe('ignored');
    // failed webhook on an already succeeded payment is ignored (status idempotency)
    const lateFail = await provider.signedWebhook({ id: 'evt_pend_fail', type: 'payment_intent.payment_failed', data: { object: { id: row.externalId, last_payment_error: { message: 'late' } } } });
    expect((await request(testApp()).post('/webhooks/stripe').set('Content-Type', 'application/json').set(lateFail.headers).send(lateFail.body)).body.outcome).toBe('ignored');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pending.body.id } })).status).toBe('succeeded');
  });

  it('refund is approval-gated: bookkeeper denied, recorder cannot approve own, approver reverses the journal and reopens the invoice', async () => {
    const b = await asUser(fx.books.a);
    const admin = await asUser(fx.admins.a);
    // staff-recorded payment that pays the invoice off
    const staffPay = await admin.post('/payments').set('Idempotency-Key', 'staff-pay-0001-abc').send({ invoiceId, amountCents: 79902, method: 'check', paymentMethodRef: 'check-1042' });
    expect(staffPay.status).toBe(201);
    expect(staffPay.body.invoice.status).toBe('paid');
    expect((await b.post(`/payments/${staffPay.body.id}/refund`).send({ amountCents: 79902, reason: 'duplicate check' })).status).toBe(403);
    expect((await admin.post(`/payments/${staffPay.body.id}/refund`).send({ amountCents: 79902, reason: 'duplicate check' })).status).toBe(409);
    // admin refunds the tenant's card payment (recorded by the tenant)
    const tenantPay = await prisma.payment.findFirstOrThrow({ where: { invoiceId, status: 'succeeded', amountCents: 50000 } });
    expect((await admin.post(`/payments/${tenantPay.id}/refund`).send({ amountCents: 60000, reason: 'too much' })).status).toBe(400);
    const refund = await admin.post(`/payments/${tenantPay.id}/refund`).send({ amountCents: 50000, reason: 'tenant paid twice' });
    expect(refund.status).toBe(200);
    expect(refund.body).toMatchObject({ status: 'refunded', invoice: { paidCents: 100000, status: 'partially_paid' } });
    const reversal = await prisma.journalEntry.findFirst({ where: { tenantOrgId: fx.a.id, sourceType: 'reversal', idempotencyKey: { startsWith: 'reversal:' }, reversalOfId: { not: null } }, include: { lines: { include: { account: true } } } });
    expect(reversal).not.toBeNull();
    expect(reversal!.lines.find((l) => l.account.code === '1000')?.creditCents).toBe(50000);
    expect((await admin.post(`/payments/${tenantPay.id}/refund`).send({ amountCents: 50000, reason: 'again' })).status).toBe(409);
    expect(await prisma.paymentEvent.count({ where: { paymentId: tenantPay.id, type: 'charge.refunded' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'payment.refund', resourceId: tenantPay.id } })).toBe(1);
    // tenant cannot refund
    const t = await asUser(fx.tenants.a);
    expect((await t.post(`/payments/${staffPay.body.id}/refund`).send({ amountCents: 1, reason: 'please' })).status).toBe(403);
    // ledger still balanced after the full fixture run
    const proof = await b.get('/ledger/proof');
    expect(proof.body).toMatchObject({ balanced: true, unbalancedEntries: 0 });
    const tb = await b.get('/ledger/trial-balance');
    expect(tb.body.balanced).toBe(true);
    expect(tb.body.rows.find((r: { code: string }) => r.code === '1000').balanceCents).toBe(100000);
    expect(tb.body.rows.find((r: { code: string }) => r.code === '1100').balanceCents).toBe(50000);
    const summary = await b.get('/finance/summary');
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ openArCents: 50000, openInvoices: 1, trialBalanced: true, paymentsMode: 'mock', failedPayments30d: 1 });
    expect(summary.body.collectedThisMonthCents).toBe(150000);
  });

  it('bank links require bank:read; the exchange never returns or persists a raw token', async () => {
    const t = await asUser(fx.tenants.a);
    expect((await t.post('/bank-links/link-token').send({})).status).toBe(403);
    const b = await asUser(fx.books.a);
    const token = await b.post('/bank-links/link-token').send({ products: ['auth'] });
    expect(token.status).toBe(201);
    expect(token.body).toMatchObject({ mode: 'mock' });
    expect(token.body.linkToken).toMatch(/^link-mock-/);
    const ex = await b.post('/bank-links/exchange').send({ publicToken: 'public-mock-token' });
    expect(ex.status).toBe(200);
    expect(ex.body).toMatchObject({ persisted: false, accountMask: '0000', institution: 'Mock Bank' });
    expect(JSON.stringify(ex.body)).not.toMatch(/access_token|accessToken"/);
    expect(await prisma.auditLog.count({ where: { tenantOrgId: fx.a.id, action: { in: ['bank_link.token', 'bank_link.exchange'] } } })).toBe(2);
  });
});
