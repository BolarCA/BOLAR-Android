import { Router } from 'express';
import { idParams, notice, noticeWithGuard, noticePage, noticeQuery, createNotice, rejectNotice } from '@bolar/contracts';
import { errors, toPage, decodeCursor, type Permission, type RequestContext } from '@bolar/shared';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { unresolvedBlocks } from '../compliance/service.js';
import { createNoticeDraft, noticeMachine, type NoticeStatus } from './service.js';

/**
 * Notice module (Days 43-45). Drafting needs notice:draft; approval needs notice:approve and a different human than the
 * author; sending is allowed only from approved. Guard hits are attached to the notice and shown to the approver.
 */
async function requireNoticeReader(ctx: RequestContext): Promise<void> {
  if (!ctx.permissions.has('notice:draft') && !ctx.permissions.has('notice:approve') && !ctx.permissions.has('compliance:read')) {
    await audit(ctx, { action: 'access.denied', resourceType: 'notice', resourceId: null, outcome: 'deny', metadata: { permission: 'notice:draft|notice:approve', reason: 'no notice permission' } });
    throw errors.forbidden();
  }
}

async function withRecipient<T extends { recipientId: string }>(ctx: RequestContext, rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.recipientId))];
  const profiles = ids.length ? await tenantDb(ctx).tenantProfile.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }) : [];
  const names = new Map(profiles.map((p) => [p.id, p.displayName]));
  return rows.map((r) => ({ ...toDto(r), recipientName: names.get(r.recipientId) }));
}

async function transition(ctx: RequestContext, id: string, to: NoticeStatus, extra: Record<string, unknown> = {}) {
  const db = tenantDb(ctx);
  const row = await db.notice.findFirst({ where: { id } });
  if (!row) throw errors.notFound();
  noticeMachine.assertTransition(row.status as NoticeStatus, to, [...ctx.permissions] as Permission[]);
  const updated = await db.notice.update({ where: { id: row.id }, data: { status: to, ...extra } });
  await audit(ctx, { action: `notice.${to}`, resourceType: 'notice', resourceId: row.id, before: { status: row.status }, after: { status: to } });
  return { row, updated };
}

