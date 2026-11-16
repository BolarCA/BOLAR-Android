import { createHash } from 'node:crypto';
import { Prisma } from '@bolar/db';
import { createStorageAdapter } from '@bolar/integrations';
import { REPORT_KINDS, type ReportFiltersDto, type ReportKind } from '@bolar/contracts';
import { decodeCursor, encodeCursor, systemContext, type RequestContext } from '@bolar/shared';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { logger } from '../../logger.js';
import { narrowScope, scopeSql, type ReportScope } from './access.js';

/**
 * Reporting service (blueprint Days 75-90). Reads the governed materialized views (rpt_*) created by the
 * `reporting_views` migration. Every statement carries `"tenantOrgId" = <org>`; nothing here reads a view unfiltered.
 * Definitions and reconciliation rules: docs/metrics-definitions.md.
 */

export const STALE_SECONDS = Number(process.env.REPORTING_STALE_SECONDS ?? 900);
/** Hard cap for exports: enough for a large portfolio, never unbounded. */
export const EXPORT_MAX_ROWS = 10_000;
const BATCH = 500;

// ───────── freshness and refresh ─────────
let refreshing: Promise<{ refreshedAt: string; durationMs: number }> | null = null;

/** Refresh every rpt_* view concurrently (readers never block). Coalesces concurrent callers onto one refresh. */
export async function refreshReportingViews(): Promise<{ refreshedAt: string; durationMs: number }> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const started = Date.now();
    await prisma.$executeRaw`SELECT rpt_refresh_all()`;
    const fresh = await reportingFreshness();
    return { refreshedAt: (fresh ?? new Date()).toISOString(), durationMs: Date.now() - started };
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export async function reportingFreshness(): Promise<Date | null> {
  const rows = await prisma.$queryRaw<{ refreshedAt: Date }[]>`SELECT "refreshedAt" FROM rpt_freshness LIMIT 1`;
  return rows[0]?.refreshedAt ?? null;
}

/** Refresh when the views are older than STALE_SECONDS; returns the freshness timestamp. */
export async function ensureFresh(): Promise<Date | null> {
  const fresh = await reportingFreshness();
  if (fresh && Date.now() - fresh.getTime() < STALE_SECONDS * 1000) return fresh;
  const r = await refreshReportingViews();
  return new Date(r.refreshedAt);
}

// ───────── row normalisation ─────────
type Raw = Record<string, unknown>;
function num(v: unknown): number {
  if (typeof v === 'bigint') return Number(v);
  if (v && typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function') return (v as { toNumber: () => number }).toNumber();
  if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return typeof v === 'number' ? v : 0;
}
function normalize(row: Raw): Raw {
  const out: Raw = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'bigint') out[k] = Number(v);
    else if (v instanceof Date) out[k] = k === 'month' ? v.toISOString().slice(0, 10) : v.toISOString();
    else if (v && typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function') out[k] = (v as { toNumber: () => number }).toNumber();
    else out[k] = v;
  }
  return out;
}

function dateSql(column: string, from?: string, to?: string): Prisma.Sql {
  let sql = Prisma.empty;
  if (from) sql = Prisma.sql`${sql} AND ${Prisma.raw(column)} >= ${new Date(from)}`;
  if (to) sql = Prisma.sql`${sql} AND ${Prisma.raw(column)} <= ${new Date(to)}`;
  return sql;
}

export interface ViewQuery { tenantOrgId: string; scope: ReportScope; filters: ReportFiltersDto; limit: number; cursor?: string }
export interface ViewPage<T> { items: T[]; nextCursor: string | null; totals: Record<string, unknown>; refreshedAt: string | null }

interface KindSpec {
  view: string;
  idOf: (row: Raw) => string;
  /** WHERE fragment beyond tenant + property scope. */
  where: (f: ReportFiltersDto) => Prisma.Sql;
  /** Column used for the property scope filter; null for views without a property dimension. */
  propertyColumn: string | null;
  order: 'asc' | 'desc';
  totals: (q: ViewQuery, where: Prisma.Sql) => Promise<Record<string, unknown>>;
  /** Column order for CSV exports. */
  columns: string[];
}

