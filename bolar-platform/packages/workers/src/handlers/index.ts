import type { Logger } from 'pino';
import { domainEventsHandler } from './domain-events.js';
import { notificationsHandler } from './notifications.js';

export interface JobContext { logger: Logger }
export type JobHandler<T = Record<string, unknown>> = (data: T, ctx: JobContext) => Promise<void>;

/** queue name -> handler. The API enqueues with the same names (packages/api/src/shared/queue.ts). */
export const handlers: Record<string, JobHandler<never>> = {
  'domain-events': domainEventsHandler as JobHandler<never>,
  notifications: notificationsHandler as JobHandler<never>,
};
