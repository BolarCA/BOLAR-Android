import { Router } from 'express';
import { idParams, exportJob, exportJobDetail, exportJobPage, exportJobQuery, createExportJob, exportDecision, auditExportQuery, auditExportManifest } from '@bolar/contracts';
import { createStorageAdapter } from '@bolar/integrations';
import { errors, toPage, decodeCursor, type RequestContext } from '@bolar/shared';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { enqueue } from '../../shared/queue.js';
import { config } from '../../config.js';
import { buildAuditManifest, runExportJob } from './service.js';

export { runExportJob } from './service.js';

/** Requesters see their own jobs; approvers (counsel, org admins) see all. Others get 404 on detail. */
function ownFilter(ctx: RequestContext) {
  return ctx.permissions.has('export:approve') ? {} : { requestedBy: ctx.actor!.userId };
}

async function assertSourceExists(tenantOrgId: string, sourceType: string, sourceId: string): Promise<void> {
  const exists =
    sourceType === 'case' ? await prisma.case.findFirst({ where: { id: sourceId, tenantOrgId }, select: { id: true } })
    : sourceType === 'lease' ? await prisma.lease.findFirst({ where: { id: sourceId, tenantOrgId }, select: { id: true } })
    : sourceType === 'property' ? await prisma.property.findFirst({ where: { id: sourceId, tenantOrgId }, select: { id: true } })
    : sourceType === 'tenant_profile' ? await prisma.tenantProfile.findFirst({ where: { id: sourceId, tenantOrgId }, select: { id: true } })
    : sourceType === 'agency_request' ? await prisma.agencyRequest.findFirst({ where: { id: sourceId, tenantOrgId }, select: { id: true } })
    : await prisma.privacyRequest.findFirst({ where: { id: sourceId, tenantOrgId }, select: { id: true } });
  if (!exists) throw errors.validation([{ path: 'body.sourceId', message: 'Unknown source record' }]);
}

