import { Router } from 'express';
import { z, idParams, paginationQuery, sensitiveAccessRequest, sensitiveAccessPage, createSensitiveAccessRequest, decideSensitiveAccess } from '@bolar/contracts';
import { errors, toPage, decodeCursor } from '@bolar/shared';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';

export const sensitiveAccessRoutes = [
  defineRoute({ method: 'get', path: '/sensitive-access/requests', operationId: 'listSensitiveAccessRequests', summary: 'List sensitive access requests (own, or all with approve permission)', tags: ['sensitive-access'], auth: 'session', permission: 'sensitive_access:request',
    request: { query: paginationQuery.extend({ status: z.enum(['pending', 'approved', 'denied', 'expired', 'revoked']).optional(), mine: z.coerce.boolean().optional() }) }, responses: { 200: sensitiveAccessPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const canApprove = ctx.permissions.has('sensitive_access:approve');
      const rows = await tenantDb(ctx).sensitiveAccessRequest.findMany({
        where: { ...(query.status ? { status: query.status } : {}), ...(!canApprove || query.mine ? { actorId: ctx.actor!.userId } : {}) },
        take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      return { body: toDto(toPage(rows, query.limit)) };
    } }),
  defineRoute({ method: 'post', path: '/sensitive-access/requests', operationId: 'createSensitiveAccessRequest', summary: 'Request time-boxed access to confidential or restricted data', tags: ['sensitive-access'], auth: 'mfa', permission: 'sensitive_access:request',
    request: { body: createSensitiveAccessRequest }, responses: { 201: sensitiveAccessRequest },
    handler: async ({ body, ctx }) => {
      const db = tenantDb(ctx);
      const open = await db.sensitiveAccessRequest.findFirst({ where: { actorId: ctx.actor!.userId, resourceType: body.resourceType, resourceId: body.resourceId, status: { in: ['pending', 'approved'] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
      if (open) throw errors.conflict(`An ${open.status} request already exists for this resource`);
      const row = await db.sensitiveAccessRequest.create({ data: { ...body, tenantOrgId: ctx.tenantOrgId!, actorId: ctx.actor!.userId } });
      await audit(ctx, { action: 'sensitive_access.request', resourceType: body.resourceType, resourceId: body.resourceId, outcome: 'review_required', metadata: { requestId: row.id, purpose: body.purpose, classification: body.classification } });
      await publish(ctx, 'sensitive_access.requested', { id: row.id, actorId: row.actorId, resourceType: row.resourceType });
      return { status: 201, body: toDto(row) };
    } }),
  defineRoute({ method: 'post', path: '/sensitive-access/requests/:id/decide', operationId: 'decideSensitiveAccessRequest', summary: 'Approve or deny a sensitive access request (approver cannot be the requester)', tags: ['sensitive-access'], auth: 'mfa', permission: 'sensitive_access:approve',
    request: { params: idParams, body: decideSensitiveAccess }, responses: { 200: sensitiveAccessRequest },
    handler: async ({ params, body, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.sensitiveAccessRequest.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (row.status !== 'pending') throw errors.conflict(`Request is already ${row.status}`);
      if (row.actorId === ctx.actor!.userId) throw errors.forbidden('You cannot approve your own request');
      const updated = await db.sensitiveAccessRequest.update({ where: { id: row.id }, data: { status: body.decision, approvedBy: ctx.actor!.userId, decidedAt: new Date(), expiresAt: body.decision === 'approved' ? new Date(Date.now() + body.ttlHours * 3_600_000) : null } });
      await audit(ctx, { action: `sensitive_access.${body.decision}`, resourceType: row.resourceType, resourceId: row.resourceId, metadata: { requestId: row.id, requester: row.actorId, ttlHours: body.ttlHours, note: body.note } });
      return { status: 200, body: toDto(updated) };
    } }),
  defineRoute({ method: 'post', path: '/sensitive-access/requests/:id/revoke', operationId: 'revokeSensitiveAccessRequest', summary: 'Revoke an approved access grant early', tags: ['sensitive-access'], auth: 'mfa', permission: 'sensitive_access:approve',
    request: { params: idParams }, responses: { 200: sensitiveAccessRequest },
    handler: async ({ params, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.sensitiveAccessRequest.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (row.status !== 'approved') throw errors.conflict(`Request is ${row.status}`);
      const updated = await db.sensitiveAccessRequest.update({ where: { id: row.id }, data: { status: 'revoked', expiresAt: new Date() } });
      await audit(ctx, { action: 'sensitive_access.revoked', resourceType: row.resourceType, resourceId: row.resourceId, metadata: { requestId: row.id } });
      return { status: 200, body: toDto(updated) };
    } }),
];
export const sensitiveAccessRouter: Router = Router();
mount(sensitiveAccessRouter, sensitiveAccessRoutes);