const monthsBack = (months: number) => Prisma.sql` AND month >= (date_trunc('month', now()) - make_interval(months => ${months - 1}::int))::date`;

const SPECS: Record<ReportKind, KindSpec> = {
  rent_roll: {
    view: 'rpt_rent_roll', propertyColumn: '"propertyId"', order: 'asc', idOf: (r) => String(r.leaseId),
    where: (f) => Prisma.sql`${f.from ? Prisma.sql` AND "endDate" >= ${new Date(f.from)}` : Prisma.empty}${f.to ? Prisma.sql` AND "startDate" <= ${new Date(f.to)}` : Prisma.empty}`,
    totals: async (q, where) => {
      const [t] = await prisma.$queryRaw<Raw[]>`SELECT COUNT(*)::int AS leases, COALESCE(SUM("rentCents"), 0)::bigint AS "rentCents" FROM rpt_rent_roll WHERE "tenantOrgId" = ${q.tenantOrgId}${where}`;
      return { leases: num(t?.leases), rentCents: num(t?.rentCents) };
    },
    columns: ['leaseId', 'propertyName', 'unitNumber', 'tenantName', 'status', 'startDate', 'endDate', 'rentCents', 'depositCents', 'targetRentCents', 'propertyId', 'unitId', 'tenantProfileId'],
  },
  ar_aging: {
    view: 'rpt_ar_aging', propertyColumn: '"propertyId"', order: 'asc', idOf: (r) => String(r.invoiceId),
    where: (f) => Prisma.sql`${dateSql('"dueDate"', f.from, f.to)}${f.bucket ? Prisma.sql` AND bucket = ${f.bucket}` : Prisma.empty}`,
    totals: async (q, where) => {
      const [t] = await prisma.$queryRaw<Raw[]>`SELECT
          COALESCE(SUM("balanceCents") FILTER (WHERE bucket = 'current'), 0)::bigint AS "currentCents",
          COALESCE(SUM("balanceCents") FILTER (WHERE bucket = '1_30'), 0)::bigint AS "d1to30Cents",
          COALESCE(SUM("balanceCents") FILTER (WHERE bucket = '31_60'), 0)::bigint AS "d31to60Cents",
          COALESCE(SUM("balanceCents") FILTER (WHERE bucket = '61_90'), 0)::bigint AS "d61to90Cents",
          COALESCE(SUM("balanceCents") FILTER (WHERE bucket = '90_plus'), 0)::bigint AS "d90PlusCents",
          COALESCE(SUM("balanceCents"), 0)::bigint AS "totalCents", COUNT(*)::int AS invoices
        FROM rpt_ar_aging WHERE "tenantOrgId" = ${q.tenantOrgId}${where}`;
      return Object.fromEntries(Object.entries(t ?? {}).map(([k, v]) => [k, num(v)]));
    },
    columns: ['invoiceId', 'number', 'status', 'propertyName', 'unitNumber', 'tenantName', 'dueDate', 'daysPastDue', 'bucket', 'totalCents', 'paidCents', 'balanceCents', 'propertyId', 'leaseId', 'tenantProfileId'],
  },
  occupancy: {
    view: 'rpt_occupancy', propertyColumn: '"propertyId"', order: 'asc', idOf: (r) => String(r.propertyId),
    where: () => Prisma.empty,
    totals: async (q, where) => {
      const [t] = await prisma.$queryRaw<Raw[]>`SELECT COUNT(*)::int AS properties, COALESCE(SUM("totalUnits"), 0)::int AS "totalUnits", COALESCE(SUM("occupiedUnits"), 0)::int AS "occupiedUnits", COALESCE(SUM("scheduledRentCents"), 0)::bigint AS "scheduledRentCents" FROM rpt_occupancy WHERE "tenantOrgId" = ${q.tenantOrgId}${where}`;
      const totalUnits = num(t?.totalUnits); const occupiedUnits = num(t?.occupiedUnits);
      return { properties: num(t?.properties), totalUnits, occupiedUnits, occupancyPct: totalUnits ? Math.round((occupiedUnits / totalUnits) * 10000) / 100 : 0, scheduledRentCents: num(t?.scheduledRentCents) };
    },
    columns: ['propertyId', 'propertyName', 'city', 'state', 'propertyStatus', 'totalUnits', 'occupiedUnits', 'vacantUnits', 'noticeUnits', 'otherUnits', 'occupancyPct', 'activeLeases', 'scheduledRentCents', 'targetRentCents'],
  },
  maintenance_sla: {
    view: 'rpt_maintenance_sla', propertyColumn: '"propertyId"', order: 'asc', idOf: (r) => `${r.propertyId}:${r.priority}`,
    where: (f) => (f.priority ? Prisma.sql` AND priority = ${f.priority}` : Prisma.empty),
    totals: async (q, where) => {
      const [t] = await prisma.$queryRaw<Raw[]>`SELECT COALESCE(SUM("totalOrders"), 0)::int AS "totalOrders", COALESCE(SUM("openOrders"), 0)::int AS "openOrders", COALESCE(SUM("completedOrders"), 0)::int AS "completedOrders", COALESCE(SUM("completedWithinSla"), 0)::int AS "completedWithinSla", COALESCE(SUM("breachedOpen"), 0)::int AS "breachedOpen" FROM rpt_maintenance_sla WHERE "tenantOrgId" = ${q.tenantOrgId}${where}`;
      const completed = num(t?.completedOrders); const within = num(t?.completedWithinSla);
      return { totalOrders: num(t?.totalOrders), openOrders: num(t?.openOrders), completedOrders: completed, completedWithinSla: within, breachedOpen: num(t?.breachedOpen), slaCompliancePct: completed ? Math.round((within / completed) * 10000) / 100 : 0 };
    },
    columns: ['propertyId', 'propertyName', 'priority', 'totalOrders', 'openOrders', 'completedOrders', 'measuredOrders', 'completedWithinSla', 'completedLate', 'breachedOpen', 'slaCompliancePct', 'avgHoursToComplete'],
  },
  collections: {
    view: 'rpt_collections_monthly', propertyColumn: '"propertyId"', order: 'desc', idOf: (r) => `${r.propertyId}:${r.month}`,
    where: (f) => Prisma.sql`${f.from || f.to ? dateSql('month', f.from, f.to) : monthsBack(f.months ?? 12)}`,
    totals: async (q, where) => {
      const [t] = await prisma.$queryRaw<Raw[]>`SELECT COALESCE(SUM("collectedCents"), 0)::bigint AS "collectedCents", COALESCE(SUM("invoicedCents"), 0)::bigint AS "invoicedCents", COALESCE(SUM("ledgerCashCents"), 0)::bigint AS "ledgerCashCents" FROM rpt_collections_monthly WHERE "tenantOrgId" = ${q.tenantOrgId}${where}`;
      const collectedCents = num(t?.collectedCents); const ledgerCashCents = num(t?.ledgerCashCents);
      return { collectedCents, invoicedCents: num(t?.invoicedCents), ledgerCashCents, reconciled: collectedCents === ledgerCashCents };
    },
    columns: ['month', 'propertyId', 'propertyName', 'paymentsCount', 'collectedCents', 'invoicesCount', 'invoicedCents', 'ledgerCashCents'],
  },
  compliance_hits: {
    view: 'rpt_compliance_hits', propertyColumn: null, order: 'asc', idOf: (r) => String(r.sortKey),
    where: (f) => (f.severity ? Prisma.sql` AND severity = ${f.severity}` : Prisma.empty),
    totals: async (q, where) => {
      const rows = await prisma.$queryRaw<Raw[]>`SELECT severity, resolution, SUM(hits)::int AS hits FROM rpt_compliance_hits WHERE "tenantOrgId" = ${q.tenantOrgId}${where} GROUP BY severity, resolution`;
      const bySeverity: Record<string, number> = {}; const byResolution: Record<string, number> = {}; let hits = 0; let open = 0;
      for (const r of rows) { const h = num(r.hits); hits += h; bySeverity[String(r.severity)] = (bySeverity[String(r.severity)] ?? 0) + h; byResolution[String(r.resolution)] = (byResolution[String(r.resolution)] ?? 0) + h; if (r.resolution === 'open') open += h; }
      return { hits, open, bySeverity, byResolution };
    },
    columns: ['severity', 'result', 'resolution', 'domain', 'hits', 'firstHitAt', 'lastHitAt'],
  },
};

