import nodemailer from 'nodemailer';
import { CallLog, modeFromEnv, requireEnv, type AdapterMode, type AdapterRequestContext, type ProviderAdapter } from '../adapter.js';

export interface EmailMessage { to: string; subject: string; text: string; html?: string; templateKey?: string }
export interface EmailResult { messageId: string; accepted: boolean }
export type EmailAdapter = ProviderAdapter<EmailMessage, EmailResult>;

/** In-memory sink: default for tests and CI. */
export class SinkEmailAdapter implements EmailAdapter {
  readonly name = 'email-sink';
  readonly mode: AdapterMode = 'mock';
  readonly log = new CallLog<EmailMessage>();
  async validateConfig() {}
  async execute(input: EmailMessage, ctx: AdapterRequestContext) {
    this.log.record(input, ctx);
    return { messageId: `sink_${this.log.calls.length}`, accepted: true };
  }
}

/** SMTP adapter for Mailhog (local) or any SMTP relay. */
export class SmtpEmailAdapter implements EmailAdapter {
  readonly name = 'email-smtp';
  readonly mode: AdapterMode = 'sandbox';
  private readonly transport;
  constructor(env: NodeJS.ProcessEnv = process.env) {
    requireEnv(this.name, env, ['SMTP_HOST', 'SMTP_PORT']);
    this.transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT), secure: false, ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}) });
  }
  async validateConfig() { await this.transport.verify(); }
  async execute(input: EmailMessage) {
    const info = await this.transport.sendMail({ from: process.env.EMAIL_FROM ?? 'no-reply@bolar.local', to: input.to, subject: input.subject, text: input.text, html: input.html });
    return { messageId: info.messageId, accepted: info.accepted.length > 0 };
  }
}

/** SendGrid boundary. Mock mode records calls; sandbox/production require SENDGRID_API_KEY and call the v3 API. */
export class SendGridEmailAdapter implements EmailAdapter {
  readonly name = 'sendgrid';
  readonly mode: AdapterMode;
  readonly log = new CallLog<EmailMessage>();
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) { this.mode = modeFromEnv('SENDGRID_MODE', env); }
  async validateConfig() { if (this.mode !== 'mock') requireEnv(this.name, this.env, ['SENDGRID_API_KEY']); }
  async execute(input: EmailMessage, ctx: AdapterRequestContext) {
    if (this.mode === 'mock') { this.log.record(input, ctx); return { messageId: `sg_mock_${this.log.calls.length}`, accepted: true }; }
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST', headers: { Authorization: `Bearer ${this.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ personalizations: [{ to: [{ email: input.to }] }], from: { email: this.env.EMAIL_FROM ?? 'no-reply@bolar.local' }, subject: input.subject, content: [{ type: 'text/plain', value: input.text }, ...(input.html ? [{ type: 'text/html', value: input.html }] : [])], ...(this.mode === 'sandbox' ? { mail_settings: { sandbox_mode: { enable: true } } } : {}) }),
    });
    return { messageId: res.headers.get('x-message-id') ?? `sg_${Date.now()}`, accepted: res.ok };
  }
}

export function createEmailAdapter(env: NodeJS.ProcessEnv = process.env): EmailAdapter {
  switch (env.EMAIL_DRIVER ?? 'sink') {
    case 'mailhog': return new SmtpEmailAdapter(env);
    case 'sendgrid': return new SendGridEmailAdapter(env);
    default: return new SinkEmailAdapter();
  }
}
