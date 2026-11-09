/**
 * Sliding-window rate limiter (blueprint Days 91-104, ADR 0006).
 *
 * Algorithm: sliding window counter. Each key keeps a hit count for the current and previous fixed window;
 * the estimate is `current + previous * (1 - elapsedFraction)`. It is cheap (two counters per key), close to a
 * true sliding log, and never lets a client exceed 2x the limit even at window boundaries.
 *
 * Stores: Redis (shared across API replicas) when `RATE_LIMIT_DRIVER=redis`, or `auto` and REDIS_URL answers a
 * PING; otherwise an in-memory store (single replica, tests). Store failures fail open and are logged: a limiter
 * outage must never take the API down.
 *
 * Policies (all per minute):
 *   login            10 per IP + 5 per e-mail hash, one generic message so account existence is not leaked
 *   public intake    60 per IP for /privacy-requests/intake, /invitations/accept and /webhooks/:provider (per provider)
 *   authenticated    600 per actor, keyed (tenantOrgId, userId) so one tenant's burst never consumes another's budget
 *   platform_admin   exempt
 * Trusted IPs (RATE_LIMIT_TRUSTED_IPS; loopback outside production) bypass every policy.
 * Rejections answer 429 `rate_limited` with Retry-After and are audited once per key per window.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createHash } from 'node:crypto';
import { AppError, type RequestContext } from '@bolar/shared';
import { config, trustedRateLimitIps, type Config } from '../config.js';
import { logger } from '../logger.js';
import { audit } from './audit.js';

export interface RateLimitPolicy {
  /** Stable policy name (login_ip, login_email, public_ip, actor). */
  name: string;
  /** Counter key; must include every isolation dimension (ip, email hash, tenantOrgId:userId, provider). */
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  policy: RateLimitPolicy;
  /** Estimated hits in the sliding window after this request. */
  estimate: number;
  remaining: number;
  retryAfterSeconds: number;
  windowStart: number;
}

export interface RateLimitStore {
  /** Increment the counter for `key` in the window containing `now`; return current and previous window counts. */
  hit(key: string, windowMs: number, now: number): Promise<{ current: number; previous: number }>;
  /** First caller for (key, windowStart) gets true; later callers false. Used to audit once per window. */
  markAudited(key: string, windowStart: number, ttlMs: number): Promise<boolean>;
  readonly kind: 'memory' | 'redis';
  close?(): Promise<void>;
}

export const RATE_LIMIT_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------------------------------

interface MemorySlot { windowStart: number; current: number; previous: number }

export class MemoryRateLimitStore implements RateLimitStore {
  readonly kind = 'memory' as const;
  private readonly slots = new Map<string, MemorySlot>();
  private readonly audited = new Map<string, number>();
  private ops = 0;
  constructor(private readonly maxKeys = 100_000) {}

  async hit(key: string, windowMs: number, now: number): Promise<{ current: number; previous: number }> {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    let s = this.slots.get(key);
    if (!s) {
      s = { windowStart, current: 0, previous: 0 };
      this.slots.set(key, s);
    } else if (s.windowStart !== windowStart) {
      s.previous = s.windowStart === windowStart - windowMs ? s.current : 0;
      s.current = 0;
      s.windowStart = windowStart;
    }
    s.current += 1;
    if (++this.ops % 1000 === 0 || this.slots.size > this.maxKeys) this.sweep(now, windowMs);
    return { current: s.current, previous: s.previous };
  }

  async markAudited(key: string, windowStart: number, ttlMs: number): Promise<boolean> {
    const k = `${key}:${windowStart}`;
    const now = Date.now();
    for (const [ak, exp] of this.audited) if (exp <= now) this.audited.delete(ak);
    if (this.audited.has(k)) return false;
    this.audited.set(k, now + ttlMs);
    return true;
  }

  /** Drop keys whose windows are both stale; keeps memory bounded under random-key abuse. */
  sweep(now: number, windowMs: number): void {
    for (const [k, s] of this.slots) if (s.windowStart < now - 2 * windowMs) this.slots.delete(k);
    if (this.slots.size > this.maxKeys) {
      let drop = this.slots.size - this.maxKeys;
      for (const k of this.slots.keys()) { if (drop-- <= 0) break; this.slots.delete(k); }
    }
  }

  clear(): void { this.slots.clear(); this.audited.clear(); }
  get size(): number { return this.slots.size; }
}

type RedisLike = {
  multi(): { incr(k: string): unknown; pexpire(k: string, ms: number): unknown; get(k: string): unknown; exec(): Promise<Array<[Error | null, unknown]> | null> };
  set(k: string, v: string, px: 'PX', ms: number, nx: 'NX'): Promise<string | null>;
  ping(): Promise<string>;
  quit(): Promise<unknown>;
  disconnect(): void;
};

