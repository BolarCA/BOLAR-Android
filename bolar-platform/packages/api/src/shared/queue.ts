import { Queue } from 'bullmq';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface QueuedJob { name: string; data: Record<string, unknown>; opts?: { jobId?: string; delay?: number } }

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
    await q.add(queueName, data, { jobId: opts.jobId, delay: opts.delay, attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 });
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
