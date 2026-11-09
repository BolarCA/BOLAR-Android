// retention contracts (Day 47): policies, assignments, proposed dispositions, human-gated disposal.
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery } from './common.js';

export const RETENTION_RESOURCE_TYPES = ['document', 'lease', 'audit_log', 'notification', 'screening_result', 'media', 'message', 'report'] as const;
export const RETENTION_DISPOSITIONS = ['delete', 'anonymize', 'archive', 'review'] as const;
export const RETENTION_STATES = ['retained', 'pending_disposition', 'proposed', 'approved', 'disposed', 'held'] as const;

export const retentionPolicy = z
  .object({
    id: idSchema,
    tenantOrgId: idSchema.nullable(),
    key: z.string(),
    name: z.string(),
    resourceType: z.string(),
    classification: z.string().nullable(),
    retainDays: z.number().int(),
    disposition: z.enum(RETENTION_DISPOSITIONS),
    requiresApproval: z.boolean(),
    /** true for platform defaults (tenantOrgId null); orgs may override a default by key. */
    isPlatformDefault: z.boolean(),
    createdAt: z.string(),
  })
  .openapi('RetentionPolicy');
export const retentionPolicyList = z.object({ items: z.array(retentionPolicy) }).openapi('RetentionPolicyList');

export const createRetentionPolicy = z
  .object({
    key: z.string().min(3).max(80).regex(/^[a-z0-9_.-]+$/, 'lowercase key with dots, dashes or underscores'),
    name: z.string().min(3).max(120),
    resourceType: z.enum(RETENTION_RESOURCE_TYPES),
    classification: z.enum(['public', 'internal', 'confidential', 'restricted']).optional(),
    retainDays: z.number().int().min(1).max(365 * 30),
    disposition: z.enum(RETENTION_DISPOSITIONS).default('review'),
    requiresApproval: z.boolean().default(true),
  })
  .openapi('CreateRetentionPolicy');

export const updateRetentionPolicy = z
  .object({
    name: z.string().min(3).max(120).optional(),
    retainDays: z.number().int().min(1).max(365 * 30).optional(),
    disposition: z.enum(RETENTION_DISPOSITIONS).optional(),
    requiresApproval: z.boolean().optional(),
  })
  .openapi('UpdateRetentionPolicy');

export const retentionAssignment = z
  .object({
    id: idSchema,
    policyId: idSchema,
    policyKey: z.string().optional(),
    resourceType: z.string(),
    resourceId: z.string(),
    retainUntil: z.string(),
    state: z.enum(RETENTION_STATES),
    proposedAt: z.string().nullable(),
    approvedBy: idSchema.nullable(),
    disposedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('RetentionAssignment');
export const retentionAssignmentPage = pageOf(retentionAssignment, 'RetentionAssignment');
export const retentionAssignmentQuery = paginationQuery.extend({
  state: z.enum(RETENTION_STATES).optional(),
  resourceType: z.string().max(64).optional(),
  dueBefore: z.string().datetime().optional(),
});

export const createRetentionAssignment = z
  .object({
    policyKey: z.string().min(1).max(80),
    resourceType: z.enum(RETENTION_RESOURCE_TYPES),
    resourceId: idSchema,
    anchorDate: z.string().datetime().optional(),
  })
  .openapi('CreateRetentionAssignment');

export const retentionDecision = z.object({ note: z.string().min(3).max(2000) }).openapi('RetentionDecision');
export const retentionDispose = z.object({ note: z.string().max(2000).optional() }).openapi('RetentionDispose');

export const retentionSweepResult = z
  .object({ scanned: z.number().int(), proposed: z.number().int(), held: z.number().int(), ranAt: z.string() })
  .openapi('RetentionSweepResult');

export type RetentionPolicyDto = z.infer<typeof retentionPolicy>;
export type RetentionAssignmentDto = z.infer<typeof retentionAssignment>;
