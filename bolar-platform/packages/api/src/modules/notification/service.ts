import { createHash } from 'node:crypto';
import { errors, type RequestContext } from '@bolar/shared';
import type { Notification } from '@bolar/db';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { enqueue } from '../../shared/queue.js';
import { toDto } from '../../shared/route.js';
import { logger } from '../../logger.js';
import { renderTemplateKey } from '../template/service.js';
import type { TemplateVariables } from '../template/render.js';

export type NotificationChannel = 'email' | 'sms' | 'in_app';

export interface NotifyInput {
  /** Portal user receiving the notification. Either this or recipientAddress is required. */
  recipientUserId?: string;
  /** External recipient (e.g. an invitee without an account yet). Stored as the address only. */
  recipientAddress?: string;
  channel: NotificationChannel;
  templateKey: string;
  variables?: TemplateVariables;
  /** Dedupe key; a repeated call returns the existing notification instead of sending twice. */
  idempotencyKey?: string;
}

/** Job shape consumed by packages/workers/src/handlers/notifications.ts. */
export interface NotificationJobData extends Record<string, unknown> {
  notificationId: string; channel: NotificationChannel; to: string; subject?: string; body: string; tenantOrgId: string; requestId: string;
}

/**
 * Fields safe to log for a notification: never the recipient address, the variables or the body.
 * Pino also redacts `recipientAddress` defensively (packages/api/src/logger.ts), but we do not rely on it.
 */
export function safeLogFields(n: Pick<Notification, 'id' | 'channel' | 'templateKey' | 'status' | 'attempts' | 'tenantOrgId'>): Record<string, string | number> {
  return { notificationId: n.id, channel: n.channel, templateKey: n.templateKey, status: n.status, attempts: n.attempts, tenantOrgId: n.tenantOrgId };
}

/** Public DTO: drops the address; variables are kept for in-app rendering by the recipient. */
export function notificationDto(n: Notification, rendered?: { subject: string | null; body: string }) {
  const { recipientAddress: _addr, ...rest } = n;
  return { ...toDto(rest), variables: (n.variables ?? {}) as Record<string, unknown>, ...(rendered ? { subject: rendered.subject, body: rendered.body } : {}) };
}

export function externalRecipientId(address: string): string {
  return `external:${createHash('sha256').update(address.trim().toLowerCase()).digest('hex').slice(0, 24)}`;
}

/** Resolve where to deliver: email from the user profile, phone from the linked tenant/vendor profile. */
export async function resolveAddress(tenantOrgId: string, channel: NotificationChannel, recipientUserId: string): Promise<{ address: string | null; reason?: string }> {
  const user = await prisma.userProfile.findFirst({ where: { id: recipientUserId, tenantOrgId }, select: { email: true, status: true } });
  if (!user) throw errors.validation([{ path: 'recipientUserId', message: 'Unknown recipient' }]);
  if (channel === 'in_app') return { address: null };
  if (channel === 'email') return user.status === 'active' || user.status === 'invited' ? { address: user.email } : { address: null, reason: `recipient_${user.status}` };
  const profile = await prisma.tenantProfile.findFirst({ where: { tenantOrgId, userId: recipientUserId, phone: { not: null } }, select: { phone: true } });
  if (profile?.phone) return { address: profile.phone };
  const vendor = await prisma.vendorProfile.findFirst({ where: { tenantOrgId, userId: recipientUserId, phone: { not: null } }, select: { phone: true } });
  return vendor?.phone ? { address: vendor.phone } : { address: null, reason: 'no_phone' };
}

async function enqueueDelivery(ctx: RequestContext, n: Notification, rendered: { subject: string | null; body: string }): Promise<void> {
  if (n.channel === 'in_app' || !n.recipientAddress) return;
  const data: NotificationJobData = { notificationId: n.id, channel: n.channel as NotificationChannel, to: n.recipientAddress, subject: rendered.subject ?? undefined, body: rendered.body, tenantOrgId: n.tenantOrgId, requestId: ctx.requestId };
  await enqueue('notifications', data, { jobId: `${n.id}:${n.attempts}` });
}