export function specFor(kind: ReportKind): KindSpec { return SPECS[kind]; }
export function isReportKind(v: string): v is ReportKind { return (REPORT_KINDS as readonly string[]).includes(v); }

function whereFor(spec: KindSpec, q: ViewQuery): Prisma.Sql {
  const scope = spec.propertyColumn ? narrowScope(q.scope, q.filters.propertyId) : q.scope;
  const scopePart = spec.propertyColumn ? scopeSql(scope, spec.propertyColumn) : Prisma.empty;
  return Prisma.sql`${scopePart}${spec.where(q.filters)}`;
}

/** One page of a view, keyset-paginated on the view's "sortKey". Always filtered by tenantOrgId. */
export async function queryView(kind: ReportKind, q: ViewQuery): Promise<ViewPage<Raw>> {
  const spec = SPECS[kind];
  const where = whereFor(spec, q);
  const c = decodeCursor<{ k: string }>(q.cursor);
  const cursorSql = c ? (spec.order === 'asc' ? Prisma.sql` AND "sortKey" > ${c.k}` : Prisma.sql` AND "sortKey" < ${c.k}`) : Prisma.empty;
  const orderSql = spec.order === 'asc' ? Prisma.sql`ORDER BY "sortKey" ASC` : Prisma.sql`ORDER BY "sortKey" DESC`;
  const rows = await prisma.$queryRaw<Raw[]>`SELECT * FROM ${Prisma.raw(spec.view)} WHERE "tenantOrgId" = ${q.tenantOrgId}${where}${cursorSql} ${orderSql} LIMIT ${q.limit + 1}`;
  const hasMore = rows.length > q.limit;
  const page: Raw[] = (hasMore ? rows.slice(0, q.limit) : rows).map((r) => ({ id: spec.idOf(r), ...normalize(r) }));
  const last = rows[Math.min(rows.length, q.limit) - 1];
  const [totals, fresh] = await Promise.all([spec.totals(q, where), reportingFreshness()]);
  for (const r of page) delete r.sortKey;
  return { items: page, nextCursor: hasMore && last ? encodeCursor({ k: String(last.sortKey) }) : null, totals, refreshedAt: fresh?.toISOString() ?? null };
}

