import { randomUUID } from 'node:crypto';
import { CallLog, modeFromEnv, requireEnv, verifyHmacSignature, type AdapterMode, type AdapterRequestContext, type ProviderAdapter, type WebhookEvent } from '../adapter.js';

// ───────── Payment provider (Stripe boundary, Day 39) ─────────
export interface ChargeRequest { amountCents: number; currency: 'usd'; customerRef: string; paymentMethodRef: string; description: string; metadata: Record<string, string> }
export interface ChargeResult { externalId: string; status: 'pending' | 'succeeded' | 'failed'; failureReason?: string }
export interface RefundRequest { externalId: string; amountCents: number; reason: string }
export interface RefundResult { externalId: string; status: 'pending' | 'succeeded' | 'failed' }

export interface PaymentProvider extends ProviderAdapter<ChargeRequest, ChargeResult> {
  refund(input: RefundRequest, ctx: AdapterRequestContext): Promise<RefundResult>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, body: string): Promise<WebhookEvent>;
}

/** Mock Stripe: deterministic outcomes by amount (amounts ending in 99 fail; 98 stay pending), synthetic webhooks via `emitWebhook`. */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  readonly mode: AdapterMode = 'mock';
  readonly log = new CallLog<ChargeRequest | RefundRequest>();
  private readonly secret = 'whsec_mock';
  async validateConfig() {}
  async execute(input: ChargeRequest, ctx: AdapterRequestContext): Promise<ChargeResult> {
    this.log.record(input, ctx);
    const tail = input.amountCents % 100;
    const externalId = `pi_mock_${ctx.idempotencyKey ?? randomUUID()}`;
    if (tail === 99) return { externalId, status: 'failed', failureReason: 'card_declined' };
    if (tail === 98) return { externalId, status: 'pending' };
    return { externalId, status: 'succeeded' };
  }
  async refund(input: RefundRequest, ctx: AdapterRequestContext): Promise<RefundResult> {
    this.log.record(input, ctx);
    return { externalId: `re_mock_${randomUUID()}`, status: 'succeeded' };
  }
  async verifyWebhook(headers: Record<string, string | string[] | undefined>, body: string): Promise<WebhookEvent> {
    const sig = String(headers['stripe-signature'] ?? '');
    const signatureOk = await verifyHmacSignature(this.secret, body, sig);
    const parsed = JSON.parse(body) as { id: string; type: string; data: unknown };
    return { provider: 'stripe', externalId: parsed.id, type: parsed.type, payload: parsed.data, signatureOk, receivedAt: new Date().toISOString() };
  }
  /** Build a signed synthetic webhook for tests. */
  async signedWebhook(event: { id: string; type: string; data: unknown }): Promise<{ headers: Record<string, string>; body: string }> {
    const { createHmac } = await import('node:crypto');
    const body = JSON.stringify(event);
    return { headers: { 'stripe-signature': createHmac('sha256', this.secret).update(body).digest('hex') }, body };
  }
}

/** Stripe sandbox/production boundary: validates keys and calls the REST API; webhook signatures verified with STRIPE_WEBHOOK_SECRET. */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe';
  readonly mode: AdapterMode;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) { this.mode = modeFromEnv('STRIPE_MODE', env); }
  async validateConfig() {
    requireEnv(this.name, this.env, ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);
    if (this.mode === 'sandbox' && !this.env.STRIPE_SECRET_KEY!.startsWith('sk_test_')) throw new Error('[stripe] sandbox mode requires a test key');
  }
  private async call(path: string, form: Record<string, string>, idempotencyKey?: string) {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${this.env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, body: new URLSearchParams(form) });
    return (await res.json()) as { id: string; status: string; error?: { message: string } };
  }
  async execute(input: ChargeRequest, ctx: AdapterRequestContext): Promise<ChargeResult> {
    const r = await this.call('payment_intents', { amount: String(input.amountCents), currency: input.currency, customer: input.customerRef, payment_method: input.paymentMethodRef, confirm: 'true', description: input.description, ...Object.fromEntries(Object.entries(input.metadata).map(([k, v]) => [`metadata[${k}]`, v])) }, ctx.idempotencyKey);
    if (r.error) return { externalId: r.id ?? `err_${Date.now()}`, status: 'failed', failureReason: r.error.message };
    return { externalId: r.id, status: r.status === 'succeeded' ? 'succeeded' : r.status === 'canceled' ? 'failed' : 'pending' };
  }
  async refund(input: RefundRequest, ctx: AdapterRequestContext): Promise<RefundResult> {
    const r = await this.call('refunds', { payment_intent: input.externalId, amount: String(input.amountCents), reason: 'requested_by_customer' }, ctx.idempotencyKey);
    return { externalId: r.id, status: r.error ? 'failed' : r.status === 'succeeded' ? 'succeeded' : 'pending' };
  }
  async verifyWebhook(headers: Record<string, string | string[] | undefined>, body: string): Promise<WebhookEvent> {
    // Stripe-Signature: t=timestamp,v1=signature ; signed payload is `${t}.${body}`
    const header = String(headers['stripe-signature'] ?? '');
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const signatureOk = parts.t && parts.v1 ? await verifyHmacSignature(this.env.STRIPE_WEBHOOK_SECRET!, `${parts.t}.${body}`, parts.v1) : false;
    const parsed = JSON.parse(body) as { id: string; type: string; data: unknown };
    return { provider: 'stripe', externalId: parsed.id, type: parsed.type, payload: parsed.data, signatureOk, receivedAt: new Date().toISOString() };
  }
}

