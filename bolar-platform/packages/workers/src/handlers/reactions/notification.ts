import { prisma } from '@bolar/db';
import { notify, type NotifyInput } from '@bolar/api';
import { formatCents, systemContext, type DomainEvent } from '@bolar/shared';
import { onEvent } from '../registry.js';
import type { JobContext } from '../index.js';

/**
 * Notification reactions (Day 28): map domain events to templated notifications. Each reaction is
 * idempotent per `${requestId}:${templateKey}:${recipient}` so a redelivered event never double-sends.
 * Logs carry ids only, never addresses, names or bodies.
 */
type Payload = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length ? v : undefined);
const asVars = (v: unknown): Record<string, string | number | boolean> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string | number | boolean>) : {});

async function send(event: DomainEvent, ctx: JobContext, input: Omit<NotifyInput, 'idempotencyKey'>): Promise<void> {
  if (!event.tenantOrgId) return;
  const recipient = input.recipientUserId ?? (input.recipientAddress ? `ext:${input.recipientAddress.length}` : 'none');
  const idempotencyKey = `${event.requestId}:${input.templateKey}:${input.recipientUserId ?? input.recipientAddress ?? 'none'}`.slice(0, 160);
  try {
    const n = await notify(systemContext(event.tenantOrgId, event.requestId), { ...input, idempotencyKey });
    ctx.logger.info({ event: event.name, notificationId: n.id, status: n.status, templateKey: input.templateKey, recipientId: recipient.startsWith('ext:') ? 'external' : recipient }, 'notification reaction');
  } catch (err) {
    ctx.logger.warn({ event: event.name, templateKey: input.templateKey, err: err instanceof Error ? err.message : 'unknown' }, 'notification reaction failed');
  }
}

onEvent('invitation.created', async (event, ctx) => {
  const p = event.payload as Payload;
  const inv = str(p.invitationId) ? await prisma.invitation.findFirst({ where: { id: str(p.invitationId)!, tenantOrgId: event.tenantOrgId ?? '' }, include: { tenantOrg: { select: { name: true } } } }) : null;
  if (!inv) return;
  await send(event, ctx, { recipientAddress: inv.email, channel: 'email', templateKey: str(p.templateKey) ?? 'invite.staff', variables: { orgName: inv.tenantOrg.name, name: inv.email.split('@')[0] ?? 'there', acceptUrl: str(p.acceptUrl) ?? '', expiresAt: inv.expiresAt.toISOString().slice(0, 10) } });
});

onEvent('work_order.created', async (event, ctx) => {
  const p = event.payload as Payload;
  const id = str(p.workOrderId) ?? str(p.id);
  const wo = id ? await prisma.workOrder.findFirst({ where: { id, tenantOrgId: event.tenantOrgId ?? '' } }) : null;
  if (!wo) return;
  const user = await prisma.userProfile.findFirst({ where: { id: wo.requesterId, tenantOrgId: wo.tenantOrgId }, select: { name: true } });
  await send(event, ctx, { recipientUserId: wo.requesterId, channel: 'email', templateKey: 'workorder.created', variables: { name: user?.name ?? 'there', workOrderId: wo.id, title: wo.title, priority: wo.priority } });
});

onEvent('invoice.issued', async (event, ctx) => {
  const p = event.payload as Payload;
  const id = str(p.invoiceId) ?? str(p.id);
  const inv = id ? await prisma.invoice.findFirst({ where: { id, tenantOrgId: event.tenantOrgId ?? '' } }) : null;
  if (!inv) return;
  const profile = inv.tenantProfileId ? await prisma.tenantProfile.findFirst({ where: { id: inv.tenantProfileId }, select: { userId: true, displayName: true } }) : null;
  if (!profile?.userId) { ctx.logger.info({ event: event.name, invoiceId: inv.id }, 'invoice recipient has no portal user; skipped'); return; }
  await send(event, ctx, { recipientUserId: profile.userId, channel: 'email', templateKey: 'invoice.issued', variables: { name: profile.displayName, number: inv.number, amount: formatCents(inv.totalCents), dueDate: inv.dueDate.toISOString().slice(0, 10) } });
});

onEvent('notice.approved', async (event, ctx) => {
  const p = event.payload as Payload;
  const id = str(p.noticeId) ?? str(p.id);
  const notice = id ? await prisma.notice.findFirst({ where: { id, tenantOrgId: event.tenantOrgId ?? '' } }) : null;
  const templateKey = str(p.templateKey) ?? notice?.templateKey;
  if (!templateKey) return;
  let recipientUserId = str(p.recipientUserId);
  if (!recipientUserId && notice) {
    const profile = await prisma.tenantProfile.findFirst({ where: { id: notice.recipientId }, select: { userId: true } });
    recipientUserId = profile?.userId ?? undefined;
  }
  if (!recipientUserId) { ctx.logger.info({ event: event.name, noticeId: id }, 'notice recipient has no portal user; skipped'); return; }
  await send(event, ctx, { recipientUserId, channel: (str(p.channel) as NotifyInput['channel']) ?? 'email', templateKey, variables: { ...asVars(notice?.variables), ...asVars(p.variables) } });
});

onEvent('privacy_request.received', async (event, ctx) => {
  const p = event.payload as Payload;
  const id = str(p.privacyRequestId) ?? str(p.id);
  const pr = id ? await prisma.privacyRequest.findFirst({ where: { id, tenantOrgId: event.tenantOrgId ?? '' } }) : null;
  if (!pr) return;
  const user = await prisma.userProfile.findFirst({ where: { tenantOrgId: pr.tenantOrgId, email: pr.subjectEmail }, select: { id: true } });
  const variables = { requestId: pr.id, kind: pr.kind, receivedAt: pr.createdAt.toISOString().slice(0, 10), dueAt: pr.dueAt.toISOString().slice(0, 10) };
  await send(event, ctx, { ...(user ? { recipientUserId: user.id } : { recipientAddress: pr.subjectEmail }), channel: 'email', templateKey: 'privacy.confirmation', variables });
});

onEvent('notification.requested', async (event, ctx) => {
  const p = event.payload as Payload;
  const recipientUserId = str(p.recipientUserId);
  const templateKey = str(p.templateKey);
  const channel = str(p.channel) as NotifyInput['channel'] | undefined;
  if (!recipientUserId || !templateKey || !channel) { ctx.logger.warn({ event: event.name }, 'notification.requested missing fields; skipped'); return; }
  await send(event, ctx, { recipientUserId, channel, templateKey, variables: asVars(p.variables) });
});