/** Collections by month across the scoped properties (chart series), same filters as the page. */
export async function collectionsByMonth(q: ViewQuery): Promise<{ month: string; collectedCents: number; invoicedCents: number; ledgerCashCents: number; paymentsCount: number }[]> {
  const where = whereFor(SPECS.collections, q);
  const rows = await prisma.$queryRaw<Raw[]>`SELECT month, SUM("collectedCents")::bigint AS "collectedCents", SUM("invoicedCents")::bigint AS "invoicedCents", SUM("ledgerCashCents")::bigint AS "ledgerCashCents", SUM("paymentsCount")::int AS "paymentsCount" FROM rpt_collections_monthly WHERE "tenantOrgId" = ${q.tenantOrgId}${where} GROUP BY month ORDER BY month ASC`;
  return rows.map((r) => ({ month: String(normalize(r).month), collectedCents: num(r.collectedCents), invoicedCents: num(r.invoicedCents), ledgerCashCents: num(r.ledgerCashCents), paymentsCount: num(r.paymentsCount) }));
}

/** All rows for an export, fetched in bounded batches up to EXPORT_MAX_ROWS. */
export async function collectReportRows(kind: ReportKind, tenantOrgId: string, scope: ReportScope, filters: ReportFiltersDto): Promise<{ rows: Raw[]; truncated: boolean }> {
  const rows: Raw[] = [];
  let cursor: string | undefined;
  while (rows.length < EXPORT_MAX_ROWS) {
    const page = await queryView(kind, { tenantOrgId, scope, filters, limit: Math.min(BATCH, EXPORT_MAX_ROWS - rows.length), cursor });
    rows.push(...page.items);
    if (!page.nextCursor) return { rows, truncated: false };
    cursor = page.nextCursor;
  }
  return { rows, truncated: true };
}

