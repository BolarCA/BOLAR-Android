import { Router } from 'express';
import { idParams, legalHold, legalHoldPage, legalHoldQuery, createLegalHold, releaseLegalHold, legalHoldCheck, legalHoldCheckQuery, type LegalHoldScopeDto } from '@bolar/contracts';
import { errors, toPage, decodeCursor } from '@bolar/shared';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { isHeld, syncDocumentHoldFlags } from './service.js';

export { isHeld } from './service.js';

/** Validate that every scoped id belongs to the caller's org (never reference another tenant's records). */
async function validateScope(tenantOrgId: string, scope: LegalHoldScopeDto): Promise<void> {
  const check = async (ids: string[] | undefined, count: (ids: string[]) => Promise<number>, field: string) => {
    if (!ids?.length) return;
    const n = await count(ids);
    if (n !== new Set(ids).size) throw errors.validation([{ path: `body.scopeJson.${field}`, message: 'Unknown id in scope' }]);
  };
  await check(scope.propertyIds, (ids) => prisma.property.count({ where: { tenantOrgId, id: { in: ids } } }), 'propertyIds');
  await check(scope.leaseIds, (ids) => prisma.lease.count({ where: { tenantOrgId, id: { in: ids } } }), 'leaseIds');
  await check(scope.caseIds, (ids) => prisma.case.count({ where: { tenantOrgId, id: { in: ids } } }), 'caseIds');
  await check(scope.userIds, (ids) => prisma.userProfile.count({ where: { tenantOrgId, id: { in: ids } } }), 'userIds');
  await check(scope.documentIds, (ids) => prisma.document.count({ where: { tenantOrgId, id: { in: ids } } }), 'documentIds');
  await check(scope.tenantProfileIds, (ids) => prisma.tenantProfile.count({ where: { tenantOrgId, id: { in: ids } } }), 'tenantProfileIds');
}

export const legalHoldRoutes = [
  defineRoute({ method: 'get', path: '/legal-holds/check', operationId: 'checkLegalHold', summary: 'Is a resource (or a parent it belongs to) under an active legal hold?', tags: ['legal-hold'], auth: 'session',
    request: { query: legalHoldCheckQuery }, responses: { 200: legalHoldCheck },
    handler: async ({ query, ctx }) => ({ body: await isHeld(ctx.tenantOrgId!, query.resourceType, query.resourceId) }) }),

  defineRoute({ method: 'get', path: '/legal-holds', operationId: 'listLegalHolds', summary: 'List legal holds', tags: ['legal-hold'], auth: 'session', permission: 'legal_hold:read',
    request: { query: legalHoldQuery }, responses: { 200: legalHoldPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).legalHold.findMany({
        where: { ...(query.status ? { status: query.status } : {}), ...(query.caseId ? { scopeJson: { path: ['caseIds'], array_contains: [query.caseId] } } : {}) },
        take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      return { body: toDto(toPage(rows, query.limit)) };
    } }),

  defineRoute({ method: 'post', path: '/legal-holds', operationId: 'createLegalHold', summary: 'Create a legal hold scoped by property/lease/case/user/document/tenant profile (counsel note required)', tags: ['legal-hold'], auth: 'mfa', permission: 'legal_hold:write',
    request: { body: createLegalHold }, responses: { 201: legalHold },
    handler: async ({ body, ctx }) => {
      await validateScope(ctx.tenantOrgId!, body.scopeJson);
      const row = await tenantDb(ctx).legalHold.create({ data: { tenantOrgId: ctx.tenantOrgId!, name: body.name, reason: body.reason, scopeJson: body.scopeJson as object, status: 'active', approvedBy: ctx.actor!.userId, createdBy: ctx.actor!.userId } });
      const flagged = await syncDocumentHoldFlags(ctx.tenantOrgId!, body.scopeJson, true);
      await audit(ctx, { action: 'legal_hold.created', resourceType: 'legal_hold', resourceId: row.id, after: { name: row.name, scope: body.scopeJson, documentsFlagged: flagged }, metadata: { note: body.note } });
      await publish(ctx, 'legal_hold.created', { legalHoldId: row.id, scope: body.scopeJson });
      return { status: 201, body: toDto(row) };
    } }),

  defineRoute({ method: 'get', path: '/legal-holds/:id', operationId: 'getLegalHold', summary: 'Get a legal hold (access is logged)', tags: ['legal-hold'], auth: 'session', permission: 'legal_hold:read',
    request: { params: idParams }, responses: { 200: legalHold },
    handler: async ({ params, ctx }) => {
      const row = await tenantDb(ctx).legalHold.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      await audit(ctx, { action: 'legal_hold.accessed', resourceType: 'legal_hold', resourceId: row.id });
      return { body: toDto(row) };
    } }),

  defineRoute({ method: 'post', path: '/legal-holds/:id/release', operationId: 'releaseLegalHold', summary: 'Release a legal hold with counsel approval (releaser cannot be the creator)', tags: ['legal-hold'], auth: 'mfa', permission: 'legal_hold:release',
    request: { params: idParams, body: releaseLegalHold }, responses: { 200: legalHold },
    handler: async ({ params, body, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.legalHold.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (row.status !== 'active') throw errors.invalidTransition(row.status, 'released');
      if (row.createdBy === ctx.actor!.userId) throw errors.forbidden('A hold must be released by different counsel than the one who created it');
      const updated = await db.legalHold.update({ where: { id: row.id }, data: { status: 'released', releasedBy: ctx.actor!.userId, releasedAt: new Date() } });
      const cleared = await syncDocumentHoldFlags(ctx.tenantOrgId!, row.scopeJson as LegalHoldScopeDto, false);
      await audit(ctx, { action: 'legal_hold.released', resourceType: 'legal_hold', resourceId: row.id, before: { status: 'active' }, after: { status: 'released', documentsCleared: cleared }, metadata: { note: body.note } });
      await publish(ctx, 'legal_hold.released', { legalHoldId: row.id });
      return { status: 200, body: toDto(updated) };
    } }),
];

export const legalHoldRouter: Router = Router();
mount(legalHoldRouter, legalHoldRoutes);
