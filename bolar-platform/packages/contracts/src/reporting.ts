// reporting contracts (blueprint Days 75-90): KPI tables read from governed materialized views, scheduled reports and
// exports. Definitions, formulas and reconciliation rules live in docs/metrics-definitions.md.
import { z } from './openapi-zod.js';
import { idSchema, isoDateSchema, pageOf, paginationQuery } from './common.js';

export const REPORT_KINDS = ['rent_roll', 'ar_aging', 'occupancy', 'maintenance_sla', 'collections', 'compliance_hits'] as const;
export const reportKindSchema = z.enum(REPORT_KINDS);
export const REPORT_FORMATS = ['csv', 'json'] as const;
export const reportFormatSchema = z.enum(REPORT_FORMATS);
export const REPORT_RUN_STATUSES = ['requested', 'running', 'complete', 'failed'] as const;
export const REPORT_DEFINITION_STATUSES = ['active', 'paused'] as const;
export const AR_BUCKETS = ['current', '1_30', '31_60', '61_90', '90_plus'] as const;

/** Property and date filters shared by every report endpoint and by stored definitions. */
export const reportFilters = z
  .object({
    propertyId: idSchema.optional(),
    /** Inclusive lower bound (due date for AR, month for collections, start date for rent roll). */
    from: isoDateSchema.optional(),
    /** Inclusive upper bound. */
    to: isoDateSchema.optional(),
    /** Collections only: trailing months (1-36). */
    months: z.coerce.number().int().min(1).max(36).optional(),
    priority: z.enum(['emergency', 'high', 'normal', 'low']).optional(),
    bucket: z.enum(AR_BUCKETS).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  })
  .openapi('ReportFilters');
export type ReportFiltersDto = z.infer<typeof reportFilters>;

export const reportListQuery = paginationQuery.extend(reportFilters.shape);

// ───────── Rows (one schema per view) ─────────
export const rentRollRow = z
  .object({
    id: idSchema, leaseId: idSchema, propertyId: idSchema, propertyName: z.string(), unitId: idSchema, unitNumber: z.string(),
    tenantProfileId: idSchema.nullable(), tenantName: z.string().nullable(), status: z.string(), startDate: z.string(), endDate: z.string(),
    rentCents: z.number().int(), depositCents: z.number().int(), targetRentCents: z.number().int(),
  })
  .openapi('RentRollRow');
export const rentRollPage = pageOf(rentRollRow, 'RentRollRow').extend({ totals: z.object({ leases: z.number().int(), rentCents: z.number().int() }), refreshedAt: z.string().nullable() }).openapi('RentRollReport');

export const arAgingRow = z
  .object({
    id: idSchema, invoiceId: idSchema, leaseId: idSchema, propertyId: idSchema, propertyName: z.string(), unitNumber: z.string(),
    tenantProfileId: idSchema.nullable(), tenantName: z.string().nullable(), number: z.string(), status: z.string(), dueDate: z.string(),
    totalCents: z.number().int(), paidCents: z.number().int(), balanceCents: z.number().int(), daysPastDue: z.number().int(), bucket: z.enum(AR_BUCKETS),
  })
  .openapi('ArAgingRow');
export const arAgingBuckets = z.object({ currentCents: z.number().int(), d1to30Cents: z.number().int(), d31to60Cents: z.number().int(), d61to90Cents: z.number().int(), d90PlusCents: z.number().int(), totalCents: z.number().int(), invoices: z.number().int() }).openapi('ArAgingBuckets');
export const arAgingPage = pageOf(arAgingRow, 'ArAgingRow').extend({ totals: arAgingBuckets, refreshedAt: z.string().nullable() }).openapi('ArAgingReport');

export const occupancyRow = z
  .object({
    id: idSchema, propertyId: idSchema, propertyName: z.string(), city: z.string(), state: z.string(), propertyStatus: z.string(),
    totalUnits: z.number().int(), occupiedUnits: z.number().int(), vacantUnits: z.number().int(), noticeUnits: z.number().int(), otherUnits: z.number().int(),
    occupancyPct: z.number(), activeLeases: z.number().int(), scheduledRentCents: z.number().int(), targetRentCents: z.number().int(),
  })
  .openapi('OccupancyRow');
