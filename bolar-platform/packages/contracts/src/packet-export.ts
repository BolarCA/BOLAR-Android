// packet-export contracts (Day 50): evidence packets with manifest, hashes, audit events, redaction and an approval gate.
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery } from './common.js';

export const EXPORT_KINDS = ['evidence_packet', 'compliance_review', 'agency_request', 'audit', 'privacy'] as const;
export const EXPORT_SOURCE_TYPES = ['case', 'lease', 'property', 'tenant_profile', 'agency_request', 'privacy_request'] as const;
export const EXPORT_STATUSES = ['requested', 'approved', 'running', 'complete', 'failed', 'denied'] as const;

export const exportFilters = z
  .object({ dateFrom: z.string().optional(), dateTo: z.string().optional(), categories: z.array(z.string()).max(20).optional(), includeAudit: z.boolean().default(true) })
  .openapi('ExportFilters');
export const exportRedaction = z
  .object({ fields: z.array(z.string().min(1).max(64)).max(50).default([]), note: z.string().max(1000).optional() })
  .openapi('ExportRedaction');

export const exportManifestFile = z
  .object({ documentId: idSchema, versionId: idSchema.nullable(), title: z.string(), category: z.string(), classification: z.string(), fileName: z.string().nullable(), sha256: z.string().nullable(), storageKey: z.string().nullable() })
  .openapi('ExportManifestFile');

export const exportManifest = z
  .object({
    generatedAt: z.string(),
    tenantOrgId: idSchema,
    exportJobId: idSchema,
    kind: z.enum(EXPORT_KINDS),
    source: z.object({ type: z.string(), id: z.string() }),
    filters: z.record(z.string(), z.unknown()),
    redaction: z.record(z.string(), z.unknown()),
    reviewer: z.object({ requestedBy: idSchema, approvedBy: idSchema.nullable() }),
    files: z.array(exportManifestFile),
    auditEvents: z.array(z.record(z.string(), z.unknown())),
    subjects: z.array(z.record(z.string(), z.unknown())),
    counts: z.record(z.string(), z.number().int()),
  })
  .openapi('ExportManifest');

export const exportJob = z
  .object({
    id: idSchema,
    kind: z.enum(EXPORT_KINDS),
    sourceType: z.string(),
    sourceId: z.string(),
    status: z.enum(EXPORT_STATUSES),
    filtersJson: z.record(z.string(), z.unknown()),
    redactionJson: z.record(z.string(), z.unknown()),
    manifestJson: z.record(z.string(), z.unknown()).nullable(),
    manifestSha256: z.string().nullable(),
    storageKey: z.string().nullable(),
    requestedBy: idSchema,
    approvedBy: idSchema.nullable(),
    completedAt: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ExportJob');
export const exportJobDetail = exportJob
  .extend({ download: z.object({ url: z.string(), expiresAt: z.string() }).nullable() })
  .openapi('ExportJobDetail');
export const exportJobPage = pageOf(exportJob, 'ExportJob');
export const exportJobQuery = paginationQuery.extend({ status: z.enum(EXPORT_STATUSES).optional(), kind: z.enum(EXPORT_KINDS).optional(), sourceType: z.enum(EXPORT_SOURCE_TYPES).optional(), sourceId: idSchema.optional() });

export const createExportJob = z
  .object({
    kind: z.enum(EXPORT_KINDS),
    sourceType: z.enum(EXPORT_SOURCE_TYPES),
    sourceId: idSchema,
    filters: exportFilters.optional(),
    redaction: exportRedaction.optional(),
  })
  .openapi('CreateExportJob');
export const exportDecision = z.object({ note: z.string().min(3).max(2000) }).openapi('ExportDecision');

export const auditExportQuery = z.object({ resourceType: z.string().min(1).max(64), resourceId: idSchema, limit: z.coerce.number().int().min(1).max(1000).default(500) });
export const auditExportManifest = z
  .object({
    generatedAt: z.string(),
    tenantOrgId: idSchema,
    resourceType: z.string(),
    resourceId: z.string(),
    count: z.number().int(),
    truncated: z.boolean(),
    sha256: z.string(),
    rows: z.array(z.record(z.string(), z.unknown())),
  })
  .openapi('AuditExportManifest');

export type ExportJobDto = z.infer<typeof exportJob>;
export type ExportJobDetailDto = z.infer<typeof exportJobDetail>;
export type ExportManifestDto = z.infer<typeof exportManifest>;