export function createPaymentProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  return modeFromEnv('STRIPE_MODE', env) === 'mock' ? new MockPaymentProvider() : new StripePaymentProvider(env);
}

// ───────── Bank link provider (Plaid boundary) ─────────
export interface LinkTokenRequest { userRef: string; products: ('auth' | 'transactions')[] }
export interface LinkTokenResult { linkToken: string; expiresAt: string }
export interface ExchangeRequest { publicToken: string }
export interface ExchangeResult { accessTokenRef: string; accountMask: string; institution: string }

export interface BankLinkProvider extends ProviderAdapter<LinkTokenRequest, LinkTokenResult> {
  exchange(input: ExchangeRequest, ctx: AdapterRequestContext): Promise<ExchangeResult>;
}

export class MockBankLinkProvider implements BankLinkProvider {
  readonly name = 'plaid';
  readonly mode: AdapterMode = 'mock';
  readonly log = new CallLog<LinkTokenRequest | ExchangeRequest>();
  async validateConfig() {}
  async execute(input: LinkTokenRequest, ctx: AdapterRequestContext) { this.log.record(input, ctx); return { linkToken: `link-mock-${randomUUID()}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString() }; }
  async exchange(input: ExchangeRequest, ctx: AdapterRequestContext) { this.log.record(input, ctx); return { accessTokenRef: `ref_${randomUUID()}`, accountMask: '0000', institution: 'Mock Bank' }; }
}

export class PlaidBankLinkProvider implements BankLinkProvider {
  readonly name = 'plaid';
  readonly mode: AdapterMode;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) { this.mode = modeFromEnv('PLAID_MODE', env); }
  private get host() { return this.mode === 'production' ? 'https://production.plaid.com' : 'https://sandbox.plaid.com'; }
  async validateConfig() { requireEnv(this.name, this.env, ['PLAID_CLIENT_ID', 'PLAID_SECRET']); }
  private async call<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.host}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: this.env.PLAID_CLIENT_ID, secret: this.env.PLAID_SECRET, ...body }) });
    return (await res.json()) as T;
  }
  async execute(input: LinkTokenRequest): Promise<LinkTokenResult> {
    const r = await this.call<{ link_token: string; expiration: string }>('/link/token/create', { user: { client_user_id: input.userRef }, client_name: 'BOLAR', products: input.products, country_codes: ['US'], language: 'en' });
    return { linkToken: r.link_token, expiresAt: r.expiration };
  }
  async exchange(input: ExchangeRequest): Promise<ExchangeResult> {
    const r = await this.call<{ access_token: string; item_id: string }>('/item/public_token/exchange', { public_token: input.publicToken });
    // The access token itself is a secret; callers persist only an opaque reference and store the token in the secret manager.
    return { accessTokenRef: r.item_id, accountMask: '****', institution: 'unknown' };
  }
}

export function createBankLinkProvider(env: NodeJS.ProcessEnv = process.env): BankLinkProvider {
  return modeFromEnv('PLAID_MODE', env) === 'mock' ? new MockBankLinkProvider() : new PlaidBankLinkProvider(env);
}
