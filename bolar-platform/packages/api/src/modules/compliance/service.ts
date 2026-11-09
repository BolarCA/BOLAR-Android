/**
 * Compliance service: evaluates rules for a resource and persists one RuleEvaluation per hit (the review queue),
 * shared by the compliance routes, the notice module and the screening module.
 */
import type { RuleEvaluationDto, RuleHitDto } from '@bolar/contracts';
import type { RequestContext } from '@bolar/shared';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { toDto } from '../../shared/route.js';
import { evaluate, mostSevere, type EngineRule, type Facts } from './engine.js';
import { loadRulesForChain, resolveChain } from './jurisdiction.js';

export interface EvaluateInput {
  domain?: string; domains?: string[]; resourceType: string; resourceId: string; facts: Facts; propertyId?: string; jurisdiction?: string; asOf?: Date;
  /** Preview: evaluate but persist nothing (the audit row still records the dry run). */
  dryRun?: boolean;
  /** Unsaved rule draft evaluated with the rules in force (dry run only). */
  candidate?: { key: string; action: string; severity: string; conditions: unknown; title: string; jurisdiction: string; domain: string };
}
export interface EvaluateOutput { result: ReturnType<typeof mostSevere>; hits: RuleHitDto[]; evaluationIds: string[]; jurisdictionChain: string[]; rulesConsidered: number }

export const DUE_DAYS: Record<string, number> = { block: 7, review: 7, warn: 30, allow: 30 };
export function dueAt(createdAt: Date, result: string): Date {
  return new Date(createdAt.getTime() + (DUE_DAYS[result] ?? 30) * 86_400_000);
}

/** Persist hits for a resource. Only non-allow hits become queue items; the caller audits the business action. */
export async function persistHits(ctx: RequestContext, hits: readonly RuleHitDto[], resourceType: string, resourceId: string): Promise<string[]> {
  const db = tenantDb(ctx);
  const ids: string[] = [];
  for (const h of hits) {
    if (!h.ruleId || h.action === 'allow') continue;
    const row = await db.ruleEvaluation.create({ data: { tenantOrgId: ctx.tenantOrgId!, ruleId: h.ruleId, ruleKey: h.ruleKey, ruleVersion: h.ruleVersion, resourceType, resourceId, result: h.action, evidenceJson: h.evidence as object } });
    ids.push(row.id);
  }
  if (ids.length) {
    await publish(ctx, 'rule.evaluated', { resourceType, resourceId, result: mostSevere(hits.map((h) => h.action)), evaluationIds: ids, ruleKeys: hits.map((h) => h.ruleKey) });
  }
  return ids;
}

/** Resolve jurisdiction, select rules, evaluate deterministically, persist hits, audit. */
export async function evaluateAndPersist(ctx: RequestContext, input: EvaluateInput): Promise<EvaluateOutput> {
  const asOf = input.asOf ?? new Date();
  const resolved = await resolveChain(ctx, { propertyId: input.propertyId, jurisdiction: input.jurisdiction });
  const domains = input.domains ?? (input.domain ? [input.domain] : undefined);
  const rules: EngineRule[] = await loadRulesForChain(resolved.chain, asOf, domains);
  if (input.dryRun && input.candidate) rules.push({ ...input.candidate, version: 0, description: 'Unsaved draft (preview)', sourceUrl: null });
  const out = evaluate(rules, input.facts);
  const evaluationIds = input.dryRun ? [] : await persistHits(ctx, out.hits, input.resourceType, input.resourceId);
  await audit(ctx, {
    action: 'compliance.evaluate',
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: out.result === 'block' ? 'deny' : out.result === 'review' ? 'review_required' : 'allow',
    metadata: { result: out.result, dryRun: Boolean(input.dryRun), domains: domains ?? null, jurisdictionChain: resolved.chain, rulesConsidered: out.rulesConsidered, hits: out.hits.map((h) => `${h.ruleKey}@v${h.ruleVersion}`), evaluationIds },
  });
  return { result: out.result, hits: out.hits, evaluationIds, jurisdictionChain: resolved.chain, rulesConsidered: out.rulesConsidered };
}

type EvaluationRow = { id: string; ruleId: string; ruleKey: string; ruleVersion: number; resourceType: string; resourceId: string; result: string; evidenceJson: unknown; reviewedBy: string | null; reviewedAt: Date | null; resolution: string | null; createdAt: Date; rule: { severity: string; domain: string; jurisdiction: string; title: string; sourceUrl: string | null } };

export function toEvaluationDto(row: EvaluationRow): RuleEvaluationDto {
  const { rule, ...rest } = row;
  return { ...(toDto(rest) as unknown as Omit<RuleEvaluationDto, 'severity' | 'domain' | 'jurisdiction' | 'title' | 'sourceUrl' | 'dueAt'>), severity: rule.severity as RuleEvaluationDto['severity'], domain: rule.domain, jurisdiction: rule.jurisdiction, title: rule.title, sourceUrl: rule.sourceUrl, dueAt: dueAt(row.createdAt, row.result).toISOString() };
}

/** Rules carry no createdBy column; the append-only audit log is the record of who authored a version. */
export async function ruleCreatorId(ruleId: string): Promise<string | null> {
  const row = await prisma.auditLog.findFirst({ where: { resourceType: 'compliance_rule', resourceId: ruleId, action: { in: ['compliance.rule.create', 'compliance.rule.new_version'] } }, orderBy: { createdAt: 'asc' }, select: { actorId: true } });
  return row?.actorId ?? null;
}

/** Unresolved block evaluations prevent a resource from moving forward (notice submit, etc.). */
export async function unresolvedBlocks(ctx: RequestContext, resourceType: string, resourceId: string): Promise<string[]> {
  const rows = await tenantDb(ctx).ruleEvaluation.findMany({ where: { resourceType, resourceId, result: 'block', reviewedAt: null }, select: { ruleKey: true } });
  return rows.map((r) => r.ruleKey);
}
