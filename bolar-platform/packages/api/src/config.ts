import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load .env from the package cwd first, then the monorepo root (pnpm --filter runs in the package dir).
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env'), resolve(new URL('../../..', import.meta.url).pathname, '.env')]) {
  if (existsSync(candidate)) loadEnv({ path: candidate, quiet: true });
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  API_PORT: z.coerce.number().default(4000),
  API_BASE_URL: z.string().default('http://localhost:4000'),
  WEB_BASE_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  AUTH_PROVIDER: z.enum(['local']).default('local'),
  AUTH_JWT_SECRET: z.string().min(32),
  AUTH_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  AUTH_REFRESH_TTL_SECONDS: z.coerce.number().default(1209600),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  QUEUE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_BUCKET: z.string().default('bolar-local'),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  STORAGE_LOCAL_ROOT: z.string().default('.storage'),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().default(300),
  EMAIL_DRIVER: z.enum(['mailhog', 'sendgrid', 'mock', 'sink']).default('sink'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMS_DRIVER: z.enum(['mock', 'twilio']).default('mock'),
  STRIPE_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
  PLAID_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
  SENDGRID_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
  TWILIO_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
  DOCUSIGN_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
  TRANSUNION_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
  IDME_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
  SENTRY_DSN: z.string().optional(),
  // ---- Hardening (Days 91-104): every key has a safe default so unset env means "previous behaviour". ----
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('bolar-api'),
  /** Interval for the per-route-class latency histogram summary log; 0 disables the summary. */
  OBS_HISTOGRAM_LOG_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
  RATE_LIMIT_ENABLED: z.enum(['0', '1']).default('1'),
  /** auto: Redis when REDIS_URL answers, else in-memory. Tests force memory. */
  RATE_LIMIT_DRIVER: z.enum(['auto', 'memory', 'redis']).default('auto'),
  RATE_LIMIT_LOGIN_PER_IP: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_LOGIN_PER_EMAIL: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_PUBLIC_PER_IP: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_AUTHED_PER_ACTOR: z.coerce.number().int().min(1).default(600),
  /** Comma list of client IPs that bypass rate limiting (load generators, CI runners). Outside production the
   *  loopback addresses are trusted by default so local e2e and dev servers are not throttled. */
  RATE_LIMIT_TRUSTED_IPS: z.string().optional(),
  CACHE_ME_TTL_SECONDS: z.coerce.number().int().min(0).default(30),
  /** Opt-in PostgreSQL row-level security for tenant reads (ADR 0005). Requires a non-owner DB role. */
  DB_RLS_ENFORCE: z.enum(['0', '1']).default('0'),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  QUEUE_BACKOFF_BASE_MS: z.coerce.number().int().min(100).default(2_000),
  QUEUE_BACKOFF_MAX_MS: z.coerce.number().int().min(1_000).default(300_000),
  QUEUE_BACKOFF_JITTER: z.coerce.number().min(0).max(1).default(0.5),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;
export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  if (parsed.data.NODE_ENV !== 'production') {
    for (const k of ['STRIPE_MODE', 'PLAID_MODE', 'SENDGRID_MODE', 'TWILIO_MODE', 'DOCUSIGN_MODE', 'TRANSUNION_MODE', 'IDME_MODE'] as const) {
      if (parsed.data[k] === 'production') throw new Error(`${k}=production is not allowed outside production`);
    }
  }
  cached = parsed.data;
  return cached;
}

/** Client IPs exempt from rate limiting (see RATE_LIMIT_TRUSTED_IPS). */
export function trustedRateLimitIps(cfg: Config = config()): Set<string> {
  if (cfg.RATE_LIMIT_TRUSTED_IPS !== undefined) return new Set(cfg.RATE_LIMIT_TRUSTED_IPS.split(',').map((s) => s.trim()).filter(Boolean));
  return cfg.NODE_ENV === 'production' ? new Set() : new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
}
export function resetConfigForTests(): void {
  cached = null;
}