/**
 * NotificationService.notify (Day 28). Renders the approved template, persists the Notification
 * (queued / delivered for in_app / suppressed when no address), audits without PII and enqueues a
 * delivery job. Idempotent per `idempotencyKey`.
 */
export async function notify(ctx: RequestContext, input: NotifyInput): Promise<Notification> {
  if (!ctx.tenantOrgId) throw errors.forbidden('Tenant context required');
  const tenantOrgId = ctx.tenantOrgId;
  if (input.idempotencyKey) {
    const existing = await prisma.notification.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.tenantOrgId !== tenantOrgId) throw errors.idempotencyConflict();
      logger.info({ ...safeLogFields(existing), requestId: ctx.requestId }, 'notification deduplicated');
      return existing;
    }
  }
  if (!input.recipientUserId && !input.recipientAddress) throw errors.validation([{ path: 'recipientUserId', message: 'A recipient is required' }]);
  const vars = input.variables ?? {};
  const rendered = await renderTemplateKey(tenantOrgId, input.templateKey, vars);
  let address: string | null;
  let reason: string | undefined;
  let recipientId: string;
  if (input.recipientUserId) {
    recipientId = input.recipientUserId;
    ({ address, reason } = await resolveAddress(tenantOrgId, input.channel, input.recipientUserId));
  } else {
    recipientId = externalRecipientId(input.recipientAddress!);
    address = input.channel === 'in_app' ? null : input.recipientAddress!;
  }
  const status = input.channel === 'in_app' ? 'delivered' : address ? 'queued' : 'suppressed';
  const n = await prisma.notification.create({
    data: {
      tenantOrgId, channel: input.channel, recipientId, recipientAddress: address, templateKey: input.templateKey, variables: vars as object, status,
      attempts: 0, lastError: status === 'suppressed' ? (reason ?? 'no_address') : null, idempotencyKey: input.idempotencyKey ?? null, sentAt: status === 'delivered' ? new Date() : null,
    },
  });
  await audit(ctx, { action: 'notification.create', resourceType: 'notification', resourceId: n.id, outcome: status === 'suppressed' ? 'error' : 'allow', metadata: { channel: n.channel, templateKey: n.templateKey, templateVersion: rendered.version.version, status, recipientId, reason } });
  if (status === 'queued') await enqueueDelivery(ctx, n, rendered);
  logger.info({ ...safeLogFields(n), requestId: ctx.requestId }, 'notification created');
  return n;
}

/** Re-render and re-enqueue a failed/queued notification; attempts++ (Day 28 retry). */
export async function retry(ctx: RequestContext, n: Notification): Promise<Notification> {
  if (n.status === 'delivered' || n.status === 'sent') throw errors.conflict(`Notification is already ${n.status}`);
  if (n.channel === 'in_app' || !n.recipientAddress) throw errors.conflict('Nothing to deliver for this notification');
  const rendered = await renderTemplateKey(n.tenantOrgId, n.templateKey, (n.variables ?? {}) as TemplateVariables);
  const updated = await prisma.notification.update({ where: { id: n.id }, data: { attempts: { increment: 1 }, status: 'queued', lastError: null } });
  await enqueueDelivery(ctx, updated, rendered);
  await audit(ctx, { action: 'notification.retry', resourceType: 'notification', resourceId: n.id, before: { status: n.status, attempts: n.attempts }, after: { status: 'queued', attempts: updated.attempts } });
  logger.info({ ...safeLogFields(updated), requestId: ctx.requestId }, 'notification re-queued');
  return updated;
}

/** Render for display (in-app body); tolerant of a template that lost approval since creation. */
export async function renderForDisplay(n: Notification): Promise<{ subject: string | null; body: string } | undefined> {
  try {
    const r = await renderTemplateKey(n.tenantOrgId, n.templateKey, (n.variables ?? {}) as TemplateVariables);
    return { subject: r.subject, body: r.body };
  } catch {
    return undefined;
  }
}