export class RedisRateLimitStore implements RateLimitStore {
  readonly kind = 'redis' as const;
  constructor(private readonly redis: RedisLike, private readonly prefix = 'bolar:rl:') {}

  async hit(key: string, windowMs: number, now: number): Promise<{ current: number; previous: number }> {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const cur = `${this.prefix}${key}:${windowStart}`;
    const prev = `${this.prefix}${key}:${windowStart - windowMs}`;
    const m = this.redis.multi();
    m.incr(cur);
    m.pexpire(cur, windowMs * 2 + 1000);
    m.get(prev);
    const res = await m.exec();
    if (!res) throw new Error('redis multi returned null');
    const current = Number(res[0]?.[1] ?? 0);
    const previous = Number(res[2]?.[1] ?? 0);
    return { current, previous };
  }

  async markAudited(key: string, windowStart: number, ttlMs: number): Promise<boolean> {
    const r = await this.redis.set(`${this.prefix}audited:${key}:${windowStart}`, '1', 'PX', ttlMs, 'NX');
    return r === 'OK';
  }

  async close(): Promise<void> {
    try { await this.redis.quit(); } catch { this.redis.disconnect(); }
  }
}

async function connectRedisStore(url: string): Promise<RedisRateLimitStore | null> {
  try {
    const { Redis } = await import('ioredis');
    const client = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 1000 });
    client.on('error', (err: Error) => logger.warn({ err: err.message }, 'rate-limit redis error'));
    await client.connect();
    const pong = await Promise.race([client.ping(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('ping timeout')), 1000))]);
    if (pong !== 'PONG') throw new Error(`unexpected ping reply ${String(pong)}`);
    return new RedisRateLimitStore(client as unknown as RedisLike);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'rate-limit: redis unavailable, using in-memory store');
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Limiter
// ---------------------------------------------------------------------------------------------------------------

export class RateLimiter {
  constructor(public store: RateLimitStore, private readonly now: () => number = Date.now) {}

  async check(policy: RateLimitPolicy): Promise<RateLimitDecision> {
    const now = this.now();
    const windowStart = Math.floor(now / policy.windowMs) * policy.windowMs;
    const elapsed = (now - windowStart) / policy.windowMs;
    const { current, previous } = await this.store.hit(policy.key, policy.windowMs, now);
    const estimate = current + previous * (1 - elapsed);
    const allowed = estimate <= policy.limit;
    const remaining = Math.max(0, Math.floor(policy.limit - estimate));
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((policy.windowMs - (now - windowStart)) / 1000));
    return { allowed, policy, estimate, remaining, retryAfterSeconds, windowStart };
  }
}

export interface RateLimitOverrides {
  enabled?: boolean;
  store?: RateLimitStore;
  now?: () => number;
  limits?: Partial<Pick<Config, 'RATE_LIMIT_LOGIN_PER_IP' | 'RATE_LIMIT_LOGIN_PER_EMAIL' | 'RATE_LIMIT_PUBLIC_PER_IP' | 'RATE_LIMIT_AUTHED_PER_ACTOR'>>;
  trustedIps?: Set<string>;
}

let overrides: RateLimitOverrides = {};
let limiterPromise: Promise<RateLimiter> | null = null;

/** Tests: force the memory store, shrink limits, control the clock. Call `resetRateLimiterForTests()` after. */
export function configureRateLimiterForTests(o: RateLimitOverrides): void {
  overrides = { ...overrides, ...o };
  limiterPromise = null;
}
export function resetRateLimiterForTests(): void {
  overrides = {};
  limiterPromise = null;
}

export async function getRateLimiter(cfg: Config = config()): Promise<RateLimiter> {
  if (!limiterPromise) {
    limiterPromise = (async () => {
      if (overrides.store) return new RateLimiter(overrides.store, overrides.now ?? Date.now);
      let store: RateLimitStore | null = null;
      if (cfg.RATE_LIMIT_DRIVER === 'redis' || (cfg.RATE_LIMIT_DRIVER === 'auto' && cfg.NODE_ENV !== 'test')) store = await connectRedisStore(cfg.REDIS_URL);
      store ??= new MemoryRateLimitStore();
      logger.info({ driver: store.kind }, 'rate limiter ready');
      return new RateLimiter(store, overrides.now ?? Date.now);
    })();
  }
  return limiterPromise;
}

export async function closeRateLimiter(): Promise<void> {
  const l = await limiterPromise?.catch(() => null);
  limiterPromise = null;
  await l?.store.close?.();
}

// ---------------------------------------------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------------------------------------------

export function hashKeyPart(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32);
}

export function isPlatformAdminActor(ctx: RequestContext): boolean {
  return ctx.roles.some((r) => r.role === 'platform_admin' && r.scopeType === 'platform');
}