// ───────── headline KPIs ─────────
export async function headlineKpis(tenantOrgId: string, scope: ReportScope, staff: boolean) {
  const s = scopeSql(scope);
  const [rr, ar, occ, col, sla, comp, fresh, propertyCount] = await Promise.all([
    prisma.$queryRaw<Raw[]>`SELECT COUNT(*)::int AS "activeLeases", COALESCE(SUM("rentCents"), 0)::bigint AS "monthlyRentCents" FROM rpt_rent_roll WHERE "tenantOrgId" = ${tenantOrgId}${s}`,
    prisma.$queryRaw<Raw[]>`SELECT COUNT(*)::int AS "openInvoices", COALESCE(SUM("balanceCents"), 0)::bigint AS "balanceCents", COALESCE(SUM("balanceCents") FILTER (WHERE bucket <> 'current'), 0)::bigint AS "overdueCents" FROM rpt_ar_aging WHERE "tenantOrgId" = ${tenantOrgId}${s}`,
    prisma.$queryRaw<Raw[]>`SELECT COALESCE(SUM("totalUnits"), 0)::int AS "totalUnits", COALESCE(SUM("occupiedUnits"), 0)::int AS "occupiedUnits" FROM rpt_occupancy WHERE "tenantOrgId" = ${tenantOrgId}${s}`,
    prisma.$queryRaw<Raw[]>`SELECT
        COALESCE(SUM("collectedCents") FILTER (WHERE month = date_trunc('month', now())::date), 0)::bigint AS "thisMonthCents",
        COALESCE(SUM("collectedCents") FILTER (WHERE month >= (date_trunc('month', now()) - interval '11 months')::date), 0)::bigint AS "trailing12Cents",
        COALESCE(SUM("ledgerCashCents") FILTER (WHERE month >= (date_trunc('month', now()) - interval '11 months')::date), 0)::bigint AS "ledgerCashTrailing12Cents"
      FROM rpt_collections_monthly WHERE "tenantOrgId" = ${tenantOrgId}${s}`,
    prisma.$queryRaw<Raw[]>`SELECT COALESCE(SUM("completedOrders"), 0)::int AS "completedOrders", COALESCE(SUM("completedWithinSla"), 0)::int AS "completedWithinSla", COALESCE(SUM("breachedOpen"), 0)::int AS "breachedOpen" FROM rpt_maintenance_sla WHERE "tenantOrgId" = ${tenantOrgId}${s}`,
    staff ? prisma.$queryRaw<Raw[]>`SELECT COALESCE(SUM(hits), 0)::int AS total, COALESCE(SUM(hits) FILTER (WHERE resolution = 'open'), 0)::int AS open, COALESCE(SUM(hits) FILTER (WHERE severity = 'critical'), 0)::int AS critical FROM rpt_compliance_hits WHERE "tenantOrgId" = ${tenantOrgId}` : Promise.resolve(null),
    reportingFreshness(),
    scope.kind === 'org' ? prisma.property.count({ where: { tenantOrgId } }) : Promise.resolve(scope.propertyIds.length),
  ]);
  const totalUnits = num(occ[0]?.totalUnits); const occupiedUnits = num(occ[0]?.occupiedUnits);
  const completed = num(sla[0]?.completedOrders); const within = num(sla[0]?.completedWithinSla);
  return {
    refreshedAt: fresh?.toISOString() ?? null,
    staleSeconds: fresh ? Math.max(0, Math.round((Date.now() - fresh.getTime()) / 1000)) : null,
    scope: scope.kind,
    propertyCount,
    rentRoll: { activeLeases: num(rr[0]?.activeLeases), monthlyRentCents: num(rr[0]?.monthlyRentCents) },
    arAging: { openInvoices: num(ar[0]?.openInvoices), balanceCents: num(ar[0]?.balanceCents), overdueCents: num(ar[0]?.overdueCents) },
    occupancy: { totalUnits, occupiedUnits, occupancyPct: totalUnits ? Math.round((occupiedUnits / totalUnits) * 10000) / 100 : 0 },
    collections: { thisMonthCents: num(col[0]?.thisMonthCents), trailing12Cents: num(col[0]?.trailing12Cents), ledgerCashTrailing12Cents: num(col[0]?.ledgerCashTrailing12Cents) },
    maintenanceSla: { completedOrders: completed, completedWithinSla: within, slaCompliancePct: completed ? Math.round((within / completed) * 10000) / 100 : 0, breachedOpen: num(sla[0]?.breachedOpen) },
    complianceHits: comp ? { total: num(comp[0]?.total), open: num(comp[0]?.open), critical: num(comp[0]?.critical) } : null,
  };
}

