import { CallLog, modeFromEnv, requireEnv, type AdapterMode, type AdapterRequestContext, type ProviderAdapter } from '../adapter.js';

export interface SmsMessage { to: string; body: string; templateKey?: string }
export interface SmsResult { messageId: string; accepted: boolean }
export type SmsAdapter = ProviderAdapter<SmsMessage, SmsResult>;

/** Twilio boundary. Mock mode records calls; sandbox/production require account SID/token and call the REST API. */
export class TwilioSmsAdapter implements SmsAdapter {
  readonly name = 'twilio';
  readonly mode: AdapterMode;
  readonly log = new CallLog<SmsMessage>();
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) { this.mode = modeFromEnv('TWILIO_MODE', env); }
  async validateConfig() { if (this.mode !== 'mock') requireEnv(this.name, this.env, ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM']); }
  async execute(input: SmsMessage, ctx: AdapterRequestContext) {
    if (this.mode === 'mock') { this.log.record(input, ctx); return { messageId: `tw_mock_${this.log.calls.length}`, accepted: true }; }
    const sid = this.env.TWILIO_ACCOUNT_SID!;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${sid}:${this.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: input.to, From: this.env.TWILIO_FROM!, Body: input.body }),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string };
    return { messageId: json.sid ?? `tw_${Date.now()}`, accepted: res.ok };
  }
}

export function createSmsAdapter(env: NodeJS.ProcessEnv = process.env): SmsAdapter {
  return new TwilioSmsAdapter(env);
}