export const occupancyPage = pageOf(occupancyRow, 'OccupancyRow').extend({ totals: z.object({ properties: z.number().int(), totalUnits: z.number().int(), occupiedUnits: z.number().int(), occupancyPct: z.number(), scheduledRentCents: z.number().int() }), refreshedAt: z.string().nullable() }).openapi('OccupancyReport');

export const maintenanceSlaRow = z
  .object({
    id: z.string(), propertyId: idSchema, propertyName: z.string(), priority: z.string(),
    totalOrders: z.number().int(), openOrders: z.number().int(), completedOrders: z.number().int(), measuredOrders: z.number().int(),
    completedWithinSla: z.number().int(), completedLate: z.number().int(), breachedOpen: z.number().int(), slaCompliancePct: z.number(), avgHoursToComplete: z.number().nullable(),
  })
  .openapi('MaintenanceSlaRow');
export const maintenanceSlaPage = pageOf(maintenanceSlaRow, 'MaintenanceSlaRow').extend({ totals: z.object({ totalOrders: z.number().int(), openOrders: z.number().int(), completedOrders: z.number().int(), completedWithinSla: z.number().int(), breachedOpen: z.number().int(), slaCompliancePct: z.number() }), refreshedAt: z.string().nullable() }).openapi('MaintenanceSlaReport');

export const collectionsRow = z
  .object({
    id: z.string(), propertyId: idSchema, propertyName: z.string(), month: z.string(),
    paymentsCount: z.number().int(), collectedCents: z.number().int(), invoicesCount: z.number().int(), invoicedCents: z.number().int(), ledgerCashCents: z.number().int(),
  })
  .openapi('CollectionsRow');
export const collectionsMonth = z.object({ month: z.string(), collectedCents: z.number().int(), invoicedCents: z.number().int(), ledgerCashCents: z.number().int(), paymentsCount: z.number().int() }).openapi('CollectionsMonth');
export const collectionsPage = pageOf(collectionsRow, 'CollectionsRow')
  .extend({ byMonth: z.array(collectionsMonth), totals: z.object({ collectedCents: z.number().int(), invoicedCents: z.number().int(), ledgerCashCents: z.number().int(), reconciled: z.boolean() }), months: z.number().int(), refreshedAt: z.string().nullable() })
  .openapi('CollectionsReport');

export const complianceHitsRow = z
  .object({ id: z.string(), severity: z.string(), result: z.string(), resolution: z.string(), domain: z.string(), hits: z.number().int(), firstHitAt: z.string(), lastHitAt: z.string() })
  .openapi('ComplianceHitsRow');
export const complianceHitsPage = pageOf(complianceHitsRow, 'ComplianceHitsRow')
  .extend({ totals: z.object({ hits: z.number().int(), open: z.number().int(), bySeverity: z.record(z.string(), z.number().int()), byResolution: z.record(z.string(), z.number().int()) }), refreshedAt: z.string().nullable() })
  .openapi('ComplianceHitsReport');

// ───────── Headline KPIs ─────────
export const reportKpis = z
  .object({
    refreshedAt: z.string().nullable(),
    staleSeconds: z.number().int().nullable(),
    scope: z.enum(['org', 'properties']),
    propertyCount: z.number().int(),
    rentRoll: z.object({ activeLeases: z.number().int(), monthlyRentCents: z.number().int() }),
    arAging: z.object({ openInvoices: z.number().int(), balanceCents: z.number().int(), overdueCents: z.number().int() }),
    occupancy: z.object({ totalUnits: z.number().int(), occupiedUnits: z.number().int(), occupancyPct: z.number() }),
    collections: z.object({ thisMonthCents: z.number().int(), trailing12Cents: z.number().int(), ledgerCashTrailing12Cents: z.number().int() }),
    maintenanceSla: z.object({ completedOrders: z.number().int(), completedWithinSla: z.number().int(), slaCompliancePct: z.number(), breachedOpen: z.number().int() }),
    /** Staff only; null for landlords. */
    complianceHits: z.object({ total: z.number().int(), open: z.number().int(), critical: z.number().int() }).nullable(),
  })
  .openapi('ReportKpis');

