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

/**
 * In-memory queue (QUEUE_DRIVER=memory). Jobs are either handed to an in-process consumer registered with
 * `setMemoryQueueConsumer` (the workers package does this in `inproc` mode so dev runs still send notifications and
 * run reactions), or buffered for tests to inspect via `drainMemoryQueue`. The buffer is bounded: once it holds
 * MEMORY_QUEUE_MAX jobs the oldest are dropped and a warning is logged, so a long-lived process without a consumer
 * cannot grow without limit. Outside NODE_ENV=test a process that enqueues with no consumer attached logs a warning
 * once, because that configuration silently performs no background work.
 */
export const memoryQueue: QueuedJob[] = [];
export const MEMORY_QUEUE_MAX = 10_000;
export type MemoryQueueConsumer = (job: QueuedJob) => Promise<void>;
let memoryConsumer: MemoryQueueConsumer | null = null;
let memoryDropped = 0;
let warnedNoConsumer = false;
const redisQueues = new Map<string, Queue>();

/** Register (or clear with null) the in-process consumer for the memory driver. */
export function setMemoryQueueConsumer(consumer: MemoryQueueConsumer | null): void {
  memoryConsumer = consumer;
}
export function memoryQueueStats(): { buffered: number; dropped: number; consumerAttached: boolean } {
  return { buffered: memoryQueue.length, dropped: memoryDropped, consumerAttached: memoryConsumer !== null };
}

function enqueueMemory(job: QueuedJob): void {
  if (memoryConsumer) {
    const consumer = memoryConsumer;
    // Deliver off the request path; a failing consumer is logged, never surfaced to the caller (same as a BullMQ worker).
    setImmediate(() => { void consumer(job).catch((err) => logger.error({ err: err instanceof Error ? err.message : String(err), queue: job.name }, 'memory queue consumer failed')); });
    return;
  }
  if (!warnedNoConsumer && config().NODE_ENV !== 'test') {
    warnedNoConsumer = true;
    logger.warn({ queue: job.name }, 'QUEUE_DRIVER=memory with no in-process consumer: jobs are buffered, not processed (run the workers inproc entry or use QUEUE_DRIVER=redis)');
  }
  memoryQueue.push(job);
  if (memoryQueue.length > MEMORY_QUEUE_MAX) {
    memoryQueue.splice(0, memoryQueue.length - MEMORY_QUEUE_MAX);
    if (++memoryDropped % 1000 === 1) logger.warn({ dropped: memoryDropped, max: MEMORY_QUEUE_MAX }, 'memory queue full; oldest jobs dropped');
  }
}

export async function enqueue(queueName: string, data: Record<string, unknown>, opts: { jobId?: string; delay?: number } = {}): Promise<void> {
  if (config().QUEUE_DRIVER === 'memory') {
    enqueueMemory({ name: queueName, data, opts });
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
