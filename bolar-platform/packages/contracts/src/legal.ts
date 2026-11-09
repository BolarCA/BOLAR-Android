// legal contracts (p34 Legal/gov): privileged cases, deadlines, agency and law-enforcement requests.
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery } from './common.js';

export const CASE_KINDS = ['eviction', 'dispute', 'compliance', 'agency', 'other'] as const;
export const CASE_STATUSES = ['open', 'active', 'on_hold', 'closed'] as const;
export const AGENCY_REQUEST_KINDS = ['records', 'law_enforcement', 'inspection', 'subpoena'] as const;
export const AGENCY_REQUEST_STATUSES = ['received', 'legal_review', 'approved', 'denied', 'fulfilled', 'closed'] as const;

export const caseDeadline = z
  .object({ id: z.string(), title: z.string().min(1).max(200), dueAt: z.string(), done: z.boolean() })
  .openapi('CaseDeadline');

export const legalCase = z
  .object({
    id: idSchema,
    title: z.string(),
    kind: z.enum(CASE_KINDS),
    status: z.enum(CASE_STATUSES),
    leaseId: idSchema.nullable(),
    propertyId: idSchema.nullable(),
    tenantProfileId: idSchema.nullable(),
    leadLawyerId: idSchema.nullable(),
    privileged: z.boolean(),
    deadlines: z.array(caseDeadline),
    createdBy: idSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    /** Active legal holds covering this case (derived). */
    activeHoldIds: z.array(idSchema).optional(),
  })
  .openapi('LegalCase');
export const legalCasePage = pageOf(legalCase, 'LegalCase');
export const legalCaseQuery = paginationQuery.extend({ status: z.enum(CASE_STATUSES).optional(), kind: z.enum(CASE_KINDS).optional() });

export const createCase = z
  .object({
    title: z.string().min(3).max(200),
    kind: z.enum(CASE_KINDS),
    leaseId: idSchema.optional(),
    propertyId: idSchema.optional(),
    tenantProfileId: idSchema.optional(),
    leadLawyerId: idSchema.optional(),
    privileged: z.boolean().default(true),
  })
  .openapi('CreateCase');

export const updateCase = z
  .object({
    title: z.string().min(3).max(200).optional(),
    status: z.enum(CASE_STATUSES).optional(),
    leadLawyerId: idSchema.nullable().optional(),
    deadlines: z.array(caseDeadline.partial({ id: true, done: true })).max(100).optional(),
    note: z.string().max(2000).optional(),
  })
  .openapi('UpdateCase');

export const addCaseDeadline = z
  .object({ title: z.string().min(1).max(200), dueAt: z.string().datetime() })
  .openapi('AddCaseDeadline');

export const caseLegalHold = z
  .object({ name: z.string().min(3).max(200).optional(), reason: z.string().min(10).max(2000), note: z.string().min(5).max(2000) })
  .openapi('CaseLegalHold');

export const caseTimelineEntry = z
  .object({ id: idSchema, actorId: idSchema.nullable(), action: z.string(), resourceType: z.string(), resourceId: z.string().nullable(), outcome: z.string(), metadata: z.unknown().nullable(), createdAt: z.string() })
  .openapi('CaseTimelineEntry');
export const caseTimelinePage = pageOf(caseTimelineEntry, 'CaseTimelineEntry');

export const agencyRequestScope = z
  .object({
    propertyIds: z.array(idSchema).max(100).optional(),
    leaseIds: z.array(idSchema).max(100).optional(),
    tenantProfileIds: z.array(idSchema).max(100).optional(),
    documentIds: z.array(idSchema).max(200).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    description: z.string().max(2000).optional(),
  })
  .openapi('AgencyRequestScope');

export const agencyRequest = z
  .object({
    id: idSchema,
    agencyName: z.string(),
    requesterUserId: idSchema.nullable(),
    kind: z.enum(AGENCY_REQUEST_KINDS),
    legalBasis: z.string(),
    scopeJson: z.record(z.unknown()),
    status: z.enum(AGENCY_REQUEST_STATUSES),
    minimizationNotes: z.string().nullable(),
    approvedBy: idSchema.nullable(),
    decidedAt: z.string().nullable(),
    dueAt: z.string().nullable(),
    exportJobId: idSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('AgencyRequest');
export const agencyRequestPage = pageOf(agencyRequest, 'AgencyRequest');
export const agencyRequestQuery = paginationQuery.extend({ status: z.enum(AGENCY_REQUEST_STATUSES).optional(), kind: z.enum(AGENCY_REQUEST_KINDS).optional() });

export const createAgencyRequest = z
  .object({
    agencyName: z.string().min(2).max(200),
    kind: z.enum(AGENCY_REQUEST_KINDS),
    legalBasis: z.string().min(10).max(2000),
    /** Warrant, subpoena or court-order reference. Mandatory for law-enforcement requests. */
    legalReference: z.string().min(3).max(200).optional(),
    scopeJson: agencyRequestScope,
    dueAt: z.string().datetime().optional(),
  })
  .refine((b) => b.kind !== 'law_enforcement' || !!b.legalReference, { message: 'legalReference (warrant/subpoena/court order) is required for law-enforcement requests', path: ['legalReference'] })
  .openapi('CreateAgencyRequest');

export const agencyLegalReview = z.object({ minimizationNotes: z.string().min(10).max(4000) }).openapi('AgencyLegalReview');
export const agencyDecide = z.object({ decision: z.enum(['approved', 'denied']), note: z.string().min(5).max(2000) }).openapi('AgencyDecide');
export const agencyFulfill = z.object({ exportJobId: idSchema.optional(), note: z.string().max(2000).optional() }).openapi('AgencyFulfill');

export type LegalCaseDto = z.infer<typeof legalCase>;
export type AgencyRequestDto = z.infer<typeof agencyRequest>;
