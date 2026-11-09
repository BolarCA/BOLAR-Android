import { Router } from 'express';
import { auditPage, auditQuery } from '@bolar/contracts';
import { toPage, decodeCursor } from '@bolar/shared';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';

/** Audit query API (Days 15/46). Sensitive outcomes (before/after payloads) are hidden without audit:read_sensitive. */
export const auditRoutes = [
  defineRoute({ method: 'get', path: '/audit', operationId: 'listAuditLogs', summary: 'Query the append-only audit log for the org', tags: ['audit'], auth: 'mfa', permission: 'audit:read',
    request: { query: auditQuery }, responses: { 200: auditPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await prisma.auditLog.findMany({
        where: {
          tenantOrgId: ctx.tenantOrgId!,
          ...(query.actorId ? { actorId: query.actorId } : {}),
          ...(query.action ? { action: { startsWith: query.action } } : {}),
          ...(query.resourceType ? { resourceType: query.resourceType } : {}),
          ...(query.resourceId ? { resourceId: query.resourceId } : {}),
          ...(query.outcome ? { outcome: query.outcome } : {}),
          ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
        },
        take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const full = ctx.permissions.has('audit:read_sensitive');
      const page = toPage(rows, query.limit);
      await audit(ctx, { action: 'audit.query', resourceType: 'audit_log', metadata: { filters: { ...query, cursor: undefined }, full } });
      return { body: { ...page, items: page.items.map((r) => toDto(full ? r : { ...r, before: null, after: null, ip: null })) } };
    } }),
];
export const auditRouter: Router = Router();
mount(auditRouter, auditRoutes);
