// compliance contracts (Days 41-45): rule catalog, evaluator, jurisdiction resolver, fair-housing/SOI guard, review queue.
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery } from './common.js';

export const RULE_DOMAINS = ['rent', 'deposit', 'screening', 'notice', 'fair_housing', 'soi', 'privacy', 'maintenance'] as const;
export const RULE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const RULE_ACTIONS = ['allow', 'warn', 'block', 'review'] as const;
export const RULE_STATUSES = ['draft', 'active', 'retired'] as const;
export const CONDITION_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is_null', 'not_null', 'gt_field', 'lt_field', 'matches_any', 'contains'] as const;
export const EVALUATION_RESOLUTIONS = ['accepted', 'remediated', 'overridden', 'dismissed'] as const;
export type RuleDomain = (typeof RULE_DOMAINS)[number];
export type RuleAction = (typeof RULE_ACTIONS)[number];
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];
export type ConditionOp = (typeof CONDITION_OPS)[number];

/** Jurisdiction code: US | US-CA | US-CA-LOS_ANGELES (upper-case, spaces as underscores). */
export const jurisdictionCode = z.string().regex(/^US(-[A-Z]{2}(-[A-Z0-9_]{1,64})*)?$/, 'Jurisdiction must look like US, US-CA or US-CA-LOS_ANGELES');

/**
 * Declarative condition tree evaluated by the deterministic rule engine.
 * Group: { all?: Cond[], any?: Cond[], not?: Cond }  Leaf: { field, op, value? }
 * The tree shape is validated structurally by the engine (`validateConditions`) so the OpenAPI type stays open.
 */
export const ruleConditions = z.record(z.string(), z.unknown()).openapi('RuleConditions', {
  description: 'Condition tree: { all?: Cond[], any?: Cond[], not?: Cond } with leaves { field, op, value? }. ops: eq, neq, gt, gte, lt, lte, in, is_null, not_null, gt_field, lt_field, matches_any, contains.',
});

/** Facts are a flat bag of primitive values keyed by field name. */
export const ruleFacts = z.record(z.string(), z.unknown()).openapi('RuleFacts');

export const complianceRule = z
  .object({
    id: idSchema, key: z.string(), version: z.number().int(), jurisdiction: z.string(), domain: z.enum(RULE_DOMAINS), title: z.string(), description: z.string(),
    severity: z.enum(RULE_SEVERITIES), action: z.enum(RULE_ACTIONS), conditions: ruleConditions, effectiveFrom: z.string(), effectiveTo: z.string().nullable(),
    status: z.enum(RULE_STATUSES), sourceUrl: z.string().nullable(), approvedBy: idSchema.nullable(), createdAt: z.string(),
  })
  .openapi('ComplianceRule');
export const complianceRulePage = pageOf(complianceRule, 'ComplianceRule');
export const ruleQuery = paginationQuery.extend({ jurisdiction: z.string().max(80).optional(), domain: z.enum(RULE_DOMAINS).optional(), status: z.enum(RULE_STATUSES).optional(), key: z.string().max(120).optional() });

export const createRule = z
  .object({
    key: z.string().min(3).max(120).regex(/^[a-z0-9_.-]+$/, 'lower-case key like us-ca.deposit.max_one_month'),
    jurisdiction: jurisdictionCode, domain: z.enum(RULE_DOMAINS), title: z.string().min(3).max(200), description: z.string().min(3).max(2000),
    severity: z.enum(RULE_SEVERITIES).default('medium'), action: z.enum(RULE_ACTIONS).default('warn'), conditions: ruleConditions,
    effectiveFrom: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(), effectiveTo: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional(),
    sourceUrl: z.string().url().max(500).nullable().optional(),
  })
  .openapi('CreateComplianceRule');
export const newRuleVersion = createRule.omit({ key: true }).partial().openapi('NewComplianceRuleVersion');

export const ruleHitEvidence = z
  .object({
    conditionsMatched: z.array(z.string()),
    facts: ruleFacts,
    matchedTerms: z.array(z.string()).optional(),
    sourceUrl: z.string().nullable(),
    title: z.string(),
    description: z.string(),
    jurisdiction: z.string(),
    domain: z.string(),
  })
  .openapi('RuleHitEvidence');
export const ruleHit = z
  .object({ ruleId: idSchema.optional(), ruleKey: z.string(), ruleVersion: z.number().int(), severity: z.enum(RULE_SEVERITIES), action: z.enum(RULE_ACTIONS), evidence: ruleHitEvidence })
  .openapi('RuleHit');