export const packetExportRoutes = [
  defineRoute({ method: 'get', path: '/exports', operationId: 'listExportJobs', summary: 'List export jobs (own, or all with export:approve)', tags: ['packet-export'], auth: 'session', permission: 'export:request',
    request: { query: exportJobQuery }, responses: { 200: exportJobPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).exportJob.findMany({
        where: { ...ownFilter(ctx), ...(query.status ? { status: query.status } : {}), ...(query.kind ? { kind: query.kind } : {}), ...(query.sourceType ? { sourceType: query.sourceType } : {}), ...(query.sourceId ? { sourceId: query.sourceId } : {}) },
        take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map((r) => toDto({ ...r, manifestJson: null })) } };
    } }),
  defineRoute({ method: 'post', path: '/exports', operationId: 'requestExport', summary: 'Request an evidence/agency/privacy packet export (gated: approval required before it runs)', tags: ['packet-export'], auth: 'mfa', permission: 'export:request',
    request: { body: createExportJob }, responses: { 201: exportJob },
    handler: async ({ body, ctx }) => {
      await assertSourceExists(ctx.tenantOrgId!, body.sourceType, body.sourceId);
      if (body.sourceType === 'case') {
        // Privileged cases: only someone who can open the case may request its packet.
        const c = await prisma.case.findFirst({ where: { id: body.sourceId, tenantOrgId: ctx.tenantOrgId! } });
        const edge = await prisma.relationshipEdge.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, subjectType: 'user', subjectId: ctx.actor!.userId, relation: 'represents', objectType: 'case', objectId: body.sourceId, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } });
        const scoped = ctx.roles.some((r) => r.scopeType === 'case' && r.scopeId === body.sourceId);
        if (c?.privileged && c.leadLawyerId !== ctx.actor!.userId && c.createdBy !== ctx.actor!.userId && !edge && !scoped) {
          await audit(ctx, { action: 'access.denied', resourceType: 'case', resourceId: body.sourceId, outcome: 'deny', metadata: { permission: 'export:request', reason: 'privileged case not represented' } });
          throw errors.notFound();
        }
      }
      const row = await tenantDb(ctx).exportJob.create({ data: { tenantOrgId: ctx.tenantOrgId!, kind: body.kind, sourceType: body.sourceType, sourceId: body.sourceId, status: 'requested', filtersJson: (body.filters ?? { includeAudit: true }) as object, redactionJson: (body.redaction ?? { fields: [] }) as object, requestedBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'export.requested', resourceType: 'export_job', resourceId: row.id, after: { kind: row.kind, sourceType: row.sourceType, sourceId: row.sourceId, redaction: body.redaction?.fields ?? [] } });
      await publish(ctx, 'export.requested', { exportJobId: row.id, kind: row.kind, sourceType: row.sourceType, sourceId: row.sourceId });
      return { status: 201, body: toDto(row) };
    } }),
  defineRoute({ method: 'get', path: '/exports/:id', operationId: 'getExportJob', summary: 'Export job with manifest and a short-lived download link when complete', tags: ['packet-export'], auth: 'session', permission: 'export:request',
    request: { params: idParams }, responses: { 200: exportJobDetail },
    handler: async ({ params, ctx }) => {
      const row = await tenantDb(ctx).exportJob.findFirst({ where: { id: params.id, ...ownFilter(ctx) } });
      if (!row) throw errors.notFound();
      let download: { url: string; expiresAt: string } | null = null;
      if (row.status === 'complete' && row.storageKey) {
        const signed = await createStorageAdapter().signedUrl(row.storageKey, 'GET', config().STORAGE_SIGNED_URL_TTL_SECONDS);
        download = { url: signed.url, expiresAt: signed.expiresAt };
        await audit(ctx, { action: 'export.downloaded', resourceType: 'export_job', resourceId: row.id, metadata: { manifestSha256: row.manifestSha256 } });
      }
      return { body: { ...toDto(row), download } };
    } }),
  defineRoute({ method: 'post', path: '/exports/:id/approve', operationId: 'approveExport', summary: 'Approve an export (approver cannot be the requester); the job then runs in the background', tags: ['packet-export'], auth: 'mfa', permission: 'export:approve',
    request: { params: idParams, body: exportDecision }, responses: { 200: exportJob },
    handler: async ({ params, body, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.exportJob.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (row.status !== 'requested') throw errors.invalidTransition(row.status, 'approved');
      if (row.requestedBy === ctx.actor!.userId) throw errors.forbidden('You cannot approve an export you requested');
      const updated = await db.exportJob.update({ where: { id: row.id }, data: { status: 'approved', approvedBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'export.approved', resourceType: 'export_job', resourceId: row.id, before: { status: 'requested' }, after: { status: 'approved' }, metadata: { note: body.note } });
      await enqueue('exports', { exportJobId: row.id, tenantOrgId: ctx.tenantOrgId!, requestId: ctx.requestId }, { jobId: `export:${row.id}` });
      // Without Redis nothing drains the memory queue, so the job runs inline (dev/e2e). Workers consume it in redis mode.
      if (config().QUEUE_DRIVER === 'memory') await runExportJob(row.id);
      const fresh = await db.exportJob.findFirst({ where: { id: row.id } });
      return { status: 200, body: toDto({ ...(fresh ?? updated), manifestJson: null }) };
    } }),
  defineRoute({ method: 'post', path: '/exports/:id/deny', operationId: 'denyExport', summary: 'Deny an export request', tags: ['packet-export'], auth: 'mfa', permission: 'export:approve',
    request: { params: idParams, body: exportDecision }, responses: { 200: exportJob },
    handler: async ({ params, body, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.exportJob.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (row.status !== 'requested') throw errors.invalidTransition(row.status, 'denied');
      if (row.requestedBy === ctx.actor!.userId) throw errors.forbidden('You cannot decide an export you requested');
      const updated = await db.exportJob.update({ where: { id: row.id }, data: { status: 'denied', approvedBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'export.denied', resourceType: 'export_job', resourceId: row.id, before: { status: 'requested' }, after: { status: 'denied' }, metadata: { note: body.note } });
      return { status: 200, body: toDto(updated) };
    } }),
  defineRoute({ method: 'get', path: '/audit/export', operationId: 'exportAuditManifest', summary: 'Audit manifest for a resource: rows plus sha256 over the serialized rows', tags: ['audit', 'packet-export'], auth: 'mfa', permission: 'audit:read',
    request: { query: auditExportQuery }, responses: { 200: auditExportManifest },
    handler: async ({ query, ctx }) => {
      const manifest = await buildAuditManifest(ctx, query.resourceType, query.resourceId, query.limit);
      await audit(ctx, { action: 'audit.export', resourceType: query.resourceType, resourceId: query.resourceId, metadata: { count: manifest.count, sha256: manifest.sha256 } });
      return { body: manifest };
    } }),
];

export const packetExportRouter: Router = Router();
mount(packetExportRouter, packetExportRoutes);
