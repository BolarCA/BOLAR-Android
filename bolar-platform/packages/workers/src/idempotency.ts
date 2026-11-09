/**
 * Worker job idempotency (blueprint Days 91-104 "worker idempotency").
 *
 * BullMQ deduplicates by jobId only while the job lives in the queue; a job re-added after completion/removal,
 * a redelivery after a worker crash between "handler done" and "ack", or a replayed domain event would run the
 * side effect twice. `withIdempotency` records processed (queue, jobId) pairs in a Redis set-like structure
 * (SET NX with TTL) or an in-memory map when Redis is unavailable, and skips redeliveries.
 *
 * Semantics: the marker is claimed before the handler runs (so two concurrent deliveries cannot both run); a
 * handler failure releases the marker so BullMQ's retry/backoff can run the job again.
 */
export interface ProcessedJobStore {
  readonly kind: 'memory' | 'redis';
  /** Claim (queue, jobId). True when this caller claimed it; false when it was already processed/claimed. */
  claim(queue: string, jobId: string, ttlSeconds: number): Promise<boolean>;
  /** Release a claim after a failed run so the retry can execute. */
  release(queue: string, jobId: string): Promise<void>;
  close?(): Promise<void>;
}

export class MemoryProcessedJobStore implements ProcessedJobStore {
  readonly kind = 'memory' as const;
  private readonly map = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now, private readonly maxEntries = 100_000) {}
  async claim(queue: string, jobId: string, ttlSeconds: number): Promise<boolean> {
    const k = `${queue}:${jobId}`;
    const t = this.now();
    const exp = this.map.get(k);
    if (exp !== undefined && exp > t) return false;
    if (this.map.size >= this.maxEntries) for (const [key, e] of this.map) { if (e <= t) this.map.delete(key); }
    if (this.map.size >= this.maxEntries) { const first = this.map.keys().next().value; if (first !== undefined) this.map.delete(first); }
    this.map.set(k, t + ttlSeconds * 1000);
    return true;
  }
  async release(queue: string, jobId: string): Promise<void> { this.map.delete(`${queue}:${jobId}`); }
  get size(): number { return this.map.size; }
}

type RedisLike = { set(k: string, v: string, ex: 'EX', s: number, nx: 'NX'): Promise<string | null>; del(k: string): Promise<number>; quit(): Promise<unknown>; disconnect(): void };

export class RedisProcessedJobStore implements ProcessedJobStore {
  readonly kind = 'redis' as const;
  constructor(private readonly redis: RedisLike, private readonly prefix = 'bolar:jobs:processed:') {}
  async claim(queue: string, jobId: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(`${this.prefix}${queue}:${jobId}`, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
  }
  async release(queue: string, jobId: string): Promise<void> { await this.redis.del(`${this.prefix}${queue}:${jobId}`); }
  async close(): Promise<void> { try { await this.redis.quit(); } catch { this.redis.disconnect(); } }
}

export interface IdempotencyLogger { info(obj: Record<string, unknown>, msg: string): void; warn(obj: Record<string, unknown>, msg: string): void }

export interface WithIdempotencyOptions {
  store: ProcessedJobStore;
  ttlSeconds?: number;
  logger?: IdempotencyLogger;
}

export type JobRunResult = 'processed' | 'skipped_duplicate' | 'failed';

/**
 * Wrap a job handler. Jobs without an id cannot be deduplicated and always run.
 * Store errors fail open (the job runs) and are logged: a Redis hiccup must not stall the queues.
 */
export function withIdempotency<T>(queue: string, handler: (data: T) => Promise<void>, opts: WithIdempotencyOptions): (data: T, jobId: string | undefined | null) => Promise<JobRunResult> {
  const ttl = opts.ttlSeconds ?? 86_400;
  return async (data: T, jobId: string | undefined | null): Promise<JobRunResult> => {
    if (!jobId) { await handler(data); return 'processed'; }
    let claimed = true;
    try {
      claimed = await opts.store.claim(queue, jobId, ttl);
    } catch (err) {
      opts.logger?.warn({ queue, jobId, err: err instanceof Error ? err.message : String(err) }, 'idempotency store unavailable; running job');
    }
    if (!claimed) {
      opts.logger?.info({ queue, jobId }, 'duplicate job delivery skipped');
      return 'skipped_duplicate';
    }
    try {
      await handler(data);
      return 'processed';
    } catch (err) {
      try { await opts.store.release(queue, jobId); } catch { /* best effort */ }
      throw err;
    }
  };
}

/** Pick Redis when it answers, else memory. Mirrors the API's rate-limit driver selection. */
export async function createProcessedJobStore(redisUrl: string | undefined, driver: 'memory' | 'redis' | 'auto', log?: IdempotencyLogger): Promise<ProcessedJobStore> {
  if (driver === 'memory' || !redisUrl) return new MemoryProcessedJobStore();
  try {
    const { Redis } = await import('ioredis');
    const client = new Redis(redisUrl, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 1000 });
    client.on('error', (err: Error) => log?.warn({ err: err.message }, 'job idempotency redis error'));
    await client.connect();
    if ((await client.ping()) !== 'PONG') throw new Error('ping failed');
    return new RedisProcessedJobStore(client as unknown as RedisLike);
  } catch (err) {
    if (driver === 'redis') throw err;
    log?.warn({ err: err instanceof Error ? err.message : String(err) }, 'job idempotency: redis unavailable, using memory store');
    return new MemoryProcessedJobStore();
  }
}
