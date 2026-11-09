/**
 * BullMQ worker process (blueprint p9 "Workers"). Consumes domain events and job queues.
 * Handlers are registered per queue; each job is idempotent via its jobId and audited by the API when it mutates data.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) if (existsSync(c)) loadEnv({ path: c, quiet: true });
import { Worker, type Job } from 'bullmq';
import pino from 'pino';
import { handlers } from './handlers/index.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'bolar-workers' } });
const connection = { url: process.env.REDIS_URL ?? 'redis://localhost:6379' };

const workers = Object.entries(handlers).map(([queue, handler]) => {
  const w = new Worker(queue, async (job: Job) => handler(job.data as never, { logger: logger.child({ queue, jobId: job.id }) }), { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5) });
  w.on('failed', (job, err) => logger.error({ queue, jobId: job?.id, err: err.message }, 'job failed'));
  w.on('completed', (job) => logger.debug({ queue, jobId: job.id }, 'job completed'));
  return w;
});
// Daily retention sweep proposes dispositions; nothing is deleted without a human approval (Day 47).
import('bullmq').then(async ({ Queue }) => {
  const q = new Queue('retention-sweep', { connection });
  await q.upsertJobScheduler('daily-retention-sweep', { pattern: process.env.RETENTION_SWEEP_CRON ?? '0 3 * * *' }, { name: 'retention-sweep', data: {} });
  await q.close();
}).catch((err) => logger.error({ err }, 'failed to schedule retention sweep'));
// Daily reporting job: refresh the rpt_* materialized views and run scheduled report definitions due today (Days 75-90).
import('bullmq').then(async ({ Queue }) => {
  const q = new Queue('reports', { connection });
  await q.upsertJobScheduler('daily-reporting-refresh', { pattern: process.env.REPORTING_REFRESH_CRON ?? '0 4 * * *' }, { name: 'reports', data: { kind: 'daily' } });
  await q.close();
}).catch((err) => logger.error({ err }, 'failed to schedule daily reporting refresh'));
logger.info({ queues: Object.keys(handlers) }, 'bolar-workers started');

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
