import { randomUUID } from 'node:crypto';
import { CallLog, modeFromEnv, requireEnv, verifyHmacSignature, type AdapterMode, type AdapterRequestContext, type ProviderAdapter, type WebhookEvent } from '../adapter.js';

// ───────── E-signature provider (DocuSign boundary, Day 57) ─────────
export interface EnvelopeRequest { documentName: string; documentBase64: string; recipients: { name: string; email: string; role: string }[]; metadata: Record<string, string> }
export interface EnvelopeResult { externalId: string; status: 'created' | 'sent' }
export type EnvelopeStatus = 'created' | 'sent' | 'delivered' | 'completed' | 'declined' | 'voided';

export interface SignatureProvider extends ProviderAdapter<EnvelopeRequest, EnvelopeResult> {
  getStatus(externalId: string, ctx: AdapterRequestContext): Promise<EnvelopeStatus>;
  void(externalId: string, reason: string, ctx: AdapterRequestContext): Promise<void>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, body: string): Promise<WebhookEvent>;
}

export class MockSignatureProvider implements SignatureProvider {
  readonly name = 'docusign';
  readonly mode: AdapterMode = 'mock';
  readonly log = new CallLog<EnvelopeRequest | string>();
  readonly statuses = new Map<string, EnvelopeStatus>();
  private readonly secret = 'ds_mock_hmac';
  async validateConfig() {}
  async execute(input: EnvelopeRequest, ctx: AdapterRequestContext): Promise<EnvelopeResult> {
    this.log.record(input, ctx);
    const externalId = `env_mock_${randomUUID()}`;
    this.statuses.set(externalId, 'sent');
    return { externalId, status: 'sent' };
  }
  async getStatus(externalId: string, _ctx?: AdapterRequestContext) { return this.statuses.get(externalId) ?? 'created'; }
  async void(externalId: string, reason: string, ctx: AdapterRequestContext) { this.log.record(reason, ctx); this.statuses.set(externalId, 'voided'); }
  async verifyWebhook(headers: Record<string, string | string[] | undefined>, body: string): Promise<WebhookEvent> {
    const sig = String(headers['x-docusign-signature-1'] ?? '');
    const signatureOk = await verifyHmacSignature(this.secret, body, sig);
    const parsed = JSON.parse(body) as { event: string; data: { envelopeId: string; envelopeSummary?: { status: string } } };
    return { provider: 'docusign', externalId: `${parsed.data.envelopeId}:${parsed.event}`, type: parsed.event, payload: parsed.data, signatureOk, receivedAt: new Date().toISOString() };
  }
  async signedWebhook(envelopeId: string, event: 'envelope-sent' | 'envelope-delivered' | 'envelope-completed' | 'envelope-declined' | 'envelope-voided'): Promise<{ headers: Record<string, string>; body: string }> {
    const { createHmac } = await import('node:crypto');
    const body = JSON.stringify({ event, data: { envelopeId, envelopeSummary: { status: event.replace('envelope-', '') } } });
    this.statuses.set(envelopeId, event.replace('envelope-', '') as EnvelopeStatus);
    return { headers: { 'x-docusign-signature-1': createHmac('sha256', this.secret).update(body).digest('hex') }, body };
  }
}

/** DocuSign eSignature REST boundary (JWT grant). Sandbox uses demo.docusign.net. */
export class DocuSignSignatureProvider implements SignatureProvider {
  readonly name = 'docusign';
  readonly mode: AdapterMode;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) { this.mode = modeFromEnv('DOCUSIGN_MODE', env); }
  private get host() { return this.mode === 'production' ? 'https://na3.docusign.net' : 'https://demo.docusign.net'; }
  async validateConfig() { requireEnv(this.name, this.env, ['DOCUSIGN_ACCOUNT_ID', 'DOCUSIGN_ACCESS_TOKEN', 'DOCUSIGN_HMAC_KEY']); }
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.host}/restapi/v2.1/accounts/${this.env.DOCUSIGN_ACCOUNT_ID}${path}`, { method, headers: { Authorization: `Bearer ${this.env.DOCUSIGN_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return (await res.json().catch(() => ({}))) as T;
  }
  async execute(input: EnvelopeRequest): Promise<EnvelopeResult> {
    const r = await this.call<{ envelopeId: string; status: string }>('POST', '/envelopes', {
      emailSubject: `Please sign: ${input.documentName}`, status: 'sent',
      documents: [{ documentBase64: input.documentBase64, name: input.documentName, fileExtension: 'pdf', documentId: '1' }],
      recipients: { signers: input.recipients.map((r, i) => ({ email: r.email, name: r.name, recipientId: String(i + 1), roleName: r.role, routingOrder: String(i + 1) })) },
      customFields: { textCustomFields: Object.entries(input.metadata).map(([name, value]) => ({ name, value })) },
    });
    return { externalId: r.envelopeId, status: 'sent' };
  }
  async getStatus(externalId: string): Promise<EnvelopeStatus> {
    const r = await this.call<{ status: string }>('GET', `/envelopes/${externalId}`);
    return (r.status as EnvelopeStatus) ?? 'created';
  }
  async void(externalId: string, reason: string) { await this.call('PUT', `/envelopes/${externalId}`, { status: 'voided', voidedReason: reason }); }
  async verifyWebhook(headers: Record<string, string | string[] | undefined>, body: string): Promise<WebhookEvent> {
    const sig = String(headers['x-docusign-signature-1'] ?? '');
    const { createHmac, timingSafeEqual } = await import('node:crypto');
    const expected = createHmac('sha256', this.env.DOCUSIGN_HMAC_KEY!).update(body).digest('base64');
    const signatureOk = expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    const parsed = JSON.parse(body) as { event: string; data: { envelopeId: string } };
    return { provider: 'docusign', externalId: `${parsed.data.envelopeId}:${parsed.event}`, type: parsed.event, payload: parsed.data, signatureOk, receivedAt: new Date().toISOString() };
  }
}

export function createSignatureProvider(env: NodeJS.ProcessEnv = process.env): SignatureProvider {
  return modeFromEnv('DOCUSIGN_MODE', env) === 'mock' ? new MockSignatureProvider() : new DocuSignSignatureProvider(env);
}
