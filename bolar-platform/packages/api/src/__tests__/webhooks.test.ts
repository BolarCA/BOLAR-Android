import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { MockPaymentProvider } from '@bolar/integrations';
import { resetDatabase } from '@bolar/testing';
import { testApp } from './helpers.js';
import { registerWebhookProvider, onWebhook } from '../modules/integrations/routes.js';

describe('generic webhook dispatcher', () => {
  const provider = new MockPaymentProvider();
  let handled = 0;
  beforeAll(async () => {
    await resetDatabase();
    registerWebhookProvider('mockpay', (h, b) => provider.verifyWebhook(h, b));
    onWebhook('mockpay', async () => { handled++; return 'processed'; });
  });
  it('rejects bad signatures, processes once, acknowledges duplicates, 404s unknown providers', async () => {
    const { headers, body } = await provider.signedWebhook({ id: 'evt_42', type: 'payment_intent.succeeded', data: {} });
    const bad = await request(testApp()).post('/webhooks/mockpay').set('Content-Type', 'application/json').set('stripe-signature', 'x').send(body);
    expect(bad.status).toBe(400);
    const ok = await request(testApp()).post('/webhooks/mockpay').set('Content-Type', 'application/json').set(headers).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.outcome).toBe('processed');
    const dup = await request(testApp()).post('/webhooks/mockpay').set('Content-Type', 'application/json').set(headers).send(body);
    expect(dup.body.outcome).toBe('duplicate');
    expect(handled).toBe(1);
    expect((await request(testApp()).post('/webhooks/nobody').send('{}')).status).toBe(404);
  });
});
