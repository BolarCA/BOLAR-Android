import { Router } from 'express';
import { idParams, notification, notificationPage, notificationQuery, sendNotification } from '@bolar/contracts';
import { errors, toPage, decodeCursor } from '@bolar/shared';
import { defineRoute, mount, type RouteDef } from '../../shared/route.js';
import { tenantDb } from '../../shared/db.js';
import { notify, retry, notificationDto, renderForDisplay } from './service.js';

export { notify, retry, safeLogFields, notificationDto, type NotifyInput, type NotificationJobData } from './service.js';

/**
 * Notifications (Day 28). Recipients read their own; `notification:send` holders send, list all and retry.
 * Addresses are never returned; bodies are rendered on read for in-app display.
 */
export const notificationRoutes: RouteDef[] = [
  defineRoute({ method: 'get', path: '/notifications', operationId: 'listNotifications', summary: 'List notifications (own, or all with notification:send)', tags: ['notification'], auth: 'session',
    request: { query: notificationQuery }, responses: { 200: notificationPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const canSend = ctx.permissions.has('notification:send');
      const recipientId = canSend ? query.recipientId : ctx.actor!.userId;
      const rows = await tenantDb(ctx).notification.findMany({
        where: { ...(recipientId ? { recipientId } : {}), ...(query.status ? { status: query.status } : {}), ...(query.channel ? { channel: query.channel } : {}), ...(query.unread ? { readAt: null } : {}) },
        take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      const items = await Promise.all(page.items.map(async (n) => notificationDto(n, n.channel === 'in_app' || canSend ? await renderForDisplay(n) : undefined)));
      return { body: { ...page, items } };
    } }),

  defineRoute({ method: 'post', path: '/notifications', operationId: 'sendNotification', summary: 'Send a templated notification to a user (idempotent by idempotencyKey)', tags: ['notification'], auth: 'session', permission: 'notification:send',
    request: { body: sendNotification }, responses: { 201: notification },
    handler: async ({ body, ctx }) => {
      const n = await notify(ctx, body);
      return { status: 201, body: notificationDto(n, await renderForDisplay(n)) };
    } }),

  defineRoute({ method: 'post', path: '/notifications/:id/read', operationId: 'markNotificationRead', summary: 'Mark an in-app notification as read (recipient only)', tags: ['notification'], auth: 'session',
    request: { params: idParams }, responses: { 200: notification },
    handler: async ({ params, ctx }) => {
      const db = tenantDb(ctx);
      const n = await db.notification.findFirst({ where: { id: params.id, recipientId: ctx.actor!.userId } });
      if (!n) throw errors.notFound();
      const updated = n.readAt ? n : await db.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
      return { status: 200, body: notificationDto(updated, await renderForDisplay(updated)) };
    } }),

  defineRoute({ method: 'post', path: '/notifications/:id/retry', operationId: 'retryNotification', summary: 'Re-queue a failed delivery (attempts + 1)', tags: ['notification'], auth: 'session', permission: 'notification:send',
    request: { params: idParams }, responses: { 200: notification },
    handler: async ({ params, ctx }) => {
      const n = await tenantDb(ctx).notification.findFirst({ where: { id: params.id } });
      if (!n) throw errors.notFound();
      const updated = await retry(ctx, n);
      return { status: 200, body: notificationDto(updated) };
    } }),
];

export const notificationRouter: Router = Router();
mount(notificationRouter, notificationRoutes);