// ───────── exports (ReportRun) ─────────
export function toCsv(columns: string[], rows: Raw[]): string {
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
}

export function sha256Hex(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }

export function scopeFromDefinition(scopeJson: unknown): ReportScope {
  const ids = (scopeJson as { propertyIds?: unknown } | null)?.propertyIds;
  return Array.isArray(ids) ? { kind: 'properties', propertyIds: ids.filter((x): x is string => typeof x === 'string') } : { kind: 'org' };
}

/**
 * Execute a report run: rows from the governed view, scoped exactly like the dashboard that created the definition,
 * written through the storage adapter under org/<org>/reports/<runId>.<ext>, audited as `report.export` with the row count.
 * Idempotent: a complete run is returned as is.
 */
export async function runReportRun(runId: string): Promise<{ status: string; rowCount: number | null; storageKey: string | null; sha256: string | null }> {
  const run = await prisma.reportRun.findUnique({ where: { id: runId }, include: { definition: true } });
  if (!run) throw new Error(`report run ${runId} not found`);
  if (run.status === 'complete') return { status: run.status, rowCount: run.rowCount, storageKey: run.storageKey, sha256: run.sha256 };
  const def = run.definition;
  const tenantOrgId = run.tenantOrgId;
  const ctx: RequestContext = systemContext(tenantOrgId, `report_${run.id}`);
  await prisma.reportRun.update({ where: { id: run.id }, data: { status: 'running', startedAt: new Date(), error: null } });
  try {
    if (!isReportKind(def.kind)) throw new Error(`unknown report kind ${def.kind}`);
    const spec = SPECS[def.kind];
    const filters = (def.filtersJson ?? {}) as ReportFiltersDto;
    const { rows, truncated } = await collectReportRows(def.kind, tenantOrgId, scopeFromDefinition(def.scopeJson), filters);
    const generatedAt = new Date().toISOString();
    const ext = run.format === 'json' ? 'json' : 'csv';
    const body = Buffer.from(ext === 'csv' ? toCsv(spec.columns, rows) : JSON.stringify({ generatedAt, tenantOrgId, reportRunId: run.id, kind: def.kind, filters, rowCount: rows.length, truncated, rows }, null, 2));
    const storageKey = `org/${tenantOrgId}/reports/${run.id}.${ext}`;
    const put = await createStorageAdapter().putObject({ key: storageKey, body, contentType: ext === 'csv' ? 'text/csv' : 'application/json', metadata: { reportRunId: run.id, tenantOrgId, kind: def.kind } });
    const sha = put.sha256 || sha256Hex(body);
    await prisma.$transaction([
      prisma.reportRun.update({ where: { id: run.id }, data: { status: 'complete', rowCount: rows.length, storageKey, sha256: sha, completedAt: new Date() } }),
      prisma.reportDefinition.update({ where: { id: def.id }, data: { lastRunAt: new Date() } }),
    ]);
    await audit(ctx, { action: 'report.export', resourceType: 'report_run', resourceId: run.id, metadata: { definitionId: def.id, kind: def.kind, format: ext, rowCount: rows.length, truncated, storageKey, sha256: sha, requestedBy: run.requestedBy, trigger: run.trigger, scope: scopeFromDefinition(def.scopeJson).kind } });
    await publish(ctx, 'report.completed', { reportRunId: run.id, definitionId: def.id, tenantOrgId, kind: def.kind, rowCount: rows.length, storageKey, sha256: sha, recipients: def.recipients });
    return { status: 'complete', rowCount: rows.length, storageKey, sha256: sha };
  } catch (err) {
    logger.error({ err, runId }, 'report run failed');
    const message = err instanceof Error ? err.message : 'report failed';
    await prisma.reportRun.update({ where: { id: run.id }, data: { status: 'failed', error: message.slice(0, 500), completedAt: new Date() } });
    await audit(ctx, { action: 'report.export', resourceType: 'report_run', resourceId: run.id, outcome: 'error', metadata: { definitionId: def.id, kind: def.kind, error: message.slice(0, 200) } });
    return { status: 'failed', rowCount: null, storageKey: null, sha256: null };
  }
}