export const noticeRoutes = [
  defineRoute({ method: 'get', path: '/notices', operationId: 'listNotices', summary: 'List notices (drafters, approvers and compliance readers)', tags: ['notice'], auth: 'session',
    request: { query: noticeQuery }, responses: { 200: noticePage },
    handler: async ({ query, ctx }) => {
      await requireNoticeReader(ctx);
      const c = decodeCursor<{ id: string }>(query.cursor);
      const { cursor: _c, limit, ...filters } = query;
      const rows = await tenantDb(ctx).notice.findMany({ where: filters, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, limit);
      return { body: { ...page, items: await withRecipient(ctx, page.items) } };
    } }),
  defineRoute({ method: 'post', path: '/notices', operationId: 'createNotice', summary: 'Draft a notice from a template; guard and notice rules run before it can be submitted', tags: ['notice'], auth: 'mfa', permission: 'notice:draft',
    request: { body: createNotice }, responses: { 201: noticeWithGuard },
    handler: async ({ body, ctx }) => ({ status: 201, body: await createNoticeDraft(ctx, body) }) }),
  defineRoute({ method: 'get', path: '/notices/:id', operationId: 'getNotice', summary: 'Get a notice', tags: ['notice'], auth: 'session',
    request: { params: idParams }, responses: { 200: notice },
    handler: async ({ params, ctx }) => {
      await requireNoticeReader(ctx);
      const row = await tenantDb(ctx).notice.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      return { body: (await withRecipient(ctx, [row]))[0] };
    } }),
  defineRoute({ method: 'post', path: '/notices/:id/submit', operationId: 'submitNotice', summary: 'Submit a draft for approval (blocked while a block-level rule hit is unresolved)', tags: ['notice'], auth: 'mfa', permission: 'notice:draft',
    request: { params: idParams }, responses: { 200: notice },
    handler: async ({ params, ctx }) => {
      const blocks = await unresolvedBlocks(ctx, 'notice', params.id);
      if (blocks.length) throw errors.conflict(`Blocked by rule ${blocks.join(', ')}: resolve the compliance queue item before submitting`);
      const { updated } = await transition(ctx, params.id, 'pending_approval');
      return { status: 200, body: toDto(updated) };
    } }),
  defineRoute({ method: 'post', path: '/notices/:id/approve', operationId: 'approveNotice', summary: 'Approve a notice (approver cannot be the author)', tags: ['notice'], auth: 'mfa', permission: 'notice:approve',
    request: { params: idParams }, responses: { 200: notice },
    handler: async ({ params, ctx }) => {
      const existing = await tenantDb(ctx).notice.findFirst({ where: { id: params.id }, select: { createdBy: true } });
      if (!existing) throw errors.notFound();
      if (existing.createdBy === ctx.actor!.userId) throw errors.forbidden('You cannot approve a notice you drafted');
      const { updated } = await transition(ctx, params.id, 'approved', { approvedBy: ctx.actor!.userId, approvedAt: new Date() });
      await publish(ctx, 'notice.approved', { noticeId: updated.id, recipientId: updated.recipientId, templateKey: updated.templateKey });
      return { status: 200, body: toDto(updated) };
    } }),
  defineRoute({ method: 'post', path: '/notices/:id/reject', operationId: 'rejectNotice', summary: 'Reject a pending notice with a note', tags: ['notice'], auth: 'mfa', permission: 'notice:approve',
    request: { params: idParams, body: rejectNotice }, responses: { 200: notice },
    handler: async ({ params, body, ctx }) => {
      const { updated } = await transition(ctx, params.id, 'rejected');
      await audit(ctx, { action: 'notice.review_note', resourceType: 'notice', resourceId: updated.id, metadata: { note: body.note } });
      return { status: 200, body: toDto(updated) };
    } }),
  defineRoute({ method: 'post', path: '/notices/:id/send', operationId: 'sendNotice', summary: 'Mark an approved notice as sent and request delivery', tags: ['notice'], auth: 'mfa', permission: 'notice:draft',
    request: { params: idParams }, responses: { 200: notice },
    handler: async ({ params, ctx }) => {
      const { updated } = await transition(ctx, params.id, 'sent', { sentAt: new Date() });
      const recipient = await prisma.tenantProfile.findFirst({ where: { id: updated.recipientId, tenantOrgId: ctx.tenantOrgId! }, select: { userId: true } });
      if (recipient?.userId) await publish(ctx, 'notification.requested', { recipientUserId: recipient.userId, channel: 'email', templateKey: updated.templateKey, variables: { ...(updated.variables as Record<string, unknown>), noticeId: updated.id } });
      await publish(ctx, 'notice.sent', { noticeId: updated.id, recipientId: updated.recipientId, templateKey: updated.templateKey });
      return { status: 200, body: toDto(updated) };
    } }),
  defineRoute({ method: 'post', path: '/notices/:id/cancel', operationId: 'cancelNotice', summary: 'Cancel a notice that has not been sent', tags: ['notice'], auth: 'mfa', permission: 'notice:draft',
    request: { params: idParams }, responses: { 200: notice },
    handler: async ({ params, ctx }) => ({ status: 200, body: toDto((await transition(ctx, params.id, 'canceled')).updated) }) }),
  defineRoute({ method: 'post', path: '/notices/:id/reopen', operationId: 'reopenNotice', summary: 'Return a rejected notice to draft for edits', tags: ['notice'], auth: 'mfa', permission: 'notice:draft',
    request: { params: idParams }, responses: { 200: notice },
    handler: async ({ params, ctx }) => ({ status: 200, body: toDto((await transition(ctx, params.id, 'draft')).updated) }) }),
];

export const noticeRouter: Router = Router();
mount(noticeRouter, noticeRoutes);
