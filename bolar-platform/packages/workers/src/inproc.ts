/**
 * Single-process mode for QUEUE_DRIVER=memory (local dev, demos without Redis): starts the API and consumes its
 * in-memory queue with the same handlers and idempotency guard the BullMQ workers use. Jobs never leave the process,
 * so this is for one API instance only; staging and production run `index.ts` against Redis.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) if (existsSync(c)) loadEnv({ path: c, quiet: true });
import { createApp, config, logger, setMemoryQueueConsumer, type QueuedJob } from '@bolar/api';
import { handlers } from './handlers/index.js';
import { MemoryProcessedJobStore, withIdempotency } from './idempotency.js';

const cfg = config();
if (cfg.QUEUE_DRIVER !== 'memory') throw new Error('inproc mode is for QUEUE_DRIVER=memory; run the BullMQ workers (index.ts) with Redis instead');

const store = new MemoryProcessedJobStore();
const runners = Object.fromEntries(Object.entries(handlers).map(([queue, handler]) => [
  queue,
  withIdempotency(queue, async (data: Record<string, unknown>) => handler(data as never, { logger: logger.child({ queue, inproc: true }) }), { store, ttlSeconds: 86_400, logger }),
]));

setMemoryQueueConsumer(async (job: QueuedJob) => {
  const run = runners[job.name];
  if (!run) { logger.warn({ queue: job.name }, 'no handler for queue'); return; }
  if (job.opts?.delay) await new Promise((r) => setTimeout(r, Math.min(job.opts!.delay!, 60_000)));
  await run(job.data, job.opts?.jobId ?? null);
});

const app = createApp();
const server = app.listen(cfg.API_PORT, () => logger.info({ port: cfg.API_PORT, queues: Object.keys(handlers) }, 'bolar-api listening with in-process workers (memory queue)'));
function shutdown() { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10_000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
