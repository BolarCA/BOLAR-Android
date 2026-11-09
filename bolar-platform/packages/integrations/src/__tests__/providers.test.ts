import { describe, it, expect } from 'vitest';
import { MockPaymentProvider, MockSignatureProvider, MockScreeningProvider, MockIdentityVerificationProvider, createPaymentProvider, createSignatureProvider, createScreeningProvider, createIdentityVerificationProvider, createBankLinkProvider, processWebhook, type WebhookEvent } from '../index.js';

const ctx = { requestId: 'r1', tenantOrgId: 'org', actorId: 'u1', idempotencyKey: 'k1' };

describe('provider contract tests (Day 56)', () => {
  it('factories return mock providers by default and refuse production outside production', () => {
    expect(createPaymentProvider({}).mode).toBe('mock');
    expect(createBankLinkProvider({}).mode).toBe('mock');
    expect(createSignatureProvider({}).mode).toBe('mock');
    expect(createScreeningProvider({}).mode).toBe('mock');
    expect(createIdentityVerificationProvider({}).mode).toBe('mock');
    expect(() => createPaymentProvider({ STRIPE_MODE: 'production', NODE_ENV: 'test' })).toThrow(/production/);
  });
  it('sandbox providers validate configuration before any call', async () => {
    await expect(createPaymentProvider({ STRIPE_MODE: 'sandbox' }).validateConfig()).rejects.toThrow(/missing configuration/);
    await expect(createSignatureProvider({ DOCUSIGN_MODE: 'sandbox' }).validateConfig()).rejects.toThrow(/missing configuration/);
    await expect(createScreeningProvider({ TRANSUNION_MODE: 'sandbox' }).validateConfig()).rejects.toThrow(/missing configuration/);
    await expect(createPaymentProvider({ STRIPE_MODE: 'sandbox', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'w' }).validateConfig()).rejects.toThrow(/test key/);
  });
  it('mock payments are deterministic and idempotency-key aware', async () => {
    const p = new MockPaymentProvider();
    expect((await p.execute({ amountCents: 145000, currency: 'usd', customerRef: 'c', paymentMethodRef: 'pm', description: 'rent', metadata: {} }, ctx)).status).toBe('succeeded');
    expect((await p.execute({ amountCents: 10099, currency: 'usd', customerRef: 'c', paymentMethodRef: 'pm', description: 'rent', metadata: {} }, ctx)).status).toBe('failed');
    expect((await p.execute({ amountCents: 10098, currency: 'usd', customerRef: 'c', paymentMethodRef: 'pm', description: 'rent', metadata: {} }, ctx)).status).toBe('pending');
    const a = await p.execute({ amountCents: 100, currency: 'usd', customerRef: 'c', paymentMethodRef: 'pm', description: 'rent', metadata: {} }, ctx);
    expect(a.externalId).toContain('k1');
  });
  it('webhooks: signature verified, duplicates ignored, handler runs once', async () => {
    const p = new MockPaymentProvider();
    const { headers, body } = await p.signedWebhook({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });
    const ok = await p.verifyWebhook(headers, body);
    expect(ok.signatureOk).toBe(true);
    const bad = await p.verifyWebhook({ 'stripe-signature': 'nope' }, body);
    expect(bad.signatureOk).toBe(false);
    const seen = new Set<string>();
    const store = { recordOnce: async (e: WebhookEvent) => { if (seen.has(e.externalId)) return false; seen.add(e.externalId); return true; }, markProcessed: async () => {} };
    let runs = 0;
    const handler = async () => { runs++; return 'processed' as const; };
    expect(await processWebhook(bad, store, handler)).toBe('rejected_signature');
    expect(await processWebhook(ok, store, handler)).toBe('processed');
    expect(await processWebhook(ok, store, handler)).toBe('duplicate');
    expect(runs).toBe(1);
  });
  it('e-sign mock tracks envelope lifecycle via signed webhooks', async () => {
    const s = new MockSignatureProvider();
    const env = await s.execute({ documentName: 'lease.pdf', documentBase64: 'JVBERi0=', recipients: [{ name: 'T', email: 't@x.test', role: 'tenant' }], metadata: { leaseId: 'l1' } }, ctx);
    expect(await s.getStatus(env.externalId, ctx)).toBe('sent');
    const wh = await s.signedWebhook(env.externalId, 'envelope-completed');
    const ev = await s.verifyWebhook(wh.headers, wh.body);
    expect(ev.signatureOk).toBe(true);
    expect(ev.type).toBe('envelope-completed');
    expect(await s.getStatus(env.externalId, ctx)).toBe('completed');
  });
  it('screening mock requires consent and never returns a report without it', async () => {
    const s = new MockScreeningProvider();
    const base = { applicantRef: 'a1', consentDocumentId: 'd1', products: ['credit' as const], applicant: { firstName: 'A', lastName: 'Zed', dateOfBirth: '1990-01-01', address: { line1: '1', city: 'Austin', state: 'TX', postalCode: '78701' } } };
    await expect(s.execute({ ...base, consentAt: '' }, ctx)).rejects.toThrow(/consent/);
    const r = await s.execute({ ...base, consentAt: new Date().toISOString() }, ctx);
    expect(r.summary?.recommendation).toBe('decline');
    expect(r.reportPdf?.length).toBeGreaterThan(0);
  });
  it('identity verification mock resolves verified/failed deterministically', async () => {
    const i = new MockIdentityVerificationProvider();
    const a = await i.execute({ subjectRef: 's1', redirectUrl: 'http://x', level: 'basic' }, ctx);
    expect((await i.getResult(a.externalId, ctx)).status).toBe('verified');
    const b = await i.execute({ subjectRef: 's2-fail', redirectUrl: 'http://x', level: 'nist_ial2' }, ctx);
    expect((await i.getResult(b.externalId, ctx)).status).toBe('failed');
  });
});
