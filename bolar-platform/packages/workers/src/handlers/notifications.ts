import { createEmailAdapter, createSmsAdapter } from '@bolar/integrations';
import { prisma } from '@bolar/db';
import type { JobContext } from './index.js';

export interface NotificationJob { notificationId: string; channel: 'email' | 'sms' | 'in_app'; to: string; subject?: string; body: string; tenantOrgId: string; requestId: string }

/**
 * Delivers a rendered notification through the configured adapter and records the delivery status.
 * Logs never include the recipient address or body; provider errors are stored trimmed of addresses.
 */
export async function notificationsHandler(job: NotificationJob, ctx: JobContext): Promise<void> {
  const adapterCtx = { requestId: job.requestId, tenantOrgId: job.tenantOrgId, actorId: null, idempotencyKey: job.notificationId };
  let accepted = false;
  let error: string | null = null;
  try {
    if (job.channel === 'email') {
      const r = await createEmailAdapter().execute({ to: job.to, subject: job.subject ?? '', text: job.body }, adapterCtx);
      accepted = r.accepted;
      ctx.logger.info({ notificationId: job.notificationId, accepted: r.accepted }, 'email dispatched');
    } else if (job.channel === 'sms') {
      const r = await createSmsAdapter().execute({ to: job.to, body: job.body }, adapterCtx);
      accepted = r.accepted;
      ctx.logger.info({ notificationId: job.notificationId, accepted: r.accepted }, 'sms dispatched');
    } else {
      ctx.logger.info({ notificationId: job.notificationId }, 'in-app notification stored by API; nothing to deliver');
      return;
    }
    if (!accepted) error = 'provider_rejected';
  } catch (err) {
    error = (err instanceof Error ? err.message : 'delivery_error').replace(job.to, '[redacted]').slice(0, 200);
    ctx.logger.warn({ notificationId: job.notificationId, channel: job.channel }, 'delivery failed');
  }
  await prisma.notification.updateMany({
    where: { id: job.notificationId, tenantOrgId: job.tenantOrgId },
    data: accepted ? { status: 'sent', sentAt: new Date(), attempts: { increment: 1 }, lastError: null } : { status: 'failed', attempts: { increment: 1 }, lastError: error ?? 'delivery_error' },
  });
  if (!accepted) throw new Error(`notification ${job.notificationId} delivery failed`);
}
