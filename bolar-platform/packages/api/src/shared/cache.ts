/**
 * In-process caches (blueprint Days 91-104, ADR 0006).
 *
 * Only data that is cheap to recompute and safe to serve a few seconds stale lives here. Every key that depends
 * on a tenant carries the tenantOrgId so a cross-tenant switch (X-Tenant-Org) can never hit another org's entry.
 * Invalidation is explicit: IAM/auth/platform mutations call the `invalidate*` helpers below.
 */

export interface CacheEntry<T> { value: T; expiresAt: number }

export class TtlCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();
  constructor(private readonly maxEntries = 10_000, private readonly now: () => number = Date.now) {}

  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) { this.map.delete(key); return undefined; }
    return e.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) return;
    if (this.map.size >= this.maxEntries) {
      // Drop the oldest insertions first (Map preserves insertion order).
      const drop = Math.max(1, Math.floor(this.maxEntries / 10));
      let i = 0;
      for (const k of this.map.keys()) { if (i++ >= drop) break; this.map.delete(k); }
    }
    this.map.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  delete(key: string): void { this.map.delete(key); }
  /** Remove every key for which `predicate` is true; returns the number removed. */
  invalidateWhere(predicate: (key: string) => boolean): number {
    let n = 0;
    for (const k of this.map.keys()) if (predicate(k)) { this.map.delete(k); n++; }
    return n;
  }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
}

/** Roles + permissions resolved for one (user, org, session) triple; what `/me` and every request needs. */
export interface MeCacheValue { roles: unknown[]; permissions: string[] }
export const meCache = new TtlCache<MeCacheValue>(20_000);
export const meCacheStats = { hits: 0, misses: 0 };

export function meCacheKey(userId: string, tenantOrgId: string, sessionId: string): string {
  return `me:${userId}:${tenantOrgId}:${sessionId}`;
}

/** Role grant/revoke, suspend/deactivate, support session start/end: forget every entry of that user (all orgs, all sessions). */
export function invalidateUserCache(userId: string): number {
  return meCache.invalidateWhere((k) => k.startsWith(`me:${userId}:`));
}
/** Session revoked (logout, refresh reuse): forget that session only. */
export function invalidateSessionCache(sessionId: string): number {
  return meCache.invalidateWhere((k) => k.startsWith('me:') && k.endsWith(`:${sessionId}`));
}
/** Org-wide invalidation (e.g. org suspended). */
export function invalidateOrgCache(tenantOrgId: string): number {
  return meCache.invalidateWhere((k) => k.startsWith('me:') && k.split(':')[2] === tenantOrgId);
}

/**
 * Memoize a pure, tenant-independent computation for the life of the process (permission catalog, portal
 * templates). Values must be immutable: callers receive the same object.
 */
export function memoizeForever<A extends unknown[], R>(fn: (...args: A) => R, keyOf: (...args: A) => string = (...a) => JSON.stringify(a)): ((...args: A) => R) & { clear: () => void } {
  const store = new Map<string, R>();
  const wrapped = ((...args: A) => {
    const k = keyOf(...args);
    if (store.has(k)) return store.get(k) as R;
    const v = fn(...args);
    store.set(k, v);
    return v;
  }) as ((...args: A) => R) & { clear: () => void };
  wrapped.clear = () => store.clear();
  return wrapped;
}

export function resetCachesForTests(): void {
  meCache.clear();
  meCacheStats.hits = 0;
  meCacheStats.misses = 0;
}
