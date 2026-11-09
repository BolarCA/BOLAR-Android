import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  idParams, paginationQuery, legalCase, legalCasePage, legalCaseQuery, createCase, updateCase, addCaseDeadline, caseLegalHold, caseTimelinePage,
  agencyRequest, agencyRequestPage, agencyRequestQuery, createAgencyRequest, agencyLegalReview, agencyDecide, agencyFulfill, legalHold,
} from '@bolar/contracts';
import { errors, toPage, decodeCursor, type RequestContext } from '@bolar/shared';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { hasRelationship, rolesCovering } from '../../shared/access.js';
import { publish } from '../../shared/events.js';
import { syncDocumentHoldFlags } from '../legal-hold/service.js';

const DAY_MS = 86_400_000;
type CaseRow = { id: string; privileged: boolean; leadLawyerId: string | null; createdBy: string; leaseId: string | null; propertyId: string | null; tenantProfileId: string | null };

/** Ids of cases the actor may see beyond non-privileged ones: lead, creator, represents-edge or case-scoped role. */
async function visibleCaseFilter(ctx: RequestContext) {
  const userId = ctx.actor!.userId;
  const edges = await prisma.relationshipEdge.findMany({ where: { tenantOrgId: ctx.tenantOrgId!, subjectType: 'user', subjectId: userId, relation: 'represents', objectType: 'case', OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, select: { objectId: true } });
  const scoped = ctx.roles.filter((r) => r.scopeType === 'case' && r.scopeId).map((r) => r.scopeId!);
  return { OR: [{ privileged: false }, { leadLawyerId: userId }, { createdBy: userId }, { id: { in: [...edges.map((e) => e.objectId), ...scoped] } }] };
}

/**
 * Privileged cases are restricted: only the lead lawyer, the creator, a `represents` relationship holder or a
 * case-scoped role may open them. Everyone else gets 404 (no existence leak) plus an access.denied audit row.
 */
async function loadCase(ctx: RequestContext, id: string, permission: 'case:read' | 'case:write'): Promise<CaseRow & Record<string, unknown>> {
  const row = await tenantDb(ctx).case.findFirst({ where: { id } });
  if (!row) throw errors.notFound();
  const userId = ctx.actor!.userId;
  const ref = { type: 'case', id: row.id, propertyId: row.propertyId, caseId: row.id };
  const direct = row.leadLawyerId === userId || row.createdBy === userId;
  const scopedRole = rolesCovering(ctx.roles, ref).some((r) => r.scopeType === 'case');
  const represents = direct || scopedRole ? true : await hasRelationship(ctx, ['represents'], ref);
  const allowed = ctx.permissions.has(permission) && (!row.privileged || direct || scopedRole || represents);
  if (!allowed) {
    await audit(ctx, { action: 'access.denied', resourceType: 'case', resourceId: row.id, outcome: 'deny', metadata: { permission, reason: row.privileged ? 'privileged case: no represents relationship or lead assignment' : 'missing permission' } });
    throw errors.notFound();
  }
  return row as CaseRow & Record<string, unknown>;
}

async function caseDto(ctx: RequestContext, row: { id: string } & Record<string, unknown>) {
  const holds = await prisma.legalHold.findMany({ where: { tenantOrgId: ctx.tenantOrgId!, status: 'active', scopeJson: { path: ['caseIds'], array_contains: [row.id] } }, select: { id: true }, take: 100 });
  return { ...toDto(row), activeHoldIds: holds.map((h) => h.id) };
}

async function ensureRepresents(ctx: RequestContext, lawyerId: string, caseId: string) {
  const dup = await prisma.relationshipEdge.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, subjectType: 'user', subjectId: lawyerId, relation: 'represents', objectType: 'case', objectId: caseId, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } });
  if (!dup) await prisma.relationshipEdge.create({ data: { tenantOrgId: ctx.tenantOrgId!, subjectType: 'user', subjectId: lawyerId, relation: 'represents', objectType: 'case', objectId: caseId, grantedBy: ctx.actor!.userId } });
}

const isCounsel = (ctx: RequestContext) => ctx.permissions.has('agency_request:approve');

