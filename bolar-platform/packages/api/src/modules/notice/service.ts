/**
 * Notice service (Days 43-45): renders a notice body from the approved template registry (tenant template first, then
 * platform template, then built-in FCRA defaults), runs the fair-housing/SOI guard and the domain=notice rules, and
 * records every hit in the review queue. Notices are drafts until a different human approves them (p300).
 */
import type { NoticeWithGuardDto, RuleHitDto } from '@bolar/contracts';
import { errors, type Permission, type RequestContext, StateMachine } from '@bolar/shared';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { toDto } from '../../shared/route.js';
import { mostSevere } from '../compliance/engine.js';
import { screenText } from '../compliance/fair-housing.js';
import { evaluateAndPersist, persistHits } from '../compliance/service.js';

export type NoticeStatus = 'draft' | 'pending_approval' | 'approved' | 'sent' | 'rejected' | 'canceled';

export const noticeMachine = new StateMachine<NoticeStatus, Permission>([
  { from: 'draft', to: 'pending_approval', allowed: (p) => p.includes('notice:draft') },
  { from: 'pending_approval', to: 'approved', allowed: (p) => p.includes('notice:approve') },
  { from: 'pending_approval', to: 'rejected', allowed: (p) => p.includes('notice:approve') },
  { from: 'rejected', to: 'draft', allowed: (p) => p.includes('notice:draft') },
  { from: 'approved', to: 'sent', allowed: (p) => p.includes('notice:draft') || p.includes('notice:approve') },
  { from: ['draft', 'pending_approval', 'approved', 'rejected'], to: 'canceled', allowed: (p) => p.includes('notice:draft') || p.includes('notice:approve') },
]);

/** Built-in bodies used when the template registry has no approved version for the key (keeps FCRA flows working). */
export const DEFAULT_NOTICE_BODIES: Record<string, string> = {
  'notice.pre_adverse': 'Dear {{applicantName}}, we are considering an adverse decision based in whole or part on a consumer report from {{providerName}}. A copy of the report and the Summary of Rights is enclosed. You have {{waitingDays}} days to dispute.',
  'notice.final_adverse': 'Dear {{applicantName}}, your application was {{decision}}. Reasons: {{reasons}}. Report provider: {{providerName}} ({{providerContact}}). The provider did not make this decision.',
  'notice.late_rent': 'Dear {{tenantName}}, rent of {{amount}} for {{period}} was due {{dueDate}} and remains unpaid. Please remit by {{cureDate}}. {{jurisdictionClause}}',
  'notice.entry': 'Dear {{tenantName}}, we will need to enter your unit on {{entryAt}} for: {{reason}}. Please contact the office with any questions.',
  'notice.general': '{{body}}',
};

export function renderTemplate(body: string, variables: Record<string, unknown>): string {
  return body.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, key: string) => {
    const v = variables[key];
    return v === undefined || v === null ? '' : String(v);
  });
}

/** Approved template body for a key: tenant-owned first, then platform (tenantOrgId null), then built-in default. */
export async function resolveTemplateBody(tenantOrgId: string, templateKey: string): Promise<{ body: string; source: 'tenant' | 'platform' | 'builtin' } | null> {
  const templates = await prisma.template.findMany({ where: { key: templateKey, OR: [{ tenantOrgId }, { tenantOrgId: null }] }, include: { versions: { where: { status: 'approved' }, orderBy: { version: 'desc' }, take: 1 } } });
  const tenantTpl = templates.find((t) => t.tenantOrgId === tenantOrgId && t.versions.length);
  if (tenantTpl) return { body: tenantTpl.versions[0]!.body, source: 'tenant' };
  const platformTpl = templates.find((t) => t.tenantOrgId === null && t.versions.length);
  if (platformTpl) return { body: platformTpl.versions[0]!.body, source: 'platform' };
  const builtin = DEFAULT_NOTICE_BODIES[templateKey];
  return builtin ? { body: builtin, source: 'builtin' } : null;
}

export interface CreateNoticeInput { kind: string; templateKey: string; recipientId: string; leaseId?: string; variables: Record<string, unknown>; body?: string; facts?: Record<string, unknown>; propertyId?: string }

export async function createNoticeDraft(ctx: RequestContext, input: CreateNoticeInput): Promise<NoticeWithGuardDto> {
  const db = tenantDb(ctx);
  const recipient = await db.tenantProfile.findFirst({ where: { id: input.recipientId }, select: { id: true, displayName: true } });
  if (!recipient) throw errors.validation([{ path: 'body.recipientId', message: 'Unknown recipient' }]);
  let propertyId = input.propertyId;
  if (input.leaseId) {
    const lease = await db.lease.findFirst({ where: { id: input.leaseId }, select: { id: true, propertyId: true } });
    if (!lease) throw errors.validation([{ path: 'body.leaseId', message: 'Unknown lease' }]);
    propertyId ??= lease.propertyId;
  }
  const variables = { tenantName: recipient.displayName, applicantName: recipient.displayName, ...input.variables };
  const template = await resolveTemplateBody(ctx.tenantOrgId!, input.templateKey);
  const rawBody = template?.body ?? input.body;
  if (!rawBody) throw errors.validation([{ path: 'body.templateKey', message: 'No approved template for this key; provide a body for an ad-hoc notice' }]);
  const rendered = renderTemplate(rawBody, variables);

  const notice = await db.notice.create({ data: { tenantOrgId: ctx.tenantOrgId!, kind: input.kind, templateKey: input.templateKey, recipientId: recipient.id, leaseId: input.leaseId ?? null, status: 'draft', bodyDraft: rendered, variables: variables as object, createdBy: ctx.actor?.userId ?? 'system' } });

  // Guard (Day 44) + domain rules (entry lead time, etc.). Both persist hits against the notice.
  const guard = await screenText(rendered);
  const guardIds = await persistHits(ctx, guard.ruleHits, 'notice', notice.id);
  const facts = { kind: input.kind, templateKey: input.templateKey, ...(input.facts ?? {}) };
  const domainEval = await evaluateAndPersist(ctx, { domain: 'notice', resourceType: 'notice', resourceId: notice.id, facts, propertyId });
  const ruleEvaluationIds = [...guardIds, ...domainEval.evaluationIds];
  const ruleHits: RuleHitDto[] = [...guard.ruleHits, ...domainEval.hits];
  const result = mostSevere(ruleHits.map((h) => h.action));
  const updated = await db.notice.update({ where: { id: notice.id }, data: { ruleEvaluationIds } });
  await audit(ctx, { action: 'notice.create', resourceType: 'notice', resourceId: notice.id, outcome: result === 'block' ? 'deny' : result === 'review' ? 'review_required' : 'allow', after: { kind: input.kind, templateKey: input.templateKey, templateSource: template?.source ?? 'ad_hoc', result, ruleEvaluationIds } });
  if (guard.flagged) await audit(ctx, { action: 'compliance.guard.fired', resourceType: 'notice', resourceId: notice.id, outcome: 'review_required', metadata: { hits: guard.hits.map((h) => `${h.ruleKey}:${h.term}`) } });
  return { ...(toDto(updated) as unknown as NoticeWithGuardDto), recipientName: recipient.displayName, guard: { flagged: guard.flagged, hits: guard.hits }, ruleHits, result };
}
