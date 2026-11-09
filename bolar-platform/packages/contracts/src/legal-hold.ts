// legal-hold contracts (Day 49): holds scoped by tenant/property/lease/case/user/document; release needs counsel approval.
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery } from './common.js';

export const LEGAL_HOLD_STATUSES = ['active', 'released'] as const;
export const HOLD_SCOPE_KEYS = ['propertyIds', 'leaseIds', 'caseIds', 'userIds', 'documentIds', 'tenantProfileIds'] as const;

export const legalHoldScope = z
  .object({
    propertyIds: z.array(idSchema).max(200).optional(),
    leaseIds: z.array(idSchema).max(200).optional(),
    caseIds: z.array(idSchema).max(200).optional(),
    userIds: z.array(idSchema).max(200).optional(),
    documentIds: z.array(idSchema).max(500).optional(),
    tenantProfileIds: z.array(idSchema).max(200).optional(),
  })
  .refine((s) => HOLD_SCOPE_KEYS.some((k) => (s[k]?.length ?? 0) > 0), { message: 'At least one scope target is required' })
  .openapi('LegalHoldScope');

export const legalHold = z
  .object({
    id: idSchema,
    name: z.string(),
    reason: z.string(),
    scopeJson: z.record(z.string(), z.array(z.string())),
    status: z.enum(LEGAL_HOLD_STATUSES),
    approvedBy: idSchema,
    releasedBy: idSchema.nullable(),
    releasedAt: z.string().nullable(),
    createdBy: idSchema,
    createdAt: z.string(),
  })
  .openapi('LegalHold');
export const legalHoldPage = pageOf(legalHold, 'LegalHold');
export const legalHoldQuery = paginationQuery.extend({ status: z.enum(LEGAL_HOLD_STATUSES).optional(), caseId: idSchema.optional() });

export const createLegalHold = z
  .object({
    name: z.string().min(3).max(200),
    reason: z.string().min(10).max(2000),
    scopeJson: legalHoldScope,
    /** Counsel note recorded with the approval (the creator is the approving counsel; the note is mandatory). */
    note: z.string().min(5).max(2000),
  })
  .openapi('CreateLegalHold');

export const releaseLegalHold = z.object({ note: z.string().min(5).max(2000) }).openapi('ReleaseLegalHold');

export const legalHoldCheckQuery = z.object({ resourceType: z.string().min(1).max(64), resourceId: idSchema });
export const legalHoldCheck = z.object({ held: z.boolean(), holdIds: z.array(idSchema) }).openapi('LegalHoldCheck');

export type LegalHoldDto = z.infer<typeof legalHold>;
export type LegalHoldScopeDto = z.infer<typeof legalHoldScope>;
