/**
 * BullMQ worker process (blueprint p9 "Workers"). Consumes domain events and job queues.
 * Handlers are registered per queue; each job is idempotent via its jobId and audited by the API when it mutates data.
 * Days 91-104: redelivered jobs are skipped by `withIdempotency` (processed-job markers in Redis, memory fallback)
 * and retries use the API's exponential backoff with jitter (queue options set by the producer).
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) if (existsSync(c)) loadEnv({ path: c, quiet: true });
import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { handlers } from './handlers/index.js';
import { createProcessedJobStore, withIdempotency } from './idempotency.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'bolar-workers' } });
const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

const idempotencyDriver = (process.env.QUEUE_DRIVER === 'memory' ? 'memory' : (process.env.WORKER_IDEMPOTENCY_DRIVER ?? 'auto')) as 'memory' | 'redis' | 'auto';
const processedJobs = await createProcessedJobStore(process.env.REDIS_URL ?? 'redis://localhost:6379', idempotencyDriver, logger);
const idempotencyTtl = Number(process.env.WORKER_IDEMPOTENCY_TTL_SECONDS ?? 86_400);

const workers = Object.entries(handlers).map(([queue, handler]) => {
  const run = withIdempotency(queue, async (job: Job) => handler(job.data as never, { logger: logger.child({ queue, jobId: job.id }) }), { store: processedJobs, ttlSeconds: idempotencyTtl, logger });
  const w = new Worker(queue, async (job: Job) => { await run(job, job.id); }, { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5) });
  w.on('failed', (job, err) => logger.error({ queue, jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message }, 'job failed'));
  w.on('completed', (job) => logger.debug({ queue, jobId: job.id }, 'job completed'));
  return w;
});
// Daily retention sweep proposes dispositions; nothing is deleted without a human approval (Day 47).
import('bullmq').then(async ({ Queue }) => {
  const q = new Queue('retention-sweep', { connection });
  await q.upsertJobScheduler('daily-retention-sweep', { pattern: process.env.RETENTION_SWEEP_CRON ?? '0 3 * * *' }, { name: 'retention-sweep', data: {} });
  await q.close();
}).catch((err) => logger.error({ err }, 'failed to schedule retention sweep'));
logger.info({ queues: Object.keys(handlers), idempotencyStore: processedJobs.kind }, 'bolar-workers started');

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  await processedJobs.close?.();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
