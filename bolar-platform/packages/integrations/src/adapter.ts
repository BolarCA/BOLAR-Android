/**
 * Provider adapter contract (blueprint p299, Day 56).
 * Domain services depend on adapters, never on SDKs directly. Every adapter declares its mode and
 * validates configuration up front; mock and sandbox adapters are mandatory before production.
 */
export type AdapterMode = 'mock' | 'sandbox' | 'production';

export interface AdapterRequestContext {
  requestId: string;
  tenantOrgId: string | null;
  actorId: string | null;
  /** Idempotency key for the external call (payments, envelopes, notifications). */
  idempotencyKey?: string;
}

export interface WebhookEvent<T = unknown> {
  provider: string;
  externalId: string;
  type: string;
  payload: T;
  signatureOk: boolean;
  receivedAt: string;
}

export interface ProviderAdapter<Request, Response> {
  readonly name: string;
  readonly mode: AdapterMode;
  validateConfig(): Promise<void>;
  execute(input: Request, ctx: AdapterRequestContext): Promise<Response>;
  verifyWebhook?(headers: Record<string, string | string[] | undefined>, body: string): Promise<WebhookEvent>;
}

export class AdapterConfigError extends Error {
  constructor(adapter: string, message: string) {
    super(`[${adapter}] ${message}`);
    this.name = 'AdapterConfigError';
  }
}

export class AdapterCallError extends Error {
  constructor(public readonly adapter: string, message: string, public readonly retryable: boolean, public readonly inner?: unknown) {
    super(`[${adapter}] ${message}`);
    this.name = 'AdapterCallError';
  }
}

/** Resolve the adapter mode from env with a safe default of mock; production outside NODE_ENV=production is refused. */
export function modeFromEnv(envKey: string, env: NodeJS.ProcessEnv = process.env): AdapterMode {
  const v = (env[envKey] ?? 'mock') as AdapterMode;
  if (!['mock', 'sandbox', 'production'].includes(v)) throw new AdapterConfigError(envKey, `invalid mode ${v}`);
  if (v === 'production' && env.NODE_ENV !== 'production') throw new AdapterConfigError(envKey, 'production mode is not allowed outside production');
  return v;
}

export function requireEnv(adapter: string, env: NodeJS.ProcessEnv, keys: string[]): void {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) throw new AdapterConfigError(adapter, `missing configuration: ${missing.join(', ')}`);
}

/** Retry with exponential backoff for retryable adapter errors; never retries non-retryable (4xx-style) failures. */
export async function withRetry<T>(fn: () => Promise<T>, opts: { attempts?: number; baseMs?: number; onRetry?: (attempt: number, err: unknown) => void } = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 200;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof AdapterCallError ? err.retryable : true;
      if (!retryable || i === attempts) throw err;
      opts.onRetry?.(i, err);
      await new Promise((r) => setTimeout(r, baseMs * 2 ** (i - 1)));
    }
  }
  throw lastErr;
}

/** Constant-time HMAC signature check used by webhook verifiers. */
export async function verifyHmacSignature(secret: string, body: string, signature: string, algo: 'sha256' = 'sha256'): Promise<boolean> {
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const expected = createHmac(algo, secret).update(body).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.replace(/^sha256=/, ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Records of outbound calls kept by mock adapters so tests can assert on them without network. */
export class CallLog<T = unknown> {
  readonly calls: { at: string; input: T; ctx: AdapterRequestContext }[] = [];
  record(input: T, ctx: AdapterRequestContext): void {
    this.calls.push({ at: new Date().toISOString(), input, ctx });
  }
  clear(): void {
    this.calls.length = 0;
  }
}
