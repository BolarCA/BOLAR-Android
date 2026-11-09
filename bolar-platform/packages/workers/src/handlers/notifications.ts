import { createEmailAdapter, createSmsAdapter } from '@bolar/integrations';
import type { JobContext } from './index.js';

export interface NotificationJob { notificationId: string; channel: 'email' | 'sms' | 'in_app'; to: string; subject?: string; body: string; tenantOrgId: string; requestId: string }

/** Delivers a rendered notification through the configured adapter. Logs never include the recipient address or body. */
export async function notificationsHandler(job: NotificationJob, ctx: JobContext): Promise<void> {
  const adapterCtx = { requestId: job.requestId, tenantOrgId: job.tenantOrgId, actorId: null, idempotencyKey: job.notificationId };
  if (job.channel === 'email') {
    const r = await createEmailAdapter().execute({ to: job.to, subject: job.subject ?? '', text: job.body }, adapterCtx);
    ctx.logger.info({ notificationId: job.notificationId, accepted: r.accepted }, 'email dispatched');
  } else if (job.channel === 'sms') {
    const r = await createSmsAdapter().execute({ to: job.to, body: job.body }, adapterCtx);
    ctx.logger.info({ notificationId: job.notificationId, accepted: r.accepted }, 'sms dispatched');
  } else {
    ctx.logger.info({ notificationId: job.notificationId }, 'in-app notification stored by API; nothing to deliver');
  }
}