export const refreshResponse = z.object({ refreshedAt: z.string(), durationMs: z.number().int() }).openapi('ReportRefreshResponse');

// ───────── Scheduled reports ─────────
const cronField = /^[0-9*,/-]+$/;
/** 5-field cron (minute hour day-of-month month day-of-week). The daily scheduler matches day fields; minute/hour are informational. */
export const cronSchema = z.string().trim().refine((v) => { const parts = v.split(/\s+/); return parts.length === 5 && parts.every((p) => cronField.test(p) && p.length <= 20); }, 'Expected a 5-field cron expression');

export const reportDefinition = z
  .object({
    id: idSchema, name: z.string(), kind: reportKindSchema, filtersJson: reportFilters, scopeJson: z.object({ propertyIds: z.array(idSchema) }).nullable(), scheduleCron: z.string().nullable(),
    recipients: z.array(z.string()), format: reportFormatSchema, status: z.enum(REPORT_DEFINITION_STATUSES), createdBy: idSchema, lastRunAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
  })
  .openapi('ReportDefinition');
export const reportDefinitionPage = pageOf(reportDefinition, 'ReportDefinition');
export const reportDefinitionQuery = paginationQuery.extend({ kind: reportKindSchema.optional(), status: z.enum(REPORT_DEFINITION_STATUSES).optional() });
export const createReportDefinition = z
  .object({
    name: z.string().trim().min(3).max(120),
    kind: reportKindSchema,
    filters: reportFilters.optional(),
    scheduleCron: cronSchema.nullable().optional(),
    recipients: z.array(z.string().trim().toLowerCase().email().max(254)).max(20).default([]),
    format: reportFormatSchema.default('csv'),
  })
  .openapi('CreateReportDefinition');

export const reportRun = z
  .object({
    id: idSchema, definitionId: idSchema, definitionName: z.string().nullable(), kind: reportKindSchema.nullable(), status: z.enum(REPORT_RUN_STATUSES), format: reportFormatSchema, trigger: z.string(),
    rowCount: z.number().int().nullable(), storageKey: z.string().nullable(), sha256: z.string().nullable(), error: z.string().nullable(), requestedBy: idSchema.nullable(),
    startedAt: z.string().nullable(), completedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
  })
  .openapi('ReportRun');
export const reportRunDetail = reportRun.extend({ download: z.object({ url: z.string(), expiresAt: z.string() }).nullable() }).openapi('ReportRunDetail');
export const reportRunPage = pageOf(reportRun, 'ReportRun');
export const reportRunQuery = paginationQuery.extend({ definitionId: idSchema.optional(), status: z.enum(REPORT_RUN_STATUSES).optional() });

export type ReportKind = (typeof REPORT_KINDS)[number];
export type RentRollRowDto = z.infer<typeof rentRollRow>;
export type RentRollReportDto = z.infer<typeof rentRollPage>;
export type ArAgingRowDto = z.infer<typeof arAgingRow>;
export type ArAgingReportDto = z.infer<typeof arAgingPage>;
export type OccupancyRowDto = z.infer<typeof occupancyRow>;
export type OccupancyReportDto = z.infer<typeof occupancyPage>;
export type MaintenanceSlaRowDto = z.infer<typeof maintenanceSlaRow>;
export type MaintenanceSlaReportDto = z.infer<typeof maintenanceSlaPage>;
export type CollectionsRowDto = z.infer<typeof collectionsRow>;
export type CollectionsReportDto = z.infer<typeof collectionsPage>;
export type ComplianceHitsRowDto = z.infer<typeof complianceHitsRow>;
export type ComplianceHitsReportDto = z.infer<typeof complianceHitsPage>;
export type ReportKpisDto = z.infer<typeof reportKpis>;
export type ReportDefinitionDto = z.infer<typeof reportDefinition>;
export type CreateReportDefinitionDto = z.infer<typeof createReportDefinition>;
export type ReportRunDto = z.infer<typeof reportRun>;
export type ReportRunDetailDto = z.infer<typeof reportRunDetail>;
