import { Queue } from 'bullmq';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface QueuedJob { name: string; data: Record<string, unknown>; opts?: { jobId?: string; delay?: number } }

export interface BackoffSettings { maxAttempts: number; baseMs: number; maxMs: number; jitter: number }

/** Retry policy from env (QUEUE_MAX_ATTEMPTS, QUEUE_BACKOFF_BASE_MS, QUEUE_BACKOFF_MAX_MS, QUEUE_BACKOFF_JITTER). */
export function backoffSettings(): BackoffSettings {
  const cfg = config();
  return { maxAttempts: cfg.QUEUE_MAX_ATTEMPTS, baseMs: cfg.QUEUE_BACKOFF_BASE_MS, maxMs: cfg.QUEUE_BACKOFF_MAX_MS, jitter: cfg.QUEUE_BACKOFF_JITTER };
}

/**
 * Exponential backoff with full jitter, capped: delay = min(maxMs, baseMs * 2^(attempt-1)) * (1 - jitter * rand).
 * `attempt` is 1-based (the first retry). Pure so it is unit-testable; BullMQ applies the same shape natively via
 * `backoff: { type: 'exponential', delay, jitter }` and this helper drives the memory driver and docs.
 */
export function backoffDelayMs(attempt: number, s: BackoffSettings = backoffSettings(), rand: () => number = Math.random): number {
  const a = Math.max(1, Math.floor(attempt));
  const raw = Math.min(s.maxMs, s.baseMs * 2 ** (a - 1));
  const r = Math.min(1, Math.max(0, rand()));
  return Math.round(raw * (1 - s.jitter * r));
}

/** In-memory queue for tests/dev without Redis; drained by tests via `drainMemoryQueue`. */
export const memoryQueue: QueuedJob[] = [];
const redisQueues = new Map<string, Queue>();

export async function enqueue(queueName: string, data: Record<string, unknown>, opts: { jobId?: string; delay?: number } = {}): Promise<void> {
  if (config().QUEUE_DRIVER === 'memory') {
    memoryQueue.push({ name: queueName, data, opts });
    return;
  }
  let q = redisQueues.get(queueName);
  if (!q) {
    q = new Queue(queueName, { connection: { url: config().REDIS_URL } });
    redisQueues.set(queueName, q);
  }
  try {
    const b = backoffSettings();
    await q.add(queueName, data, { jobId: opts.jobId, delay: opts.delay, attempts: b.maxAttempts, backoff: { type: 'exponential', delay: b.baseMs, jitter: b.jitter }, removeOnComplete: 1000, removeOnFail: 5000 });
  } catch (err) {
    logger.error({ err, queueName }, 'enqueue failed');
    throw err;
  }
}

export function drainMemoryQueue(queueName?: string): QueuedJob[] {
  const taken = memoryQueue.filter((j) => !queueName || j.name === queueName);
  for (const j of taken) memoryQueue.splice(memoryQueue.indexOf(j), 1);
  return taken;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...redisQueues.values()].map((q) => q.close()));
  redisQueues.clear();
}
