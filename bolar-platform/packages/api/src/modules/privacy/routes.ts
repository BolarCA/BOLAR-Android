import { Router } from 'express';
import { idParams, privacyIntake, privacyIntakeResponse, privacyVerify, privacyVerifyResponse, privacyRequest, privacyRequestPage, privacyRequestQuery, privacyDecide, privacyNote } from '@bolar/contracts';
import { errors, toPage, decodeCursor, type RequestContext } from '@bolar/shared';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { config } from '../../config.js';
import { SLA_DAYS, checkIntakeRate, discoverSubject, fulfill, identityProvider, reviewExceptions, type DiscoveryResult } from './service.js';

const DAY_MS = 86_400_000;

/** Staff-facing DTO: the subject email is confidential; readers without the sensitive permission see a masked address. */
function dto(row: Record<string, unknown>, ctx: RequestContext) {
  const out = toDto(row) as Record<string, unknown>;
  if (!ctx.permissions.has('tenant_profile:read_sensitive') && !ctx.permissions.has('privacy_request:approve')) {
    const email = String(out.subjectEmail ?? '');
    const [local, domain] = email.split('@');
    out.subjectEmail = local && domain ? `${local.slice(0, 1)}***@${domain}` : '***';
  }
  return out;
}

export const privacyRoutes = [
  // ---- Public intake and identity verification (Day 48) ----
  defineRoute({ method: 'post', path: '/privacy-requests/intake', operationId: 'privacyIntake', summary: 'Public DSAR intake: creates the request and starts identity verification (rate limited)', tags: ['privacy'], auth: 'public',
    request: { body: privacyIntake }, responses: { 201: privacyIntakeResponse },
    handler: async ({ body, ctx }) => {
      checkIntakeRate(ctx.ip);
      const org = await prisma.tenantOrg.findFirst({ where: { slug: body.orgSlug, status: 'active' }, select: { id: true } });
      if (!org) throw errors.notFound('Unknown organization');
      const dueAt = new Date(Date.now() + (SLA_DAYS[body.kind] ?? 30) * DAY_MS);
      const row = await prisma.privacyRequest.create({ data: { tenantOrgId: org.id, kind: body.kind, subjectEmail: body.email, status: 'received', dueAt, createdBy: ctx.actor?.userId ?? null } });
      const orgCtx: RequestContext = { ...ctx, tenantOrgId: org.id };
      await audit(orgCtx, { action: 'privacy_request.received', resourceType: 'privacy_request', resourceId: row.id, after: { kind: row.kind, dueAt } });
      const idv = identityProvider();
      const start = await idv.execute({ subjectRef: body.email, redirectUrl: `${config().WEB_BASE_URL}/privacy/verify?request=${row.id}`, level: 'basic' }, { requestId: ctx.requestId, tenantOrgId: org.id, actorId: null });
      const updated = await prisma.privacyRequest.update({ where: { id: row.id }, data: { status: 'identity_verification', discoveryJson: { identity: { provider: idv.name, mode: idv.mode, externalId: start.externalId, startedAt: new Date().toISOString() } } } });
      await audit(orgCtx, { action: 'privacy_request.identity_started', resourceType: 'privacy_request', resourceId: row.id, metadata: { provider: idv.name, mode: idv.mode } });
      await publish(orgCtx, 'privacy_request.received', { privacyRequestId: row.id, kind: row.kind, dueAt: dueAt.toISOString() });
      return { status: 201, body: { id: updated.id, status: updated.status, kind: updated.kind, dueAt: updated.dueAt.toISOString(), verificationUrl: start.verificationUrl } };
    } }),
  defineRoute({ method: 'post', path: '/privacy-requests/:id/verify', operationId: 'privacyVerifyIdentity', summary: 'Identity verification callback: records the provider result for the request', tags: ['privacy'], auth: 'public',
    request: { params: idParams, body: privacyVerify }, responses: { 200: privacyVerifyResponse },
    handler: async ({ params, body, ctx }) => {
      const row = await prisma.privacyRequest.findUnique({ where: { id: params.id } });
      const identity = (row?.discoveryJson as { identity?: { externalId?: string } } | null)?.identity;
      if (!row || !identity || identity.externalId !== body.externalId) throw errors.notFound();
      const result = await identityProvider().getResult(body.externalId, { requestId: ctx.requestId, tenantOrgId: row.tenantOrgId, actorId: null });
      const orgCtx: RequestContext = { ...ctx, tenantOrgId: row.tenantOrgId };
      if (result.status === 'verified' && !row.identityVerifiedAt) {
        await prisma.privacyRequest.update({ where: { id: row.id }, data: { identityVerifiedAt: new Date(result.verifiedAt ?? Date.now()), identityMethod: `${identityProvider().name}-${identityProvider().mode}`, discoveryJson: { ...(row.discoveryJson as object), identity: { ...identity, status: 'verified' } } } });
        await audit(orgCtx, { action: 'privacy_request.identity_verified', resourceType: 'privacy_request', resourceId: row.id, metadata: { method: `${identityProvider().name}-${identityProvider().mode}` } });
      } else if (result.status === 'failed') {
        await audit(orgCtx, { action: 'privacy_request.identity_failed', resourceType: 'privacy_request', resourceId: row.id, outcome: 'deny' });
      }
      const fresh = await prisma.privacyRequest.findUniqueOrThrow({ where: { id: row.id } });
      return { status: 200, body: { id: fresh.id, status: fresh.status, identityVerified: !!fresh.identityVerifiedAt, identityStatus: result.status } };
    } }),

  // ---- Staff workflow ----
  defineRoute({ method: 'get', path: '/privacy-requests', operationId: 'listPrivacyRequests', summary: 'Privacy request queue', tags: ['privacy'], auth: 'session', permission: 'privacy_request:read',
    request: { query: privacyRequestQuery }, responses: { 200: privacyRequestPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).privacyRequest.findMany({ where: { ...(query.status ? { status: query.status } : {}), ...(query.kind ? { kind: query.kind } : {}) }, take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map((r) => dto(r, ctx)) } };
    } }),
  defineRoute({ method: 'get', path: '/privacy-requests/:id', operationId: 'getPrivacyRequest', summary: 'Privacy request detail (discovery, exceptions, decision, manifest)', tags: ['privacy'], auth: 'session', permission: 'privacy_request:read',
    request: { params: idParams }, responses: { 200: privacyRequest },
    handler: async ({ params, ctx }) => {
      const row = await tenantDb(ctx).privacyRequest.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      return { body: dto(row, ctx) };
    } }),
  defineRoute({ method: 'post', path: '/privacy-requests/:id/discover', operationId: 'discoverPrivacyRequest', summary: 'Run discovery across profiles, leases, documents, notifications and audit for the verified subject', tags: ['privacy'], auth: 'mfa', permission: 'privacy_request:write',
    request: { params: idParams }, responses: { 200: privacyRequest },
    handler: async ({ params, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.privacyRequest.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (!row.identityVerifiedAt) throw errors.conflict('Identity must be verified before discovery');
      if (!['identity_verification', 'discovery'].includes(row.status)) throw errors.invalidTransition(row.status, 'discovery');
      const discovery = await discoverSubject(ctx.tenantOrgId!, row.subjectEmail);
      const updated = await db.privacyRequest.update({ where: { id: row.id }, data: { status: 'discovery', subjectProfileId: discovery.subjects.tenantProfileIds[0] ?? null, discoveryJson: { ...(row.discoveryJson as object), ...discovery } as object } });
      await audit(ctx, { action: 'privacy_request.discovered', resourceType: 'privacy_request', resourceId: row.id, before: { status: row.status }, after: { status: 'discovery', counts: discovery.counts } });
      return { status: 200, body: dto(updated, ctx) };
    } }),
  defineRoute({ method: 'post', path: '/privacy-requests/:id/review-exceptions', operationId: 'reviewPrivacyExceptions', summary: 'Compute exceptions: legal holds, retention duties, audit immutability, third-party processors', tags: ['privacy'], auth: 'mfa', permission: 'privacy_request:write',
    request: { params: idParams }, responses: { 200: privacyRequest },
    handler: async ({ params, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.privacyRequest.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (!['discovery', 'exception_review'].includes(row.status)) throw errors.invalidTransition(row.status, 'exception_review');
      const exceptions = await reviewExceptions(ctx.tenantOrgId!, row.kind, row.discoveryJson as unknown as DiscoveryResult);
      const updated = await db.privacyRequest.update({ where: { id: row.id }, data: { status: 'exception_review', exceptionsJson: exceptions as unknown as object[] } });
      await audit(ctx, { action: 'privacy_request.exceptions_reviewed', resourceType: 'privacy_request', resourceId: row.id, after: { status: 'exception_review', exceptionTypes: exceptions.map((e) => e.type) } });
      return { status: 200, body: dto(updated, ctx) };
    } }),
  defineRoute({ method: 'post', path: '/privacy-requests/:id/decide', operationId: 'decidePrivacyRequest', summary: 'Approve, deny or partially approve (human gate; approver cannot be the creator)', tags: ['privacy'], auth: 'mfa', permission: 'privacy_request:approve',
    request: { params: idParams, body: privacyDecide }, responses: { 200: privacyRequest },
    handler: async ({ params, body, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.privacyRequest.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (row.status !== 'exception_review') throw errors.invalidTransition(row.status, body.decision === 'denied' ? 'denied' : 'approved');
      if (row.createdBy && row.createdBy === ctx.actor!.userId) throw errors.forbidden('You cannot decide a request you created');
      const status = body.decision === 'denied' ? 'denied' : 'approved';
      const updated = await db.privacyRequest.update({ where: { id: row.id }, data: { status, decision: body.decision, decidedBy: ctx.actor!.userId, decidedAt: new Date() } });
      await audit(ctx, { action: `privacy_request.${body.decision}`, resourceType: 'privacy_request', resourceId: row.id, before: { status: row.status }, after: { status, decision: body.decision }, metadata: { note: body.note } });
      await publish(ctx, 'privacy_request.decided', { privacyRequestId: row.id, decision: body.decision });
      return { status: 200, body: dto(updated, ctx) };
    } }),
  defineRoute({ method: 'post', path: '/privacy-requests/:id/fulfill', operationId: 'fulfillPrivacyRequest', summary: 'Execute an approved request: anonymize/soft-delete (deletion) or build an access manifest; renders the confirmation draft', tags: ['privacy'], auth: 'mfa', permission: 'privacy_request:write',
    request: { params: idParams, body: privacyNote }, responses: { 200: privacyRequest },
    handler: async ({ params, ctx }) => ({ status: 200, body: dto(await fulfill(ctx, params.id), ctx) }) }),
  defineRoute({ method: 'post', path: '/privacy-requests/:id/close', operationId: 'closePrivacyRequest', summary: 'Close a fulfilled or denied request', tags: ['privacy'], auth: 'mfa', permission: 'privacy_request:write',
    request: { params: idParams, body: privacyNote }, responses: { 200: privacyRequest },
    handler: async ({ params, body, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.privacyRequest.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      if (!['fulfilled', 'denied'].includes(row.status)) throw errors.invalidTransition(row.status, 'closed');
      const updated = await db.privacyRequest.update({ where: { id: row.id }, data: { status: 'closed' } });
      await audit(ctx, { action: 'privacy_request.closed', resourceType: 'privacy_request', resourceId: row.id, before: { status: row.status }, after: { status: 'closed' }, metadata: { note: body.note } });
      return { status: 200, body: dto(updated, ctx) };
    } }),
];

export const privacyRouter: Router = Router();
mount(privacyRouter, privacyRoutes);
