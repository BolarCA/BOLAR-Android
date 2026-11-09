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
  ANTHROPIC_MODE: z.enum(['mock', 'sandbox', 'production']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-fable-5-1'),
  AI_MONTHLY_BUDGET_CENTS: z.coerce.number().int().min(0).default(5000),
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
    for (const k of ['STRIPE_MODE', 'PLAID_MODE', 'SENDGRID_MODE', 'TWILIO_MODE', 'DOCUSIGN_MODE', 'TRANSUNION_MODE', 'IDME_MODE', 'ANTHROPIC_MODE'] as const) {
      if (parsed.data[k] === 'production') throw new Error(`${k}=production is not allowed outside production`);
    }
  }
  cached = parsed.data;
  return cached;
}
export function resetConfigForTests(): void {
  cached = null;
}
