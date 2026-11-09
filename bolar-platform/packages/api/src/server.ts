import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { prisma } from './shared/db.js';
import { closeQueues } from './shared/queue.js';

const app = createApp();
const server = app.listen(config().API_PORT, () => logger.info({ port: config().API_PORT }, 'bolar-api listening'));

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await closeQueues();
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
