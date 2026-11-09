// platform control-plane contracts (Day 51): health summary, feature flags, support sessions, platform-wide audit.
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery } from './common.js';
import { auditQuery } from './iam.js';

export const healthSummary = z
  .object({
    status: z.enum(['ok', 'degraded']),
    checks: z.record(z.string(), z.enum(['ok', 'fail'])),
    counts: z.object({ orgs: z.number().int(), activeOrgs: z.number().int(), users: z.number().int(), activeSessions: z.number().int(), activeSupportSessions: z.number().int() }),
    queueDriver: z.string(),
    version: z.string(),
    generatedAt: z.string(),
    requestId: z.string(),
  })
  .openapi('HealthSummary');
export type HealthSummaryDto = z.infer<typeof healthSummary>;

/** Feature flag: `tenantOrgId` null means the flag is global (applies to every org unless an org row overrides it). */
export const featureFlag = z
  .object({ id: idSchema, tenantOrgId: idSchema.nullable(), key: z.string(), enabled: z.boolean(), rules: z.record(z.string(), z.unknown()), updatedBy: idSchema.nullable(), updatedAt: z.string(), orgSlug: z.string().nullable().optional() })
  .openapi('FeatureFlag');
export const featureFlagPage = pageOf(featureFlag, 'FeatureFlag');
export const featureFlagKey = z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,79}$/, 'Key must be lowercase letters, digits, dots, dashes or underscores');
export const createFeatureFlag = z
  .object({ key: featureFlagKey, enabled: z.boolean().default(false), rules: z.record(z.string(), z.unknown()).default({}), tenantOrgId: idSchema.optional() })
  .openapi('CreateFeatureFlag');
export const updateFeatureFlag = z.object({ enabled: z.boolean().optional(), rules: z.record(z.string(), z.unknown()).optional() }).openapi('UpdateFeatureFlag');
export const featureFlagQuery = paginationQuery.extend({ tenantOrgId: idSchema.optional(), key: z.string().max(80).optional(), scope: z.enum(['global', 'org', 'all']).default('all') });
export type FeatureFlagDto = z.infer<typeof featureFlag>;

export const supportSession = z
  .object({
    id: idSchema, tenantOrgId: idSchema, agentUserId: idSchema, reason: z.string(), approvedBy: idSchema.nullable(),
    startedAt: z.string(), endsAt: z.string(), endedAt: z.string().nullable(), active: z.boolean(),
    org: z.object({ id: idSchema, slug: z.string(), name: z.string() }).nullable(),
    agent: z.object({ id: idSchema, name: z.string(), email: z.string() }).nullable(),
  })
  .openapi('SupportSession');
export const supportSessionPage = pageOf(supportSession, 'SupportSession');
export const createSupportSession = z
  .object({
    /** Target org id or slug. */
    tenantOrgId: z.string().min(1).max(80),
    reason: z.string().trim().min(10).max(1000),
    /** Time box in minutes (15 min to 8 h). */
    durationMinutes: z.number().int().min(15).max(480).default(60),
  })
  .openapi('CreateSupportSession');
export const supportSessionQuery = paginationQuery.extend({ active: z.enum(['true', 'false']).optional(), tenantOrgId: idSchema.optional() });
export type SupportSessionDto = z.infer<typeof supportSession>;

/** Platform-wide audit query: the base org audit filters plus an optional org (id or slug) filter. */
export const platformAuditQuery = auditQuery.extend({ tenantOrgId: z.string().min(1).max(80).optional() });