// ───────── schedules ─────────
function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(',').some((part) => {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    let lo = min; let hi = max;
    if (rangePart !== '*') {
      const [a, b] = rangePart!.split('-').map(Number);
      if (a === undefined || Number.isNaN(a)) return false;
      lo = a; hi = b === undefined || Number.isNaN(b) ? (stepPart ? max : a) : b;
    }
    if (value < lo || value > hi) return false;
    return (value - lo) % step === 0;
  });
}

/** Does a 5-field cron fire on this calendar day (UTC)? Minute/hour are not evaluated: the daily scheduler runs once. */
export function cronMatchesDay(expr: string, date = new Date()): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [, , dom, mon, dow] = parts as [string, string, string, string, string];
  const d = date.getUTCDate(); const m = date.getUTCMonth() + 1; const w = date.getUTCDay();
  const monthOk = cronFieldMatches(mon, m, 1, 12);
  const domOk = cronFieldMatches(dom, d, 1, 31);
  const dowOk = cronFieldMatches(dow, w, 0, 7) || (w === 0 && cronFieldMatches(dow, 7, 0, 7));
  // Standard cron: when both day fields are restricted, either one matching fires.
  const dayOk = dom !== '*' && dow !== '*' ? domOk || dowOk : domOk && dowOk;
  return monthOk && dayOk;
}

/** Run every active scheduled definition due today that has not run yet today. Returns the run ids created. */
export async function runDueScheduledReports(now = new Date()): Promise<string[]> {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const defs = await prisma.reportDefinition.findMany({ where: { status: 'active', scheduleCron: { not: null }, OR: [{ lastRunAt: null }, { lastRunAt: { lt: startOfDay } }] }, take: 500, orderBy: { id: 'asc' } });
  const created: string[] = [];
  for (const def of defs) {
    if (!def.scheduleCron || !cronMatchesDay(def.scheduleCron, now)) continue;
    const run = await prisma.reportRun.create({ data: { tenantOrgId: def.tenantOrgId, definitionId: def.id, status: 'requested', format: def.format, trigger: 'schedule' } });
    await runReportRun(run.id);
    created.push(run.id);
  }
  return created;
}