const PUBLIC_INTAKE: Array<{ method: string; test: (path: string) => string | null }> = [
  { method: 'POST', test: (p) => (p === '/privacy-requests/intake' ? 'intake' : null) },
  { method: 'POST', test: (p) => (p === '/invitations/accept' ? 'invite' : null) },
  { method: 'POST', test: (p) => { const m = /^\/webhooks\/([A-Za-z0-9_-]{1,32})\/?$/.exec(p); return m ? `webhook:${m[1]}` : null; } },
];

/** Which policies apply to this request. Pure: easy to unit test without HTTP. */
export function policiesFor(input: { method: string; path: string; ip: string | null; body: unknown; ctx: RequestContext }, cfg: Config = config()): RateLimitPolicy[] {
  const limits = { ...cfg, ...(overrides.limits ?? {}) };
  const trusted = overrides.trustedIps ?? trustedRateLimitIps(cfg);
  const ip = input.ip ?? 'unknown';
  if (trusted.has(ip)) return [];
  const out: RateLimitPolicy[] = [];
  const method = input.method.toUpperCase();
  const path = input.path.replace(/\/+$/, '') || '/';

  if (method === 'POST' && path === '/auth/login') {
    out.push({ name: 'login_ip', key: `login:ip:${ip}`, limit: limits.RATE_LIMIT_LOGIN_PER_IP, windowMs: RATE_LIMIT_WINDOW_MS });
    const email = (input.body as { email?: unknown } | null)?.email;
    if (typeof email === 'string' && email.length > 0) out.push({ name: 'login_email', key: `login:email:${hashKeyPart(email)}`, limit: limits.RATE_LIMIT_LOGIN_PER_EMAIL, windowMs: RATE_LIMIT_WINDOW_MS });
    return out;
  }
  for (const rule of PUBLIC_INTAKE) {
    if (rule.method !== method) continue;
    const cls = rule.test(path);
    if (cls) { out.push({ name: 'public_ip', key: `public:${cls}:ip:${ip}`, limit: limits.RATE_LIMIT_PUBLIC_PER_IP, windowMs: RATE_LIMIT_WINDOW_MS }); return out; }
  }
  if (input.ctx.actor) {
    if (isPlatformAdminActor(input.ctx)) return out;
    out.push({ name: 'actor', key: `actor:${input.ctx.tenantOrgId ?? 'none'}:${input.ctx.actor.userId}`, limit: limits.RATE_LIMIT_AUTHED_PER_ACTOR, windowMs: RATE_LIMIT_WINDOW_MS });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------------------------------------------

export function rateLimitError(retryAfterSeconds: number): AppError {
  return new AppError('rate_limited', 'Too many requests; try again later', 429, { details: { retryAfterSeconds } });
}

/** Mount after buildContext (needs ctx.actor/roles) and after express.json (needs body.email for login). */
export function rateLimitMiddleware(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cfg = config();
      const enabled = overrides.enabled ?? cfg.RATE_LIMIT_ENABLED === '1';
      if (!enabled) return next();
      const ctx = req.ctx;
      const policies = policiesFor({ method: req.method, path: req.path, ip: req.ip ?? null, body: req.body, ctx }, cfg);
      if (policies.length === 0) return next();
      const limiter = await getRateLimiter(cfg);
      let tightest: RateLimitDecision | null = null;
      for (const policy of policies) {
        const d = await limiter.check(policy);
        if (!tightest || d.remaining < tightest.remaining) tightest = d;
        if (!d.allowed) {
          res.setHeader('Retry-After', String(d.retryAfterSeconds));
          res.setHeader('RateLimit-Limit', String(policy.limit));
          res.setHeader('RateLimit-Remaining', '0');
          res.setHeader('RateLimit-Reset', String(d.retryAfterSeconds));
          await auditOncePerWindow(limiter, ctx, d, req.path);
          return next(rateLimitError(d.retryAfterSeconds));
        }
      }
      if (tightest) {
        res.setHeader('RateLimit-Limit', String(tightest.policy.limit));
        res.setHeader('RateLimit-Remaining', String(tightest.remaining));
      }
      next();
    } catch (err) {
      // Fail open: a limiter/store outage must not turn into an API outage. Logged for the on-call.
      logger.warn({ err: err instanceof Error ? err.message : String(err), requestId: req.ctx?.requestId }, 'rate limiter failed open');
      next();
    }
  };
}

async function auditOncePerWindow(limiter: RateLimiter, ctx: RequestContext, d: RateLimitDecision, path: string): Promise<void> {
  try {
    const first = await limiter.store.markAudited(d.policy.key, d.windowStart, d.policy.windowMs * 2);
    if (!first) return;
    await audit(ctx, {
      action: 'rate_limit.exceeded',
      resourceType: 'rate_limit',
      resourceId: d.policy.name,
      outcome: 'deny',
      metadata: { policy: d.policy.name, keyHash: hashKeyPart(d.policy.key), limit: d.policy.limit, windowMs: d.policy.windowMs, path },
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'rate limit audit failed');
  }
}
