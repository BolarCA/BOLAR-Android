/** `pnpm env:check` - validates .env against the contract in .env.example and flags live credentials. */
import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';

const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const required = example.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0]!);
const optional = new Set(['SENTRY_DSN', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'STORAGE_ENDPOINT', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY', 'SMTP_HOST', 'SMTP_PORT', 'ANTHROPIC_API_KEY']);
let failed = false;
if (!existsSync(new URL('../.env', import.meta.url))) console.warn('[env:check] .env missing; using process env only (cp .env.example .env)');
for (const k of required) {
  if (optional.has(k)) continue;
  if (!process.env[k]) { console.error(`[env:check] missing ${k}`); failed = true; }
}
const secret = process.env.AUTH_JWT_SECRET ?? '';
if (secret.length < 32) { console.error('[env:check] AUTH_JWT_SECRET must be >= 32 chars'); failed = true; }
for (const k of ['STRIPE_MODE', 'PLAID_MODE', 'SENDGRID_MODE', 'TWILIO_MODE', 'DOCUSIGN_MODE', 'TRANSUNION_MODE', 'IDME_MODE', 'ANTHROPIC_MODE']) {
  const v = process.env[k];
  if (v && !['mock', 'sandbox', 'production'].includes(v)) { console.error(`[env:check] ${k} must be mock|sandbox|production`); failed = true; }
  if (v === 'production' && process.env.NODE_ENV !== 'production') { console.error(`[env:check] ${k}=production outside production is not allowed`); failed = true; }
}
if (/sk_live_|pk_live_/.test(JSON.stringify(process.env))) { console.error('[env:check] live Stripe key detected; use sandbox/test keys only'); failed = true; }
if (failed) process.exit(1);
console.info(`[env:check] OK (${required.length} keys checked)`);
