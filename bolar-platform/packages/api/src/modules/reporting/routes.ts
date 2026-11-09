import { Router } from 'express';
import type { z } from 'zod';
import {
  arAgingPage, collectionsPage, complianceHitsPage, createReportDefinition, idParams, maintenanceSlaPage, occupancyPage, refreshResponse, rentRollPage, reportDefinition, reportDefinitionPage,
  reportDefinitionQuery, reportKpis, reportListQuery, reportRun, reportRunDetail, reportRunPage, reportRunQuery, type ReportKind,
} from '@bolar/contracts';
import { createStorageAdapter } from '@bolar/integrations';
import { decodeCursor, errors, toPage, type RequestContext } from '@bolar/shared';
import { defineRoute, mount, toDto, type RouteDef } from '../../shared/route.js';
import { tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { enqueue } from '../../shared/queue.js';
import { config } from '../../config.js';
import { isReportingStaff, reportingScope, requireReportingStaff, type ReportScope } from './access.js';
import { collectionsByMonth, ensureFresh, headlineKpis, queryView, refreshReportingViews, runReportRun } from './service.js';

export { refreshReportingViews, runReportRun, runDueScheduledReports, cronMatchesDay } from './service.js';

/**
 * Reporting module (blueprint Days 75-90): KPI tables from governed materialized views, scheduled reports and exports.
 * Every read is filtered by tenantOrgId inside the service; landlords are narrowed to their properties; tenants are 403.
 */
const TAGS = ['reporting'];

type ListQuery = z.infer<typeof reportListQuery>;
function splitQuery(query: ListQuery) {
  const { limit, cursor, ...filters } = query;
  return { limit, cursor, filters };
}

function viewRoute(kind: ReportKind, path: string, operationId: string, summary: string, schema: z.ZodTypeAny, staffOnly = false): RouteDef {
  return defineRoute({
    method: 'get', path, operationId, summary, tags: TAGS, auth: 'session', permission: 'finance:read',
    request: { query: reportListQuery }, responses: { 200: schema },
    handler: async ({ query, ctx }) => {
      let scope: ReportScope;
      if (staffOnly) { await requireReportingStaff(ctx); scope = { kind: 'org' }; } else scope = await reportingScope(ctx);
      const { limit, cursor, filters } = splitQuery(query);
      const q = { tenantOrgId: ctx.tenantOrgId!, scope, filters, limit, cursor };
      const page = await queryView(kind, q);
      if (kind === 'collections') return { body: { ...page, byMonth: await collectionsByMonth(q), months: filters.months ?? 12 } };
      return { body: page };
    },
  });
}

/** Non-staff (landlords) see only the definitions and runs they created. */
function ownDefinitionFilter(ctx: RequestContext) {
  return isReportingStaff(ctx) ? {} : { createdBy: ctx.actor!.userId };
}

function definitionDto(row: { recipients: unknown; filtersJson: unknown; scopeJson: unknown } & Record<string, unknown>) {
  return toDto({ ...row, recipients: Array.isArray(row.recipients) ? row.recipients : [], filtersJson: (row.filtersJson ?? {}) as object, scopeJson: (row.scopeJson ?? null) as object | null });
}
function runDto(row: Record<string, unknown> & { definition?: { name: string; kind: string } | null }) {
  const { definition, ...rest } = row;
  return toDto({ ...rest, definitionName: definition?.name ?? null, kind: definition?.kind ?? null });
}

export const reportingRoutes: RouteDef[] = [
  defineRoute({ method: 'get', path: '/reports/kpis', operationId: 'getReportKpis', summary: 'Headline KPIs from the governed views with a freshness timestamp (refreshes inline when stale)', tags: TAGS, auth: 'session', permission: 'finance:read',
    responses: { 200: reportKpis },
    handler: async ({ ctx }) => {
      const scope = await reportingScope(ctx);
      await ensureFresh();
      return { body: await headlineKpis(ctx.tenantOrgId!, scope, isReportingStaff(ctx)) };
    } }),
  defineRoute({ method: 'post', path: '/reports/refresh', operationId: 'refreshReports', summary: 'Refresh every reporting materialized view (staff only)', tags: TAGS, auth: 'session', permission: 'finance:read',
    responses: { 200: refreshResponse },
    handler: async ({ ctx }) => {
      await requireReportingStaff(ctx);
      const r = await refreshReportingViews();
      await audit(ctx, { action: 'report.refresh', resourceType: 'report', metadata: { durationMs: r.durationMs, refreshedAt: r.refreshedAt } });
      return { status: 200, body: r };
    } }),

  viewRoute('rent_roll', '/reports/rent-roll', 'getRentRollReport', 'Rent roll: active leases with rent, unit and tenant (landlords: own properties)', rentRollPage),
  viewRoute('ar_aging', '/reports/ar-aging', 'getArAgingReport', 'AR aging: outstanding invoices bucketed by days past due (staff only)', arAgingPage, true),
  viewRoute('occupancy', '/reports/occupancy', 'getOccupancyReport', 'Occupancy by property (landlords: own properties)', occupancyPage),
  viewRoute('maintenance_sla', '/reports/maintenance-sla', 'getMaintenanceSlaReport', 'Maintenance SLA compliance by property and priority', maintenanceSlaPage),
  viewRoute('collections', '/reports/collections', 'getCollectionsReport', 'Monthly collections by property with ledger reconciliation (months=12 by default)', collectionsPage),
  viewRoute('compliance_hits', '/reports/compliance-hits', 'getComplianceHitsReport', 'Compliance hits by severity, result, resolution and domain (staff only)', complianceHitsPage, true),

  defineRoute({ method: 'get', path: '/reports/definitions', operationId: 'listReportDefinitions', summary: 'Scheduled report definitions (own for landlords, all for staff)', tags: TAGS, auth: 'session', permission: 'finance:read',
    request: { query: reportDefinitionQuery }, responses: { 200: reportDefinitionPage },
    handler: async ({ query, ctx }) => {
      await reportingScope(ctx);
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).reportDefinition.findMany({
        where: { ...ownDefinitionFilter(ctx), ...(query.kind ? { kind: query.kind } : {}), ...(query.status ? { status: query.status } : {}) },
        take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map(definitionDto) } };
    } }),
  defineRoute({ method: 'post', path: '/reports/definitions', operationId: 'createReportDefinition', summary: 'Create a report definition (kind, filters, cron schedule, recipients, csv|json). Landlord definitions are pinned to their properties.', tags: TAGS, auth: 'mfa', permission: 'finance:read',
    request: { body: createReportDefinition }, responses: { 201: reportDefinition },
    handler: async ({ body, ctx }) => {
      const scope = await reportingScope(ctx);
      const row = await tenantDb(ctx).reportDefinition.create({
        data: {
          tenantOrgId: ctx.tenantOrgId!, name: body.name, kind: body.kind, filtersJson: (body.filters ?? {}) as object, scopeJson: scope.kind === 'properties' ? { propertyIds: scope.propertyIds } : undefined,
          scheduleCron: body.scheduleCron ?? null, recipients: body.recipients, format: body.format, createdBy: ctx.actor!.userId,
        },
      });
      await audit(ctx, { action: 'report.definition_created', resourceType: 'report_definition', resourceId: row.id, after: { name: row.name, kind: row.kind, scheduleCron: row.scheduleCron, format: row.format, recipients: body.recipients.length, scope: scope.kind } });
      return { status: 201, body: definitionDto(row) };
    } }),
  defineRoute({ method: 'post', path: '/reports/definitions/:id/run', operationId: 'runReportDefinition', summary: 'Run a report definition now: creates a ReportRun and enqueues the `reports` job (inline when QUEUE_DRIVER=memory)', tags: TAGS, auth: 'mfa', permission: 'finance:read',
    request: { params: idParams }, responses: { 201: reportRun },
    handler: async ({ params, ctx }) => {
      await reportingScope(ctx);
      const db = tenantDb(ctx);
      const def = await db.reportDefinition.findFirst({ where: { id: params.id, ...ownDefinitionFilter(ctx) } });
      if (!def) throw errors.notFound();
      if (def.status !== 'active') throw errors.conflict('Paused definitions cannot run');
      const run = await db.reportRun.create({ data: { tenantOrgId: ctx.tenantOrgId!, definitionId: def.id, status: 'requested', format: def.format, trigger: 'manual', requestedBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'report.run_requested', resourceType: 'report_run', resourceId: run.id, after: { definitionId: def.id, kind: def.kind, format: def.format } });
      await enqueue('reports', { kind: 'run', reportRunId: run.id, tenantOrgId: ctx.tenantOrgId!, requestId: ctx.requestId }, { jobId: `report-run:${run.id}` });
      // Without Redis nothing drains the memory queue, so the run executes inline (dev/e2e). Workers consume it in redis mode.
      if (config().QUEUE_DRIVER === 'memory') await runReportRun(run.id);
      const fresh = await db.reportRun.findFirst({ where: { id: run.id }, include: { definition: { select: { name: true, kind: true } } } });
      return { status: 201, body: runDto(fresh ?? { ...run, definition: { name: def.name, kind: def.kind } }) };
    } }),
  defineRoute({ method: 'get', path: '/reports/runs', operationId: 'listReportRuns', summary: 'Report runs (own definitions for landlords, all for staff)', tags: TAGS, auth: 'session', permission: 'finance:read',
    request: { query: reportRunQuery }, responses: { 200: reportRunPage },
    handler: async ({ query, ctx }) => {
      await reportingScope(ctx);
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).reportRun.findMany({
        where: { definition: ownDefinitionFilter(ctx), ...(query.definitionId ? { definitionId: query.definitionId } : {}), ...(query.status ? { status: query.status } : {}) },
        include: { definition: { select: { name: true, kind: true } } }, take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map(runDto) } };
    } }),
  defineRoute({ method: 'get', path: '/reports/runs/:id', operationId: 'getReportRun', summary: 'Report run status with a short-lived signed download URL when complete', tags: TAGS, auth: 'session', permission: 'finance:read',
    request: { params: idParams }, responses: { 200: reportRunDetail },
    handler: async ({ params, ctx }) => {
      await reportingScope(ctx);
      const row = await tenantDb(ctx).reportRun.findFirst({ where: { id: params.id, definition: ownDefinitionFilter(ctx) }, include: { definition: { select: { name: true, kind: true } } } });
      if (!row) throw errors.notFound();
      let download: { url: string; expiresAt: string } | null = null;
      if (row.status === 'complete' && row.storageKey) {
        const signed = await createStorageAdapter().signedUrl(row.storageKey, 'GET', config().STORAGE_SIGNED_URL_TTL_SECONDS);
        download = { url: signed.url, expiresAt: signed.expiresAt };
        await audit(ctx, { action: 'report.downloaded', resourceType: 'report_run', resourceId: row.id, metadata: { sha256: row.sha256, rowCount: row.rowCount, storageKey: row.storageKey } });
      }
      return { body: { ...runDto(row), download } };
    } }),
];

export const reportingRouter: Router = Router();
mount(reportingRouter, reportingRoutes);
