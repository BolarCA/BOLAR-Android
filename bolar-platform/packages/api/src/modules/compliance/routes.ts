import { Router } from 'express';
import {
  z, idParams, complianceRule, complianceRulePage, ruleQuery, createRule, newRuleVersion, evaluateRulesRequest, evaluateRulesResponse, ruleEvaluation, ruleEvaluationPage, evaluationQuery, resolveEvaluation,
  jurisdictionOverride, jurisdictionOverridePage, createJurisdictionOverride, jurisdictionResolveQuery, jurisdictionResolution, screenTextRequest, screenTextResponse, paginationQuery,
} from '@bolar/contracts';
import { errors, toPage, decodeCursor } from '@bolar/shared';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { requireAccess } from '../../shared/access.js';
import { validateConditions } from './engine.js';
import { loadRulesForChain, resolvePropertyJurisdiction } from './jurisdiction.js';
import { evaluateAndPersist, persistHits, ruleCreatorId, toEvaluationDto } from './service.js';
import { screenText } from './fair-housing.js';

/**
 * Compliance module (blueprint Days 41-45, API p29/p33, UI p51). Rules are platform-global and versioned; evaluations,
 * overrides and the review queue are tenant-scoped. Rule changes and jurisdiction overrides need an accountable human
 * with compliance:approve (p300) and the approver of a version cannot be its author.
 */
const ruleDto = (row: unknown) => toDto(row) as z.infer<typeof complianceRule>;
const toDate = (v: string | null | undefined, fallback: Date | null): Date | null => (v === undefined ? fallback : v === null ? null : new Date(v));