export const evaluateRulesRequest = z
  .object({
    domain: z.enum(RULE_DOMAINS).optional(),
    resourceType: z.string().min(1).max(64),
    resourceId: z.string().min(1).max(64),
    facts: ruleFacts,
    propertyId: idSchema.optional(),
    jurisdiction: jurisdictionCode.optional(),
    asOf: z.string().datetime({ offset: true }).optional(),
    /** Preview only: returns hits without persisting queue items or publishing events (still audited). */
    dryRun: z.boolean().optional(),
    /** Dry-run only: an unsaved rule draft evaluated alongside the rules in force (rule editor preview). */
    candidate: z.object({ key: z.string().min(1).max(120).default('draft.candidate'), action: z.enum(RULE_ACTIONS).default('warn'), severity: z.enum(RULE_SEVERITIES).default('medium'), conditions: ruleConditions, title: z.string().max(200).default('Draft rule'), jurisdiction: jurisdictionCode.default('US'), domain: z.enum(RULE_DOMAINS).default('rent') }).optional(),
  })
  .openapi('EvaluateRulesRequest');
export const evaluateRulesResponse = z
  .object({ result: z.enum(RULE_ACTIONS), hits: z.array(ruleHit), evaluationIds: z.array(idSchema), jurisdictionChain: z.array(z.string()), rulesConsidered: z.number().int() })
  .openapi('EvaluateRulesResponse');

export const ruleEvaluation = z
  .object({
    id: idSchema, ruleId: idSchema, ruleKey: z.string(), ruleVersion: z.number().int(), resourceType: z.string(), resourceId: z.string(), result: z.enum(RULE_ACTIONS),
    evidenceJson: z.unknown(), reviewedBy: idSchema.nullable(), reviewedAt: z.string().nullable(), resolution: z.enum(EVALUATION_RESOLUTIONS).nullable(), createdAt: z.string(),
    severity: z.enum(RULE_SEVERITIES), domain: z.string(), jurisdiction: z.string(), title: z.string(), sourceUrl: z.string().nullable(),
    /** createdAt + 7 days for block/review, + 30 days for warn. */
    dueAt: z.string(),
  })
  .openapi('RuleEvaluation');
export const ruleEvaluationPage = pageOf(ruleEvaluation, 'RuleEvaluation');
export const evaluationQuery = paginationQuery.extend({
  resourceType: z.string().max(64).optional(), resourceId: z.string().max(64).optional(), result: z.enum(RULE_ACTIONS).optional(),
  reviewed: z.enum(['true', 'false']).optional(), severity: z.enum(RULE_SEVERITIES).optional(), domain: z.enum(RULE_DOMAINS).optional(), ruleKey: z.string().max(120).optional(),
});
export const resolveEvaluation = z.object({ resolution: z.enum(EVALUATION_RESOLUTIONS), note: z.string().max(2000).optional() }).openapi('ResolveRuleEvaluation');

export const jurisdictionOverride = z
  .object({ id: idSchema, propertyId: idSchema, jurisdiction: z.string(), reason: z.string(), createdBy: idSchema, createdAt: z.string() })
  .openapi('JurisdictionOverride');
export const jurisdictionOverridePage = pageOf(jurisdictionOverride, 'JurisdictionOverride');
export const createJurisdictionOverride = z.object({ propertyId: idSchema, jurisdiction: jurisdictionCode, reason: z.string().min(10).max(1000) }).openapi('CreateJurisdictionOverride');
export const jurisdictionResolveQuery = z.object({ propertyId: idSchema, asOf: z.string().datetime({ offset: true }).optional() });
export const jurisdictionResolution = z
  .object({
    propertyId: idSchema, chain: z.array(z.string()), override: jurisdictionOverride.nullable(),
    activeRules: z.array(z.object({ id: idSchema, key: z.string(), version: z.number().int(), domain: z.string(), jurisdiction: z.string(), action: z.enum(RULE_ACTIONS), severity: z.enum(RULE_SEVERITIES), title: z.string() })),
  })
  .openapi('JurisdictionResolution');

export const screenTextRequest = z.object({ text: z.string().min(1).max(20000), resourceType: z.string().min(1).max(64).optional(), resourceId: z.string().min(1).max(64).optional() }).openapi('ScreenTextRequest');
export const screenTextHit = z.object({ ruleKey: z.string(), ruleVersion: z.number().int(), term: z.string(), severity: z.enum(RULE_SEVERITIES), action: z.enum(RULE_ACTIONS), sourceUrl: z.string().nullable() }).openapi('ScreenTextHit');
export const screenTextResponse = z.object({ flagged: z.boolean(), hits: z.array(screenTextHit), evaluationIds: z.array(idSchema) }).openapi('ScreenTextResponse');

export type ComplianceRuleDto = z.infer<typeof complianceRule>;
export type RuleHitDto = z.infer<typeof ruleHit>;
export type RuleEvaluationDto = z.infer<typeof ruleEvaluation>;
export type EvaluateRulesResponseDto = z.infer<typeof evaluateRulesResponse>;
export type JurisdictionResolutionDto = z.infer<typeof jurisdictionResolution>;
export type ScreenTextResponseDto = z.infer<typeof screenTextResponse>;
