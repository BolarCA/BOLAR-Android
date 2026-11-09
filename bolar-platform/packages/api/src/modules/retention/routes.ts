import { Router } from 'express';
import {
  idParams, retentionPolicy, retentionPolicyList, createRetentionPolicy, updateRetentionPolicy, retentionAssignment, retentionAssignmentPage, retentionAssignmentQuery,
  createRetentionAssignment, retentionDecision, retentionDispose, retentionSweepResult,
} from '@bolar/contracts';
import { errors, toPage, decodeCursor } from '@bolar/shared';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { disposeAssignment, effectivePolicies, policyByKey, sweepRetention } from './service.js';
import { isHeld } from '../legal-hold/service.js';

export { sweepRetention, sweepAllTenants } from './service.js';

const DAY_MS = 86_400_000;

async function assignmentDto(row: { policyId: string } & Record<string, unknown>) {
  const policy = await prisma.retentionPolicy.findUnique({ where: { id: row.policyId }, select: { key: true } });
  return { ...toDto(row), policyKey: policy?.key };
}

export const retentionRoutes = [
  // ---- Policies ----
  defineRoute({ method: 'get', path: '/retention/policies', operationId: 'listRetentionPolicies', summary: 'Effective retention policies (platform defaults plus org overrides)', tags: ['retention'], auth: 'session', permission: 'retention:read',
    responses: { 200: retentionPolicyList },
    handler: async ({ ctx }) => ({ body: { items: toDto(await effectivePolicies(ctx.tenantOrgId!)) } }) }),
  defineRoute({ method: 'post', path: '/retention/policies', operationId: 'createRetentionPolicy', summary: 'Create an org retention policy (overrides a platform default with the same key)', tags: ['retention'], auth: 'mfa', permission: 'retention:write',
    request: { body: createRetentionPolicy }, responses: { 201: retentionPolicy },
    handler: async ({ body, ctx }) => {
      const dup = await prisma.retentionPolicy.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, key: body.key } });
      if (dup) throw errors.conflict('An org policy with this key already exists');
      const row = await prisma.retentionPolicy.create({ data: { ...body, tenantOrgId: ctx.tenantOrgId! } });
      await audit(ctx, { action: 'retention.policy_created', resourceType: 'retention_policy', resourceId: row.id, after: toDto(row) });
      return { status: 201, body: { ...toDto(row), isPlatformDefault: false } };
    } }),
  defineRoute({ method: 'patch', path: '/retention/policies/:id', operationId: 'updateRetentionPolicy', summary: 'Update an org retention policy (platform defaults are read-only)', tags: ['retention'], auth: 'mfa', permission: 'retention:write',
    request: { params: idParams, body: updateRetentionPolicy }, responses: { 200: retentionPolicy },
    handler: async ({ params, body, ctx }) => {
      const before = await prisma.retentionPolicy.findFirst({ where: { id: params.id, tenantOrgId: ctx.tenantOrgId! } });
      if (!before) throw errors.notFound();
      const row = await prisma.retentionPolicy.update({ where: { id: before.id }, data: body });
      await audit(ctx, { action: 'retention.policy_updated', resourceType: 'retention_policy', resourceId: row.id, before: toDto(before), after: body });
      return { status: 200, body: { ...toDto(row), isPlatformDefault: false } };
    } }),

  // ---- Assignments ----
  defineRoute({ method: 'get', path: '/retention/assignments', operationId: 'listRetentionAssignments', summary: 'List retention assignments (filter by state, resource type, due date)', tags: ['retention'], auth: 'session', permission: 'retention:read',
    request: { query: retentionAssignmentQuery }, responses: { 200: retentionAssignmentPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).retentionAssignment.findMany({
        where: { ...(query.state ? { state: query.state } : {}), ...(query.resourceType ? { resourceType: query.resourceType } : {}), ...(query.dueBefore ? { retainUntil: { lte: new Date(query.dueBefore) } } : {}) },
        take: query.limit + 1, orderBy: { id: 'asc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      const policies = await prisma.retentionPolicy.findMany({ where: { id: { in: [...new Set(page.items.map((r) => r.policyId))] } }, select: { id: true, key: true } });
      const keyOf = new Map(policies.map((p) => [p.id, p.key]));
      return { body: { ...page, items: page.items.map((r) => ({ ...toDto(r), policyKey: keyOf.get(r.policyId) })) } };
    } }),
  defineRoute({ method: 'post', path: '/retention/assignments', operationId: 'assignRetention', summary: 'Attach a retention policy to a record (upsert per resource); retainUntil = anchor + retainDays', tags: ['retention'], auth: 'mfa', permission: 'retention:write',
    request: { body: createRetentionAssignment }, responses: { 201: retentionAssignment },
    handler: async ({ body, ctx }) => {
      const policy = await policyByKey(ctx.tenantOrgId!, body.policyKey);
      if (!policy) throw errors.validation([{ path: 'body.policyKey', message: 'Unknown retention policy' }]);
      if (policy.resourceType !== body.resourceType) throw errors.validation([{ path: 'body.resourceType', message: `Policy ${policy.key} applies to ${policy.resourceType}` }]);
      const anchor = body.anchorDate ? new Date(body.anchorDate) : new Date();
      const retainUntil = new Date(anchor.getTime() + policy.retainDays * DAY_MS);
      const existing = await prisma.retentionAssignment.findUnique({ where: { tenantOrgId_resourceType_resourceId: { tenantOrgId: ctx.tenantOrgId!, resourceType: body.resourceType, resourceId: body.resourceId } } });
      if (existing && existing.state === 'disposed') throw errors.conflict('Record has already been disposed');
      const row = existing
        ? await prisma.retentionAssignment.update({ where: { id: existing.id }, data: { policyId: policy.id, retainUntil, state: existing.state === 'held' ? 'held' : 'retained', proposedAt: null, approvedBy: null } })
        : await prisma.retentionAssignment.create({ data: { tenantOrgId: ctx.tenantOrgId!, policyId: policy.id, resourceType: body.resourceType, resourceId: body.resourceId, retainUntil } });
      await audit(ctx, { action: existing ? 'retention.reassigned' : 'retention.assigned', resourceType: body.resourceType, resourceId: body.resourceId, before: existing ? { policyId: existing.policyId, retainUntil: existing.retainUntil } : undefined, after: { policyKey: policy.key, retainUntil, assignmentId: row.id } });
      return { status: existing ? 200 : 201, body: { ...toDto(row), policyKey: policy.key } };
    } }),
  defineRoute({ method: 'post', path: '/retention/sweep', operationId: 'sweepRetention', summary: 'Propose dispositions for due assignments (never deletes; held records are marked held)', tags: ['retention'], auth: 'mfa', permission: 'retention:write',
    responses: { 200: retentionSweepResult },
    handler: async ({ ctx }) => {
      const result = await sweepRetention(ctx);
      await audit(ctx, { action: 'retention.sweep', resourceType: 'retention_assignment', metadata: { ...result } });
      return { status: 200, body: result };
    } }),
  defineRoute({ method: 'post', path: '/retention/assignments/:id/approve', operationId: 'approveRetentionDisposition', summary: 'Approve a proposed disposition (human gate; the proposer is the system)', tags: ['retention'], auth: 'mfa',
    request: { params: idParams, body: retentionDecision }, responses: { 200: retentionAssignment },
    handler: async ({ params, body, ctx }) => {
      if (!ctx.permissions.has('privacy_request:approve') && !ctx.permissions.has('compliance:approve')) throw errors.forbidden();
      const db = tenantDb(ctx);
      const a = await db.retentionAssignment.findFirst({ where: { id: params.id } });
      if (!a) throw errors.notFound();
      if (a.state !== 'proposed') throw errors.invalidTransition(a.state, 'approved');
      const check = await isHeld(ctx.tenantOrgId!, a.resourceType, a.resourceId);
      if (check.held) {
        await db.retentionAssignment.update({ where: { id: a.id }, data: { state: 'held' } });
        throw errors.legalHold();
      }
      const row = await db.retentionAssignment.update({ where: { id: a.id }, data: { state: 'approved', approvedBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'retention.approved', resourceType: a.resourceType, resourceId: a.resourceId, before: { state: 'proposed' }, after: { state: 'approved' }, metadata: { assignmentId: a.id, note: body.note } });
      return { status: 200, body: await assignmentDto(row) };
    } }),
  defineRoute({ method: 'post', path: '/retention/assignments/:id/dispose', operationId: 'disposeRetentionAssignment', summary: 'Execute an approved disposition (blocked 409 legal_hold when held)', tags: ['retention'], auth: 'mfa', permission: 'retention:write',
    request: { params: idParams, body: retentionDispose }, responses: { 200: retentionAssignment },
    handler: async ({ params, body, ctx }) => {
      const { row, dispositionNote } = await disposeAssignment(ctx, params.id, body.note);
      return { status: 200, body: { ...(await assignmentDto(row)), dispositionNote } };
    } }),
  defineRoute({ method: 'post', path: '/retention/assignments/:id/hold', operationId: 'holdRetentionAssignment', summary: 'Place a retention assignment on hold (stops proposal/disposal until released)', tags: ['retention'], auth: 'mfa', permission: 'retention:write',
    request: { params: idParams, body: retentionDecision }, responses: { 200: retentionAssignment },
    handler: async ({ params, body, ctx }) => {
      const db = tenantDb(ctx);
      const a = await db.retentionAssignment.findFirst({ where: { id: params.id } });
      if (!a) throw errors.notFound();
      if (a.state === 'disposed') throw errors.invalidTransition(a.state, 'held');
      const row = await db.retentionAssignment.update({ where: { id: a.id }, data: { state: 'held' } });
      await audit(ctx, { action: 'retention.hold', resourceType: a.resourceType, resourceId: a.resourceId, before: { state: a.state }, after: { state: 'held' }, metadata: { assignmentId: a.id, note: body.note } });
      return { status: 200, body: await assignmentDto(row) };
    } }),
];

export const retentionRouter: Router = Router();
mount(retentionRouter, retentionRoutes);