export const legalRoutes = [
  // ---- Cases (p52 legal case workspace) ----
  defineRoute({ method: 'get', path: '/cases', operationId: 'listCases', summary: 'List cases visible to the actor (privileged cases require representation)', tags: ['legal'], auth: 'session', permission: 'case:read',
    request: { query: legalCaseQuery }, responses: { 200: legalCasePage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).case.findMany({ where: { ...(await visibleCaseFilter(ctx)), ...(query.status ? { status: query.status } : {}), ...(query.kind ? { kind: query.kind } : {}) }, take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: await Promise.all(page.items.map((r) => caseDto(ctx, r))) } };
    } }),
  defineRoute({ method: 'post', path: '/cases', operationId: 'createCase', summary: 'Open a case (privileged by default; the creator or named lead lawyer gets a represents relationship)', tags: ['legal'], auth: 'mfa', permission: 'case:write',
    request: { body: createCase }, responses: { 201: legalCase },
    handler: async ({ body, ctx }) => {
      const tenantOrgId = ctx.tenantOrgId!;
      if (body.leaseId && !(await prisma.lease.findFirst({ where: { id: body.leaseId, tenantOrgId }, select: { id: true } }))) throw errors.validation([{ path: 'body.leaseId', message: 'Unknown lease' }]);
      if (body.propertyId && !(await prisma.property.findFirst({ where: { id: body.propertyId, tenantOrgId }, select: { id: true } }))) throw errors.validation([{ path: 'body.propertyId', message: 'Unknown property' }]);
      if (body.tenantProfileId && !(await prisma.tenantProfile.findFirst({ where: { id: body.tenantProfileId, tenantOrgId }, select: { id: true } }))) throw errors.validation([{ path: 'body.tenantProfileId', message: 'Unknown tenant profile' }]);
      const leadLawyerId = body.leadLawyerId ?? ctx.actor!.userId;
      if (!(await prisma.userProfile.findFirst({ where: { id: leadLawyerId, tenantOrgId }, select: { id: true } }))) throw errors.validation([{ path: 'body.leadLawyerId', message: 'Unknown user' }]);
      const lease = body.leaseId ? await prisma.lease.findFirst({ where: { id: body.leaseId, tenantOrgId }, select: { propertyId: true } }) : null;
      const row = await tenantDb(ctx).case.create({ data: { tenantOrgId, title: body.title, kind: body.kind, leaseId: body.leaseId ?? null, propertyId: body.propertyId ?? lease?.propertyId ?? null, tenantProfileId: body.tenantProfileId ?? null, leadLawyerId, privileged: body.privileged, deadlines: [], createdBy: ctx.actor!.userId } });
      await ensureRepresents(ctx, leadLawyerId, row.id);
      await audit(ctx, { action: 'case.created', resourceType: 'case', resourceId: row.id, after: { title: row.title, kind: row.kind, privileged: row.privileged, leadLawyerId } });
      await publish(ctx, 'case.created', { caseId: row.id, kind: row.kind });
      return { status: 201, body: await caseDto(ctx, row) };
    } }),
  defineRoute({ method: 'get', path: '/cases/:id', operationId: 'getCase', summary: 'Case detail (privileged and confidential; access is logged)', tags: ['legal'], auth: 'session', permission: 'case:read',
    request: { params: idParams }, responses: { 200: legalCase },
    handler: async ({ params, ctx }) => {
      const row = await loadCase(ctx, params.id, 'case:read');
      await audit(ctx, { action: 'case.accessed', resourceType: 'case', resourceId: row.id, metadata: { privileged: row.privileged } });
      return { body: await caseDto(ctx, row) };
    } }),
  defineRoute({ method: 'patch', path: '/cases/:id', operationId: 'updateCase', summary: 'Update case status, lead lawyer or deadlines', tags: ['legal'], auth: 'mfa', permission: 'case:write',
    request: { params: idParams, body: updateCase }, responses: { 200: legalCase },
    handler: async ({ params, body, ctx }) => {
      const row = await loadCase(ctx, params.id, 'case:write');
      if (body.status && body.status !== row.status) {
        const from = row.status as string;
        const allowed: Record<string, string[]> = { open: ['active', 'on_hold', 'closed'], active: ['on_hold', 'closed'], on_hold: ['active', 'closed'], closed: [] };
        if (!allowed[from]?.includes(body.status)) throw errors.invalidTransition(from, body.status);
      }
      if (body.leadLawyerId && !(await prisma.userProfile.findFirst({ where: { id: body.leadLawyerId, tenantOrgId: ctx.tenantOrgId! }, select: { id: true } }))) throw errors.validation([{ path: 'body.leadLawyerId', message: 'Unknown user' }]);
      const deadlines = body.deadlines?.map((d) => ({ id: d.id ?? randomUUID(), title: d.title, dueAt: d.dueAt, done: d.done ?? false }));
      const { note: _note, deadlines: _d, ...rest } = body;
      const updated = await tenantDb(ctx).case.update({ where: { id: row.id }, data: { ...rest, ...(deadlines ? { deadlines } : {}) } });
      if (body.leadLawyerId) await ensureRepresents(ctx, body.leadLawyerId, row.id);
      await audit(ctx, { action: body.status && body.status !== row.status ? 'case.transitioned' : 'case.updated', resourceType: 'case', resourceId: row.id, before: { status: row.status, leadLawyerId: row.leadLawyerId }, after: { ...rest, deadlines: deadlines?.length }, metadata: { note: body.note } });
      return { status: 200, body: await caseDto(ctx, updated) };
    } }),
  defineRoute({ method: 'post', path: '/cases/:id/deadlines', operationId: 'addCaseDeadline', summary: 'Add a deadline/task to a case', tags: ['legal'], auth: 'mfa', permission: 'case:write',
    request: { params: idParams, body: addCaseDeadline }, responses: { 201: legalCase },
    handler: async ({ params, body, ctx }) => {
      const row = await loadCase(ctx, params.id, 'case:write');
      const deadlines = [...((row.deadlines as unknown[]) ?? []), { id: randomUUID(), title: body.title, dueAt: body.dueAt, done: false }];
      const updated = await tenantDb(ctx).case.update({ where: { id: row.id }, data: { deadlines } });
      await audit(ctx, { action: 'case.deadline_added', resourceType: 'case', resourceId: row.id, after: { title: body.title, dueAt: body.dueAt } });
      return { status: 201, body: await caseDto(ctx, updated) };
    } }),
  defineRoute({ method: 'post', path: '/cases/:id/legal-hold', operationId: 'createCaseLegalHold', summary: 'Place a legal hold scoped to the case and its linked lease, property and tenant profile', tags: ['legal'], auth: 'mfa', permission: 'legal_hold:write',
    request: { params: idParams, body: caseLegalHold }, responses: { 201: legalHold },
    handler: async ({ params, body, ctx }) => {
      const row = await loadCase(ctx, params.id, 'case:read');
      const scope = { caseIds: [row.id], ...(row.leaseId ? { leaseIds: [row.leaseId] } : {}), ...(row.propertyId ? { propertyIds: [row.propertyId] } : {}), ...(row.tenantProfileId ? { tenantProfileIds: [row.tenantProfileId] } : {}) };
      const hold = await tenantDb(ctx).legalHold.create({ data: { tenantOrgId: ctx.tenantOrgId!, name: body.name ?? `Hold: ${row.title}`, reason: body.reason, scopeJson: scope, status: 'active', approvedBy: ctx.actor!.userId, createdBy: ctx.actor!.userId } });
      const flagged = await syncDocumentHoldFlags(ctx.tenantOrgId!, scope, true);
      await audit(ctx, { action: 'legal_hold.created', resourceType: 'legal_hold', resourceId: hold.id, after: { name: hold.name, scope, caseId: row.id, documentsFlagged: flagged }, metadata: { note: body.note } });
      await publish(ctx, 'legal_hold.created', { legalHoldId: hold.id, scope, caseId: row.id });
      return { status: 201, body: toDto(hold) };
    } }),
  defineRoute({ method: 'get', path: '/cases/:id/timeline', operationId: 'getCaseTimeline', summary: 'Audit timeline for the case and its linked lease', tags: ['legal'], auth: 'session', permission: 'case:read',
    request: { params: idParams, query: paginationQuery }, responses: { 200: caseTimelinePage },
    handler: async ({ params, query, ctx }) => {
      const row = await loadCase(ctx, params.id, 'case:read');
      const c = decodeCursor<{ id: string }>(query.cursor);
      const targets = [{ resourceType: 'case', resourceId: row.id }, ...(row.leaseId ? [{ resourceType: 'lease', resourceId: row.leaseId }] : [])];
      const rows = await tenantDb(ctx).auditLog.findMany({ where: { OR: targets, NOT: { action: 'access.denied' } }, take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map((r) => toDto({ id: r.id, actorId: r.actorId, action: r.action, resourceType: r.resourceType, resourceId: r.resourceId, outcome: r.outcome, metadata: r.metadata, createdAt: r.createdAt })) } };
    } }),

  // ---- Agency / law-enforcement requests (p47 restricted portal) ----
  defineRoute({ method: 'get', path: '/agency-requests', operationId: 'listAgencyRequests', summary: 'Agency requests (government users see their own; counsel sees all)', tags: ['legal'], auth: 'session', permission: 'agency_request:read',
    request: { query: agencyRequestQuery }, responses: { 200: agencyRequestPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).agencyRequest.findMany({ where: { ...(isCounsel(ctx) ? {} : { requesterUserId: ctx.actor!.userId }), ...(query.status ? { status: query.status } : {}), ...(query.kind ? { kind: query.kind } : {}) }, take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      return { body: toDto(toPage(rows, query.limit)) };
    } }),
  defineRoute({ method: 'get', path: '/law-enforcement-requests', operationId: 'listLawEnforcementRequests', summary: 'Law-enforcement requests (alias of agency requests filtered to kind law_enforcement)', tags: ['legal'], auth: 'session', permission: 'agency_request:read',
    request: { query: paginationQuery.extend({ status: agencyRequestQuery.shape.status }) }, responses: { 200: agencyRequestPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).agencyRequest.findMany({ where: { kind: 'law_enforcement', ...(isCounsel(ctx) ? {} : { requesterUserId: ctx.actor!.userId }), ...(query.status ? { status: query.status } : {}) }, take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      return { body: toDto(toPage(rows, query.limit)) };
    } }),
  defineRoute({ method: 'post', path: '/agency-requests', operationId: 'createAgencyRequest', summary: 'Submit an agency records / law-enforcement request with legal basis and scope', tags: ['legal'], auth: 'mfa', permission: 'agency_request:write',
    request: { body: createAgencyRequest }, responses: { 201: agencyRequest },
    handler: async ({ body, ctx }) => {
      const row = await tenantDb(ctx).agencyRequest.create({ data: { tenantOrgId: ctx.tenantOrgId!, agencyName: body.agencyName, requesterUserId: ctx.actor!.userId, kind: body.kind, legalBasis: body.legalBasis, scopeJson: { ...body.scopeJson, ...(body.legalReference ? { legalReference: body.legalReference } : {}) }, status: 'received', dueAt: body.dueAt ? new Date(body.dueAt) : new Date(Date.now() + 30 * DAY_MS) } });
      await audit(ctx, { action: 'agency_request.received', resourceType: 'agency_request', resourceId: row.id, after: { kind: row.kind, agencyName: row.agencyName, legalReference: body.legalReference } });
      await publish(ctx, 'agency_request.received', { agencyRequestId: row.id, kind: row.kind });
      return { status: 201, body: toDto(row) };
    } }),
  defineRoute({ method: 'get', path: '/agency-requests/:id', operationId: 'getAgencyRequest', summary: 'Agency request detail', tags: ['legal'], auth: 'session', permission: 'agency_request:read',
    request: { params: idParams }, responses: { 200: agencyRequest },
    handler: async ({ params, ctx }) => {
      const row = await tenantDb(ctx).agencyRequest.findFirst({ where: { id: params.id, ...(isCounsel(ctx) ? {} : { requesterUserId: ctx.actor!.userId }) } });
      if (!row) throw errors.notFound();
      return { body: toDto(row) };
    } }),
  defineRoute({ method: 'post', path: '/agency-requests/:id/legal-review', operationId: 'legalReviewAgencyRequest', summary: 'Counsel legal review with data-minimization notes', tags: ['legal'], auth: 'mfa', permission: 'agency_request:approve',
    request: { params: idParams, body: agencyLegalReview }, responses: { 200: agencyRequest },
    handler: async ({ params, body, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.agencyRequest.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (!['received', 'legal_review'].includes(row.status)) throw errors.invalidTransition(row.status, 'legal_review');
      const updated = await db.agencyRequest.update({ where: { id: row.id }, data: { status: 'legal_review', minimizationNotes: body.minimizationNotes } });
      await audit(ctx, { action: 'agency_request.legal_review', resourceType: 'agency_request', resourceId: row.id, before: { status: row.status }, after: { status: 'legal_review' }, metadata: { note: body.minimizationNotes } });
      return { status: 200, body: toDto(updated) };
    } }),
  defineRoute({ method: 'post', path: '/agency-requests/:id/decide', operationId: 'decideAgencyRequest', summary: 'Approve or deny (approver cannot be the requester; approval opens a gated export job)', tags: ['legal'], auth: 'mfa', permission: 'agency_request:approve',
    request: { params: idParams, body: agencyDecide }, responses: { 200: agencyRequest },
    handler: async ({ params, body, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.agencyRequest.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (row.status !== 'legal_review') throw errors.invalidTransition(row.status, body.decision);
      if (row.requesterUserId === ctx.actor!.userId) throw errors.forbidden('You cannot decide a request you submitted');
      let exportJobId: string | null = row.exportJobId;
      if (body.decision === 'approved' && !exportJobId) {
        const job = await db.exportJob.create({ data: { tenantOrgId: ctx.tenantOrgId!, kind: 'agency_request', sourceType: 'agency_request', sourceId: row.id, status: 'requested', filtersJson: { scope: row.scopeJson as object }, redactionJson: { fields: ['ssnLast4', 'dateOfBirth'], note: row.minimizationNotes ?? undefined }, requestedBy: row.requesterUserId ?? ctx.actor!.userId } });
        exportJobId = job.id;
        await audit(ctx, { action: 'export.requested', resourceType: 'export_job', resourceId: job.id, after: { kind: job.kind, sourceType: job.sourceType, sourceId: job.sourceId, via: 'agency_request.approved' } });
      }
      const updated = await db.agencyRequest.update({ where: { id: row.id }, data: { status: body.decision, approvedBy: ctx.actor!.userId, decidedAt: new Date(), exportJobId } });
      await audit(ctx, { action: `agency_request.${body.decision}`, resourceType: 'agency_request', resourceId: row.id, before: { status: row.status }, after: { status: body.decision, exportJobId }, metadata: { note: body.note, kind: row.kind } });
      await publish(ctx, 'agency_request.decided', { agencyRequestId: row.id, decision: body.decision, exportJobId });
      return { status: 200, body: toDto(updated) };
    } }),
  defineRoute({ method: 'post', path: '/agency-requests/:id/fulfill', operationId: 'fulfillAgencyRequest', summary: 'Mark fulfilled once the linked export is complete', tags: ['legal'], auth: 'mfa', permission: 'agency_request:approve',
    request: { params: idParams, body: agencyFulfill }, responses: { 200: agencyRequest },
    handler: async ({ params, body, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.agencyRequest.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (row.status !== 'approved') throw errors.invalidTransition(row.status, 'fulfilled');
      const exportJobId = body.exportJobId ?? row.exportJobId;
      if (!exportJobId) throw errors.conflict('No export job linked to this request');
      const job = await db.exportJob.findFirst({ where: { id: exportJobId } });
      if (!job) throw errors.validation([{ path: 'body.exportJobId', message: 'Unknown export job' }]);
      if (job.status !== 'complete') throw errors.conflict(`Export job is ${job.status}; it must be complete before fulfilment`);
      const updated = await db.agencyRequest.update({ where: { id: row.id }, data: { status: 'fulfilled', exportJobId } });
      await audit(ctx, { action: 'agency_request.fulfilled', resourceType: 'agency_request', resourceId: row.id, after: { exportJobId, manifestSha256: job.manifestSha256 }, metadata: { note: body.note } });
      return { status: 200, body: toDto(updated) };
    } }),
];

export const legalRouter: Router = Router();
mount(legalRouter, legalRoutes);
