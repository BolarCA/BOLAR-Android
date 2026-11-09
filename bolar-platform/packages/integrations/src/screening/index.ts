import { randomUUID } from 'node:crypto';
import { CallLog, modeFromEnv, requireEnv, type AdapterMode, type AdapterRequestContext, type ProviderAdapter } from '../adapter.js';

// ───────── Screening provider (TransUnion boundary, Days 43/58) ─────────
// Raw reports are restricted data: adapters return a storageKey-ready buffer plus a minimal summary;
// the screening module stores the report under restricted classification and never exposes it to AI.
export interface ScreeningRequest { applicantRef: string; consentAt: string; consentDocumentId: string; products: ('credit' | 'criminal' | 'eviction')[]; applicant: { firstName: string; lastName: string; dateOfBirth: string; ssnLast4?: string; address: { line1: string; city: string; state: string; postalCode: string } } }
export interface ScreeningSummary { recommendation: 'accept' | 'conditional' | 'review' | 'decline'; creditBand?: 'excellent' | 'good' | 'fair' | 'poor' | 'thin'; evictionRecords: number; criminalRecords: number; providerContact: string }
export interface ScreeningResponse { externalId: string; status: 'pending' | 'completed'; reportPdf?: Buffer; summary?: ScreeningSummary }
export type ScreeningProvider = ProviderAdapter<ScreeningRequest, ScreeningResponse>;

/** Mock TransUnion: deterministic by last name prefix (Z* decline, R* review, C* conditional, else accept). */
export class MockScreeningProvider implements ScreeningProvider {
  readonly name = 'transunion';
  readonly mode: AdapterMode = 'mock';
  readonly log = new CallLog<ScreeningRequest>();
  async validateConfig() {}
  async execute(input: ScreeningRequest, ctx: AdapterRequestContext): Promise<ScreeningResponse> {
    if (!input.consentAt) throw new Error('[transunion] consent is required before ordering a report');
    this.log.record(input, ctx);
    const initial = input.applicant.lastName.charAt(0).toUpperCase();
    const recommendation = initial === 'Z' ? 'decline' : initial === 'R' ? 'review' : initial === 'C' ? 'conditional' : 'accept';
    const summary: ScreeningSummary = { recommendation, creditBand: recommendation === 'decline' ? 'poor' : recommendation === 'accept' ? 'good' : 'fair', evictionRecords: recommendation === 'decline' ? 1 : 0, criminalRecords: 0, providerContact: 'TransUnion Rental Screening Solutions, 1-800-000-0000 (mock)' };
    return { externalId: `tu_mock_${randomUUID()}`, status: 'completed', reportPdf: Buffer.from(`%PDF-1.4 mock screening report for ${input.applicantRef}`), summary };
  }
}

export class TransUnionScreeningProvider implements ScreeningProvider {
  readonly name = 'transunion';
  readonly mode: AdapterMode;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) { this.mode = modeFromEnv('TRANSUNION_MODE', env); }
  async validateConfig() { requireEnv(this.name, this.env, ['TRANSUNION_API_KEY', 'TRANSUNION_PARTNER_ID']); }
  async execute(input: ScreeningRequest): Promise<ScreeningResponse> {
    if (!input.consentAt) throw new Error('[transunion] consent is required before ordering a report');
    // Sandbox contract placeholder: the real ShareAble/SmartMove flow is applicant-initiated; the order is
    // created here and completed through the webhook/polling path handled by the screening module.
    const res = await fetch(`${this.mode === 'production' ? 'https://api.transunion.com' : 'https://api-sandbox.transunion.com'}/rental-screening/v1/orders`, {
      method: 'POST', headers: { Authorization: `Bearer ${this.env.TRANSUNION_API_KEY}`, 'Content-Type': 'application/json', 'X-Partner-Id': this.env.TRANSUNION_PARTNER_ID! },
      body: JSON.stringify({ applicantRef: input.applicantRef, products: input.products, consentAt: input.consentAt }),
    });
    const json = (await res.json().catch(() => ({}))) as { orderId?: string };
    return { externalId: json.orderId ?? `tu_${Date.now()}`, status: 'pending' };
  }
}

export function createScreeningProvider(env: NodeJS.ProcessEnv = process.env): ScreeningProvider {
  return modeFromEnv('TRANSUNION_MODE', env) === 'mock' ? new MockScreeningProvider() : new TransUnionScreeningProvider(env);
}

// ───────── Identity verification provider (ID.me boundary, Day 58) ─────────
export interface IdvStartRequest { subjectRef: string; redirectUrl: string; level: 'basic' | 'nist_ial2' }
export interface IdvStartResult { externalId: string; verificationUrl: string }
export interface IdvResult { externalId: string; status: 'pending' | 'verified' | 'failed'; verifiedAt?: string; attributes?: { firstName: string; lastName: string; dobMatch: boolean } }
export interface IdentityVerificationProvider extends ProviderAdapter<IdvStartRequest, IdvStartResult> {
  getResult(externalId: string, ctx: AdapterRequestContext): Promise<IdvResult>;
}

export class MockIdentityVerificationProvider implements IdentityVerificationProvider {
  readonly name = 'idme';
  readonly mode: AdapterMode = 'mock';
  readonly log = new CallLog<IdvStartRequest | string>();
  readonly results = new Map<string, IdvResult>();
  async validateConfig() {}
  async execute(input: IdvStartRequest, ctx: AdapterRequestContext): Promise<IdvStartResult> {
    this.log.record(input, ctx);
    const externalId = `idme_mock_${randomUUID()}`;
    this.results.set(externalId, { externalId, status: input.subjectRef.endsWith('-fail') ? 'failed' : 'verified', verifiedAt: new Date().toISOString(), attributes: { firstName: 'Mock', lastName: 'Subject', dobMatch: true } });
    return { externalId, verificationUrl: `https://mock.id.me/verify/${externalId}?redirect=${encodeURIComponent(input.redirectUrl)}` };
  }
  async getResult(externalId: string, _ctx?: AdapterRequestContext): Promise<IdvResult> { return this.results.get(externalId) ?? { externalId, status: 'pending' }; }
}

export class IdMeIdentityVerificationProvider implements IdentityVerificationProvider {
  readonly name = 'idme';
  readonly mode: AdapterMode;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) { this.mode = modeFromEnv('IDME_MODE', env); }
  private get host() { return this.mode === 'production' ? 'https://api.id.me' : 'https://api.idmelabs.com'; }
  async validateConfig() { requireEnv(this.name, this.env, ['IDME_CLIENT_ID', 'IDME_CLIENT_SECRET']); }
  async execute(input: IdvStartRequest): Promise<IdvStartResult> {
    const externalId = randomUUID();
    const scope = input.level === 'nist_ial2' ? 'identity' : 'openid';
    const url = `${this.host}/oauth/authorize?client_id=${this.env.IDME_CLIENT_ID}&redirect_uri=${encodeURIComponent(input.redirectUrl)}&response_type=code&scope=${scope}&state=${externalId}`;
    return { externalId, verificationUrl: url };
  }
  async getResult(externalId: string): Promise<IdvResult> {
    // Completed through the OAuth callback handled by the privacy/screening module; polling returns pending.
    return { externalId, status: 'pending' };
  }
}

export function createIdentityVerificationProvider(env: NodeJS.ProcessEnv = process.env): IdentityVerificationProvider {
  return modeFromEnv('IDME_MODE', env) === 'mock' ? new MockIdentityVerificationProvider() : new IdMeIdentityVerificationProvider(env);
}