export const complianceRoutes = [
  // ---- Rule catalog (Day 41) ----
  defineRoute({ method: 'get', path: '/rules', operationId: 'listComplianceRules', summary: 'List compliance rules (platform catalog, all versions)', tags: ['compliance'], auth: 'session', permission: 'compliance:read',
    request: { query: ruleQuery }, responses: { 200: complianceRulePage },
    handler: async ({ query }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await prisma.complianceRule.findMany({
        where: { ...(query.jurisdiction ? { jurisdiction: query.jurisdiction.toUpperCase() } : {}), ...(query.domain ? { domain: query.domain } : {}), ...(query.status ? { status: query.status } : {}), ...(query.key ? { key: { contains: query.key.toLowerCase() } } : {}) },
        orderBy: [{ key: 'asc' }, { version: 'desc' }, { id: 'asc' }], take: query.limit + 1, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      return { body: toDto(toPage(rows, query.limit)) };
    } }),
  defineRoute({ method: 'post', path: '/rules', operationId: 'createComplianceRule', summary: 'Create a rule (version 1, draft) for counsel review', tags: ['compliance'], auth: 'mfa', permission: 'compliance:approve',
    request: { body: createRule }, responses: { 201: complianceRule },
    handler: async ({ body, ctx }) => {
      const condErrors = validateConditions(body.conditions);
      if (condErrors.length) throw errors.validation(condErrors.map((e) => ({ path: `body.${e.path}`, message: e.message })));
      if (await prisma.complianceRule.findFirst({ where: { key: body.key }, select: { id: true } })) throw errors.conflict('A rule with this key exists; create a new version instead');
      const row = await prisma.complianceRule.create({ data: { key: body.key, version: 1, jurisdiction: body.jurisdiction, domain: body.domain, title: body.title, description: body.description, severity: body.severity, action: body.action, conditions: body.conditions as object, effectiveFrom: toDate(body.effectiveFrom, new Date())!, effectiveTo: toDate(body.effectiveTo, null), status: 'draft', sourceUrl: body.sourceUrl ?? null } });
      await audit(ctx, { action: 'compliance.rule.create', resourceType: 'compliance_rule', resourceId: row.id, after: { key: row.key, version: row.version, jurisdiction: row.jurisdiction, domain: row.domain, action: row.action, severity: row.severity } });
      return { status: 201, body: ruleDto(row) };
    } }),
  defineRoute({ method: 'get', path: '/rules/evaluations', operationId: 'listRuleEvaluations', summary: 'Compliance review queue: rule hits with severity, due date and evidence', tags: ['compliance'], auth: 'session', permission: 'compliance:read',
    request: { query: evaluationQuery }, responses: { 200: ruleEvaluationPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).ruleEvaluation.findMany({
        where: {
          ...(query.resourceType ? { resourceType: query.resourceType } : {}), ...(query.resourceId ? { resourceId: query.resourceId } : {}), ...(query.result ? { result: query.result } : {}), ...(query.ruleKey ? { ruleKey: query.ruleKey } : {}),
          ...(query.reviewed === 'false' ? { reviewedAt: null } : query.reviewed === 'true' ? { reviewedAt: { not: null } } : {}),
          ...(query.severity || query.domain ? { rule: { ...(query.severity ? { severity: query.severity } : {}), ...(query.domain ? { domain: query.domain } : {}) } } : {}),
        },
        include: { rule: { select: { severity: true, domain: true, jurisdiction: true, title: true, sourceUrl: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map(toEvaluationDto) } };
    } }),
  defineRoute({ method: 'post', path: '/rules/evaluations/:id/resolve', operationId: 'resolveRuleEvaluation', summary: 'Resolve a queue item with reviewer notes (overridden needs compliance:approve)', tags: ['compliance'], auth: 'mfa', permission: 'compliance:write',
    request: { params: idParams, body: resolveEvaluation }, responses: { 200: ruleEvaluation },
    handler: async ({ params, body, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.ruleEvaluation.findFirst({ where: { id: params.id }, include: { rule: { select: { severity: true, domain: true, jurisdiction: true, title: true, sourceUrl: true } } } });
      if (!row) throw errors.notFound();
      if (row.reviewedAt) throw errors.conflict(`Evaluation already resolved as ${row.resolution}`);
      if (body.resolution === 'overridden') {
        if (!ctx.permissions.has('compliance:approve')) {
          await audit(ctx, { action: 'access.denied', resourceType: 'rule_evaluation', resourceId: row.id, outcome: 'deny', metadata: { permission: 'compliance:approve', reason: 'override requires approver' } });
          throw errors.forbidden('Overriding a rule hit requires compliance approval authority');
        }
        if (!body.note || body.note.trim().length < 10) throw errors.validation([{ path: 'body.note', message: 'An override needs a written justification (10+ characters)' }]);
      }
      const updated = await db.ruleEvaluation.update({ where: { id: row.id }, data: { reviewedBy: ctx.actor!.userId, reviewedAt: new Date(), resolution: body.resolution }, include: { rule: { select: { severity: true, domain: true, jurisdiction: true, title: true, sourceUrl: true } } } });
      await audit(ctx, { action: 'compliance.evaluation.resolve', resourceType: 'rule_evaluation', resourceId: row.id, policyVersion: `${row.ruleKey}@v${row.ruleVersion}`, before: { result: row.result }, after: { resolution: body.resolution }, metadata: { note: body.note ?? null, resourceType: row.resourceType, resourceId: row.resourceId } });
      return { status: 200, body: toEvaluationDto(updated) };
    } }),
  defineRoute({ method: 'post', path: '/rules/evaluate', operationId: 'evaluateRules', summary: 'Evaluate the rules in force for a resource and record every hit in the review queue', tags: ['compliance'], auth: 'session', permission: 'compliance:write',
    request: { body: evaluateRulesRequest }, responses: { 201: evaluateRulesResponse },
    handler: async ({ body, ctx }) => {
      if (body.candidate) {
        if (!body.dryRun) throw errors.validation([{ path: 'body.candidate', message: 'candidate rules are only evaluated with dryRun=true' }]);
        const condErrors = validateConditions(body.candidate.conditions);
        if (condErrors.length) throw errors.validation(condErrors.map((e) => ({ path: `body.candidate.${e.path}`, message: e.message })));
      }
      const out = await evaluateAndPersist(ctx, { domain: body.domain, resourceType: body.resourceType, resourceId: body.resourceId, facts: body.facts, propertyId: body.propertyId, jurisdiction: body.jurisdiction, asOf: body.asOf ? new Date(body.asOf) : undefined, dryRun: body.dryRun, candidate: body.candidate });
      return { status: 201, body: out };
    } }),
  defineRoute({ method: 'get', path: '/rules/:id', operationId: 'getComplianceRule', summary: 'Get one rule version', tags: ['compliance'], auth: 'session', permission: 'compliance:read',
    request: { params: idParams }, responses: { 200: complianceRule },
    handler: async ({ params }) => {
      const row = await prisma.complianceRule.findUnique({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      return { body: ruleDto(row) };
    } }),
  defineRoute({ method: 'post', path: '/rules/:id/new-version', operationId: 'createComplianceRuleVersion', summary: 'Copy a rule into a new draft version (bumps version)', tags: ['compliance'], auth: 'mfa', permission: 'compliance:approve',
    request: { params: idParams, body: newRuleVersion }, responses: { 201: complianceRule },
    handler: async ({ params, body, ctx }) => {
      const base = await prisma.complianceRule.findUnique({ where: { id: params.id } });
      if (!base) throw errors.notFound();
      if (body.conditions) {
        const condErrors = validateConditions(body.conditions);
        if (condErrors.length) throw errors.validation(condErrors.map((e) => ({ path: `body.${e.path}`, message: e.message })));
      }
      const latest = await prisma.complianceRule.findFirst({ where: { key: base.key }, orderBy: { version: 'desc' }, select: { version: true } });
      const row = await prisma.complianceRule.create({ data: {
        key: base.key, version: (latest?.version ?? base.version) + 1, jurisdiction: body.jurisdiction ?? base.jurisdiction, domain: body.domain ?? base.domain, title: body.title ?? base.title, description: body.description ?? base.description,
        severity: body.severity ?? base.severity, action: body.action ?? base.action, conditions: (body.conditions ?? base.conditions) as object, effectiveFrom: toDate(body.effectiveFrom, new Date())!, effectiveTo: toDate(body.effectiveTo, base.effectiveTo),
        status: 'draft', sourceUrl: body.sourceUrl === undefined ? base.sourceUrl : body.sourceUrl,
      } });
      await audit(ctx, { action: 'compliance.rule.new_version', resourceType: 'compliance_rule', resourceId: row.id, before: { fromRuleId: base.id, version: base.version }, after: { key: row.key, version: row.version } });
      return { status: 201, body: ruleDto(row) };
    } }),
  defineRoute({ method: 'post', path: '/rules/:id/activate', operationId: 'activateComplianceRule', summary: 'Activate a draft version (approver must differ from author); retires earlier versions', tags: ['compliance'], auth: 'mfa', permission: 'compliance:approve',
    request: { params: idParams }, responses: { 200: complianceRule },
    handler: async ({ params, ctx }) => {
      const row = await prisma.complianceRule.findUnique({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (row.status !== 'draft') throw errors.conflict(`Rule version is ${row.status}`);
      const creator = await ruleCreatorId(row.id);
      if (creator && creator === ctx.actor!.userId) throw errors.forbidden('The author of a rule version cannot approve it');
      const retired = await prisma.complianceRule.updateMany({ where: { key: row.key, status: 'active', NOT: { id: row.id } }, data: { status: 'retired' } });
      const updated = await prisma.complianceRule.update({ where: { id: row.id }, data: { status: 'active', approvedBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'compliance.rule.activate', resourceType: 'compliance_rule', resourceId: row.id, policyVersion: `${row.key}@v${row.version}`, before: { status: 'draft' }, after: { status: 'active', retiredPrevious: retired.count } });
      await publish(ctx, 'compliance.rule.activated', { ruleId: row.id, key: row.key, version: row.version });
      return { status: 200, body: ruleDto(updated) };
    } }),
  defineRoute({ method: 'post', path: '/rules/:id/retire', operationId: 'retireComplianceRule', summary: 'Retire a rule version', tags: ['compliance'], auth: 'mfa', permission: 'compliance:approve',
    request: { params: idParams }, responses: { 200: complianceRule },
    handler: async ({ params, ctx }) => {
      const row = await prisma.complianceRule.findUnique({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (row.status === 'retired') throw errors.conflict('Rule version is already retired');
      const updated = await prisma.complianceRule.update({ where: { id: row.id }, data: { status: 'retired', effectiveTo: row.effectiveTo ?? new Date() } });
      await audit(ctx, { action: 'compliance.rule.retire', resourceType: 'compliance_rule', resourceId: row.id, policyVersion: `${row.key}@v${row.version}`, before: { status: row.status }, after: { status: 'retired' } });
      return { status: 200, body: ruleDto(updated) };
    } }),

  // ---- Jurisdiction resolver (Day 42) ----
  defineRoute({ method: 'get', path: '/jurisdiction/resolve', operationId: 'resolveJurisdiction', summary: 'Resolve the jurisdiction chain and active rule keys for a property', tags: ['compliance'], auth: 'session', permission: 'compliance:read',
    request: { query: jurisdictionResolveQuery }, responses: { 200: jurisdictionResolution },
    handler: async ({ query, ctx }) => {
      await requireAccess(ctx, 'compliance:read', { type: 'property', id: query.propertyId, propertyId: query.propertyId }, ['owner_of', 'manages']);
      const resolved = await resolvePropertyJurisdiction(ctx, query.propertyId);
      const rules = await loadRulesForChain(resolved.chain, query.asOf ? new Date(query.asOf) : new Date());
      return { body: { propertyId: query.propertyId, chain: resolved.chain, override: resolved.override ? toDto(resolved.override) : null, activeRules: rules.map((r) => ({ id: r.id, key: r.key, version: r.version, domain: r.domain, jurisdiction: r.jurisdiction, action: r.action as 'allow', severity: r.severity as 'low', title: r.title })) } };
    } }),
  defineRoute({ method: 'get', path: '/jurisdiction/overrides', operationId: 'listJurisdictionOverrides', summary: 'List property jurisdiction overrides', tags: ['compliance'], auth: 'session', permission: 'compliance:read',
    request: { query: paginationQuery.extend({ propertyId: z.string().optional() }) }, responses: { 200: jurisdictionOverridePage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).jurisdictionOverride.findMany({ where: query.propertyId ? { propertyId: query.propertyId } : {}, orderBy: { id: 'asc' }, take: query.limit + 1, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      return { body: toDto(toPage(rows, query.limit)) };
    } }),
  defineRoute({ method: 'post', path: '/jurisdiction/overrides', operationId: 'upsertJurisdictionOverride', summary: 'Set a property jurisdiction override (accountable human; audited)', tags: ['compliance'], auth: 'mfa', permission: 'compliance:approve',
    request: { body: createJurisdictionOverride }, responses: { 201: jurisdictionOverride },
    handler: async ({ body, ctx }) => {
      const db = tenantDb(ctx);
      const property = await db.property.findFirst({ where: { id: body.propertyId }, select: { id: true } });
      if (!property) throw errors.validation([{ path: 'body.propertyId', message: 'Unknown property' }]);
      const existing = await db.jurisdictionOverride.findFirst({ where: { propertyId: body.propertyId } });
      const row = existing
        ? await db.jurisdictionOverride.update({ where: { id: existing.id }, data: { jurisdiction: body.jurisdiction, reason: body.reason, createdBy: ctx.actor!.userId } })
        : await db.jurisdictionOverride.create({ data: { tenantOrgId: ctx.tenantOrgId!, propertyId: body.propertyId, jurisdiction: body.jurisdiction, reason: body.reason, createdBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'compliance.jurisdiction.override', resourceType: 'property', resourceId: body.propertyId, before: existing ? { jurisdiction: existing.jurisdiction } : undefined, after: { jurisdiction: row.jurisdiction, reason: row.reason } });
      return { status: 201, body: toDto(row) };
    } }),

  // ---- Fair housing / SOI guard (Day 44) ----
  defineRoute({ method: 'post', path: '/compliance/screen-text', operationId: 'screenText', summary: 'Flag protected-class or source-of-income language for human review', tags: ['compliance'], auth: 'session', permission: 'compliance:write',
    request: { body: screenTextRequest }, responses: { 201: screenTextResponse },
    handler: async ({ body, ctx }) => {
      const guard = await screenText(body.text);
      const evaluationIds = body.resourceType && body.resourceId ? await persistHits(ctx, guard.ruleHits, body.resourceType, body.resourceId) : [];
      if (guard.flagged) await audit(ctx, { action: 'compliance.guard.fired', resourceType: body.resourceType ?? 'text', resourceId: body.resourceId ?? null, outcome: 'review_required', metadata: { hits: guard.hits.map((h) => `${h.ruleKey}:${h.term}`), evaluationIds } });
      return { status: 201, body: { flagged: guard.flagged, hits: guard.hits, evaluationIds } };
    } }),
];

export const complianceRouter: Router = Router();
mount(complianceRouter, complianceRoutes);
