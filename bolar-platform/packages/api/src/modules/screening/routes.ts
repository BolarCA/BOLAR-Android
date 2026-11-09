import { Router } from 'express';
import {
  idParams, application, applicationDetail, applicationPage, applicationQuery, createApplication, recordConsent, orderScreening, decideApplication, decideApplicationResponse,
  screeningOrder, screeningResultResponse, adverseAction, adverseActionPage, adverseActionQuery, applicationLookups, type ScreeningOrderDto, type AdverseActionDto, type ApplicationDto,
} from '@bolar/contracts';
import { errors, toPage, decodeCursor, type Permission, type RequestContext } from '@bolar/shared';
import { createScreeningProvider, createStorageAdapter } from '@bolar/integrations';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { requireAccess, requireSensitiveAccess } from '../../shared/access.js';
import { config } from '../../config.js';
import { evaluateAndPersist } from '../compliance/service.js';
import { RULE_KEYS } from '../compliance/starter-rules.js';
import { createNoticeDraft } from '../notice/service.js';
import { addBusinessDays, adverseMachine, applicationMachine, businessDaysBetween, WAITING_BUSINESS_DAYS, type AdverseStage, type ApplicationStatus } from './state.js';

/**
 * Screening module (blueprint Days 43, 58). Consent gates the provider call (rule us.fcra.consent_before_screening),
 * raw reports are restricted and only reachable through the sensitive-access gate, and every decision is taken by a
 * human with adverse_action:manage. There is no AI path into /decide or /advance by design (p300).
 */
const RELATIONS = ['manages', 'owner_of'] as const;

function storage() {
  const c = config();
  return createStorageAdapter({ ...process.env, STORAGE_DRIVER: c.STORAGE_DRIVER, STORAGE_LOCAL_ROOT: c.STORAGE_LOCAL_ROOT, API_BASE_URL: c.API_BASE_URL, AUTH_JWT_SECRET: c.AUTH_JWT_SECRET, STORAGE_BUCKET: c.STORAGE_BUCKET });
}

async function loadApplication(ctx: RequestContext, id: string, permission: Permission) {
  const row = await tenantDb(ctx).application.findFirst({ where: { id } });
  if (!row) throw errors.notFound();
  await requireAccess(ctx, permission, { type: 'application', id: row.id, propertyId: row.propertyId }, [...RELATIONS]);
  return row;
}

function orderDto(o: { id: string; results?: { id: string }[] } & Record<string, unknown>): ScreeningOrderDto {
  const { results, ...rest } = o;
  return { ...(toDto(rest) as unknown as ScreeningOrderDto), resultId: results?.[0]?.id ?? null };
}
function adverseDto(a: Record<string, unknown>): AdverseActionDto {
  return { ...(toDto(a) as unknown as AdverseActionDto), reasonCodes: Array.isArray(a.reasonCodes) ? (a.reasonCodes as string[]) : [] };
}

async function decorate(ctx: RequestContext, rows: { applicantId: string; propertyId: string }[]) {
  const db = tenantDb(ctx);
  const applicants = await db.tenantProfile.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.applicantId))] } }, select: { id: true, displayName: true } });
  const properties = await db.property.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.propertyId))] } }, select: { id: true, name: true } });
  const an = new Map(applicants.map((a) => [a.id, a.displayName]));
  const pn = new Map(properties.map((p) => [p.id, p.name]));
  return rows.map((r) => ({ ...(toDto(r) as unknown as ApplicationDto), applicantName: an.get(r.applicantId), propertyName: pn.get(r.propertyId) }));
}

async function transitionApplication(ctx: RequestContext, row: { id: string; status: string }, to: ApplicationStatus, extra: Record<string, unknown> = {}) {
  applicationMachine.assertTransition(row.status as ApplicationStatus, to, [...ctx.permissions] as Permission[]);
  const updated = await tenantDb(ctx).application.update({ where: { id: row.id }, data: { status: to, ...extra } });
  await audit(ctx, { action: `application.${to}`, resourceType: 'application', resourceId: row.id, before: { status: row.status }, after: { status: to } });
  return updated;
}

export const screeningRoutes = [
  // ---- Applications ----
  defineRoute({ method: 'get', path: '/applications/lookups', operationId: 'getApplicationLookups', summary: 'Properties and applicant profiles available for a new application', tags: ['screening'], auth: 'session', permission: 'application:write',
    responses: { 200: applicationLookups },
    handler: async ({ ctx }) => {
      const db = tenantDb(ctx);
      const [properties, applicants] = await Promise.all([
        db.property.findMany({ where: { status: { not: 'archived' } }, select: { id: true, name: true, city: true, state: true }, orderBy: { name: 'asc' }, take: 100 }),
        db.tenantProfile.findMany({ where: { kind: { in: ['individual', 'corporate'] } }, select: { id: true, displayName: true, status: true }, orderBy: { displayName: 'asc' }, take: 100 }),
      ]);
      return { body: { properties, applicants } };
    } }),
  defineRoute({ method: 'get', path: '/applications', operationId: 'listApplications', summary: 'List rental applications', tags: ['screening'], auth: 'session', permission: 'application:read',
    request: { query: applicationQuery }, responses: { 200: applicationPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const { cursor: _c, limit, ...filters } = query;
      const rows = await tenantDb(ctx).application.findMany({ where: filters, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, limit);
      return { body: { ...page, items: await decorate(ctx, page.items) } };
    } }),
  defineRoute({ method: 'post', path: '/applications', operationId: 'createApplication', summary: 'Create a rental application for an applicant profile', tags: ['screening'], auth: 'session', permission: 'application:write',
    request: { body: createApplication }, responses: { 201: application },
    handler: async ({ body, ctx }) => {
      const db = tenantDb(ctx);
      const property = await db.property.findFirst({ where: { id: body.propertyId }, select: { id: true } });
      if (!property) throw errors.validation([{ path: 'body.propertyId', message: 'Unknown property' }]);
      await requireAccess(ctx, 'application:write', { type: 'property', id: property.id, propertyId: property.id }, [...RELATIONS]);
      const applicant = await db.tenantProfile.findFirst({ where: { id: body.applicantId }, select: { id: true } });
      if (!applicant) throw errors.validation([{ path: 'body.applicantId', message: 'Unknown applicant profile' }]);
      if (body.unitId && !(await db.unit.findFirst({ where: { id: body.unitId, propertyId: property.id }, select: { id: true } }))) throw errors.validation([{ path: 'body.unitId', message: 'Unit does not belong to the property' }]);
      const row = await db.application.create({ data: { tenantOrgId: ctx.tenantOrgId!, propertyId: body.propertyId, unitId: body.unitId ?? null, applicantId: body.applicantId, status: 'draft' } });
      await audit(ctx, { action: 'application.create', resourceType: 'application', resourceId: row.id, after: { propertyId: row.propertyId, unitId: row.unitId } });
      return { status: 201, body: (await decorate(ctx, [row]))[0] };
    } }),
  defineRoute({ method: 'get', path: '/applications/:id', operationId: 'getApplication', summary: 'Application with screening orders and adverse actions (no report data)', tags: ['screening'], auth: 'session', permission: 'application:read',
    request: { params: idParams }, responses: { 200: applicationDetail },
    handler: async ({ params, ctx }) => {
      const row = await loadApplication(ctx, params.id, 'application:read');
      const db = tenantDb(ctx);
      const [orders, adverse] = await Promise.all([
        db.screeningOrder.findMany({ where: { applicationId: row.id }, include: { results: { select: { id: true } } }, orderBy: { createdAt: 'asc' }, take: 50 }),
        db.adverseAction.findMany({ where: { applicationId: row.id }, orderBy: { createdAt: 'asc' }, take: 50 }),
      ]);
      return { body: { ...(await decorate(ctx, [row]))[0]!, screeningOrders: orders.map(orderDto), adverseActions: adverse.map(adverseDto) } };
    } }),
  defineRoute({ method: 'post', path: '/applications/:id/submit', operationId: 'submitApplication', summary: 'Submit a draft application', tags: ['screening'], auth: 'session', permission: 'application:write',
    request: { params: idParams }, responses: { 200: application },
    handler: async ({ params, ctx }) => {
      const row = await loadApplication(ctx, params.id, 'application:write');
      const updated = await transitionApplication(ctx, row, 'submitted', { submittedAt: new Date() });
      return { status: 200, body: (await decorate(ctx, [updated]))[0] };
    } }),
  defineRoute({ method: 'post', path: '/applications/:id/withdraw', operationId: 'withdrawApplication', summary: 'Withdraw an application', tags: ['screening'], auth: 'session', permission: 'application:write',
    request: { params: idParams }, responses: { 200: application },
    handler: async ({ params, ctx }) => {
      const row = await loadApplication(ctx, params.id, 'application:write');
      const updated = await transitionApplication(ctx, row, 'withdrawn');
      return { status: 200, body: (await decorate(ctx, [updated]))[0] };
    } }),
  defineRoute({ method: 'post', path: '/applications/:id/consent', operationId: 'recordScreeningConsent', summary: 'Record applicant consent (FCRA) on a pending screening order', tags: ['screening'], auth: 'mfa', permission: 'application:write',
    request: { params: idParams, body: recordConsent }, responses: { 201: screeningOrder },
    handler: async ({ params, body, ctx }) => {
      const row = await loadApplication(ctx, params.id, 'application:write');
      if (!['submitted', 'screening', 'review'].includes(row.status)) throw errors.conflict(`Consent can be recorded only after submission (status is ${row.status})`);
      const db = tenantDb(ctx);
      const pending = await db.screeningOrder.findFirst({ where: { applicationId: row.id, status: 'pending_consent' }, orderBy: { createdAt: 'desc' } });
      const provider = body.provider ?? (config().TRANSUNION_MODE === 'mock' ? 'mock' : 'transunion');
      const order = pending
        ? await db.screeningOrder.update({ where: { id: pending.id }, data: { consentAt: new Date(), consentDocId: body.consentDocumentId ?? null } })
        : await db.screeningOrder.create({ data: { tenantOrgId: ctx.tenantOrgId!, applicationId: row.id, provider, status: 'pending_consent', consentAt: new Date(), consentDocId: body.consentDocumentId ?? null } });
      await audit(ctx, { action: 'screening.consent', resourceType: 'screening_order', resourceId: order.id, after: { applicationId: row.id, consentDocId: order.consentDocId } });
      return { status: 201, body: orderDto(order) };
    } }),
  defineRoute({ method: 'post', path: '/applications/:id/screening-orders', operationId: 'orderScreening', summary: 'Place a screening order; blocked (409) by rule when consent is missing', tags: ['screening'], auth: 'mfa', permission: 'screening:order',
    request: { params: idParams, body: orderScreening }, responses: { 201: screeningOrder },
    handler: async ({ params, body, ctx }) => {
      const row = await loadApplication(ctx, params.id, 'screening:order');
      const db = tenantDb(ctx);
      const pending = await db.screeningOrder.findFirst({ where: { applicationId: row.id, status: 'pending_consent' }, orderBy: { createdAt: 'desc' } });
      const evaluation = await evaluateAndPersist(ctx, { domain: 'screening', resourceType: 'application', resourceId: row.id, facts: { consentAt: pending?.consentAt?.toISOString() ?? null, consentDocId: pending?.consentDocId ?? null, stage: 'order' }, propertyId: row.propertyId });
      if (evaluation.result === 'block') {
        await audit(ctx, { action: 'screening.order', resourceType: 'application', resourceId: row.id, outcome: 'deny', metadata: { hits: evaluation.hits.map((h) => h.ruleKey) } });
        throw errors.conflict(`Blocked by rule ${evaluation.hits.map((h) => h.ruleKey).join(', ')}: applicant consent must be recorded before a screening order`);
      }
      if (!pending) throw errors.conflict('Record applicant consent before ordering screening');
      const order = await db.screeningOrder.update({ where: { id: pending.id }, data: { status: 'ordered', orderedBy: ctx.actor!.userId } });
      if (row.status === 'submitted') await transitionApplication(ctx, row, 'screening');
      await audit(ctx, { action: 'screening.order', resourceType: 'screening_order', resourceId: order.id, after: { applicationId: row.id, products: body.products, ruleResult: evaluation.result } });
      await publish(ctx, 'screening.ordered', { orderId: order.id, applicationId: row.id, products: body.products });
      return { status: 201, body: orderDto(order) };
    } }),

  // ---- Screening orders (Day 58 mock provider) ----
  defineRoute({ method: 'post', path: '/screening-orders/:id/run', operationId: 'runScreeningOrder', summary: 'Call the screening provider (mock fixtures) and store the restricted report', tags: ['screening'], auth: 'mfa', permission: 'screening:order',
    request: { params: idParams }, responses: { 200: screeningOrder },
    handler: async ({ params, ctx }) => {
      const db = tenantDb(ctx);
      const order = await db.screeningOrder.findFirst({ where: { id: params.id } });
      if (!order) throw errors.notFound();
      const app = await loadApplication(ctx, order.applicationId, 'screening:order');
      if (order.status !== 'ordered') throw errors.invalidTransition(order.status, 'completed');
      if (!order.consentAt) throw errors.conflict('Blocked by rule us.fcra.consent_before_screening: consent missing on order');
      const [applicant, property] = await Promise.all([
        db.tenantProfile.findFirst({ where: { id: app.applicantId } }),
        db.property.findFirst({ where: { id: app.propertyId }, select: { addressLine1: true, city: true, state: true, postalCode: true } }),
      ]);
      if (!applicant || !property) throw errors.conflict('Application is missing applicant or property');
      const [firstName, ...rest] = applicant.displayName.split(/\s+/);
      const provider = createScreeningProvider(process.env);
      const response = await provider.execute(
        { applicantRef: applicant.id, consentAt: order.consentAt.toISOString(), consentDocumentId: order.consentDocId ?? '', products: ['credit', 'criminal', 'eviction'], applicant: { firstName: firstName ?? applicant.displayName, lastName: rest.join(' ') || applicant.displayName, dateOfBirth: applicant.dateOfBirth?.toISOString().slice(0, 10) ?? '', ssnLast4: applicant.ssnLast4 ?? undefined, address: { line1: property.addressLine1, city: property.city, state: property.state, postalCode: property.postalCode } } },
        { requestId: ctx.requestId, tenantOrgId: ctx.tenantOrgId, actorId: ctx.actor?.userId ?? null },
      );
      let resultId: string | null = null;
      if (response.status === 'completed') {
        let storageKey: string | null = null;
        if (response.reportPdf) {
          storageKey = `org/${ctx.tenantOrgId}/screening/${order.id}.pdf`;
          await storage().putObject({ key: storageKey, body: response.reportPdf, contentType: 'application/pdf', metadata: { classification: 'restricted', orderId: order.id } });
        }
        const result = await db.screeningResult.create({ data: { tenantOrgId: ctx.tenantOrgId!, orderId: order.id, classification: 'restricted', storageKey, summaryJson: (response.summary ?? null) as object } });
        resultId = result.id;
        await db.screeningOrder.update({ where: { id: order.id }, data: { status: 'completed', externalId: response.externalId } });
        if (app.status === 'screening') await transitionApplication(ctx, app, 'review');
      } else {
        await db.screeningOrder.update({ where: { id: order.id }, data: { externalId: response.externalId } });
      }
      await audit(ctx, { action: 'screening.run', resourceType: 'screening_order', resourceId: order.id, after: { provider: provider.name, mode: provider.mode, status: response.status, resultId } });
      await publish(ctx, 'screening.completed', { orderId: order.id, applicationId: app.id, resultId, status: response.status });
      const fresh = await db.screeningOrder.findFirst({ where: { id: order.id }, include: { results: { select: { id: true } } } });
      return { status: 200, body: orderDto(fresh!) };
    } }),
  defineRoute({ method: 'get', path: '/screening-orders/:id/result', operationId: 'getScreeningResult', summary: 'Restricted screening summary and signed report link (sensitive-access gate)', tags: ['screening'], auth: 'session', permission: 'application:read',
    request: { params: idParams }, responses: { 200: screeningResultResponse },
    handler: async ({ params, ctx }) => {
      const db = tenantDb(ctx);
      const order = await db.screeningOrder.findFirst({ where: { id: params.id }, include: { results: { orderBy: { receivedAt: 'desc' }, take: 1 } } });
      if (!order) throw errors.notFound();
      await loadApplication(ctx, order.applicationId, 'application:read');
      const result = order.results[0];
      if (!result) throw errors.notFound('No result yet');
      await requireSensitiveAccess(ctx, { resourceType: 'screening_result', resourceId: result.id, classification: 'restricted' }, 'screening:read_report');
      const download = result.storageKey ? await storage().signedUrl(result.storageKey, 'GET', config().STORAGE_SIGNED_URL_TTL_SECONDS) : null;
      await audit(ctx, { action: 'screening.report.read', resourceType: 'screening_result', resourceId: result.id, metadata: { orderId: order.id, download: Boolean(download) } });
      return { body: { id: result.id, orderId: order.id, classification: 'restricted' as const, receivedAt: result.receivedAt.toISOString(), summary: (result.summaryJson as never) ?? null, download: download ? { url: download.url, expiresAt: download.expiresAt } : null } };
    } }),

  // ---- Decision and adverse action (human only) ----
  defineRoute({ method: 'post', path: '/applications/:id/decide', operationId: 'decideApplication', summary: 'Human decision on an application; denial/conditional opens the FCRA adverse action workflow', tags: ['screening'], auth: 'mfa', permission: 'adverse_action:manage',
    request: { params: idParams, body: decideApplication }, responses: { 201: decideApplicationResponse },
    handler: async ({ params, body, ctx }) => {
      const row = await loadApplication(ctx, params.id, 'adverse_action:manage');
      const db = tenantDb(ctx);
      if (body.decision !== 'approved' && body.reasonCodes.length === 0) throw errors.validation([{ path: 'body.reasonCodes', message: 'At least one reason code is required for a denial or conditional approval' }]);
      const updated = await transitionApplication(ctx, row, body.decision, { decidedAt: new Date(), decidedBy: ctx.actor!.userId });
      let adverse: AdverseActionDto | null = null;
      if (body.decision !== 'approved') {
        const latestResult = await db.screeningResult.findFirst({ where: { order: { applicationId: row.id } }, orderBy: { receivedAt: 'desc' } });
        const summary = (latestResult?.summaryJson ?? {}) as { providerContact?: string };
        const now = new Date();
        const aa = await db.adverseAction.create({ data: { tenantOrgId: ctx.tenantOrgId!, applicationId: row.id, stage: 'pre_adverse', reasonCodes: body.reasonCodes, waitingPeriodEndsAt: addBusinessDays(now, WAITING_BUSINESS_DAYS), approvedBy: ctx.actor!.userId } });
        const notice = await createNoticeDraft(ctx, { kind: 'adverse_action', templateKey: 'notice.pre_adverse', recipientId: row.applicantId, propertyId: row.propertyId, variables: { providerName: 'TransUnion Rental Screening', providerContact: summary.providerContact ?? 'see enclosed summary of rights', waitingDays: WAITING_BUSINESS_DAYS, adverseActionId: aa.id, applicationId: row.id, decision: body.decision }, facts: { kind: 'adverse_action' } });
        const linked = await db.adverseAction.update({ where: { id: aa.id }, data: { noticeId: notice.id } });
        await audit(ctx, { action: 'adverse_action.create', resourceType: 'adverse_action', resourceId: aa.id, after: { applicationId: row.id, stage: 'pre_adverse', reasonCodes: body.reasonCodes, noticeId: notice.id, waitingPeriodEndsAt: linked.waitingPeriodEndsAt }, metadata: { note: body.note ?? null } });
        adverse = adverseDto(linked);
      }
      await audit(ctx, { action: 'application.decide', resourceType: 'application', resourceId: row.id, after: { decision: body.decision, reasonCodes: body.reasonCodes }, metadata: { decidedBy: 'human', note: body.note ?? null } });
      await publish(ctx, 'application.decided', { applicationId: row.id, decision: body.decision, adverseActionId: adverse?.id ?? null });
      return { status: 201, body: { application: (await decorate(ctx, [updated]))[0]!, adverseAction: adverse } };
    } }),
  defineRoute({ method: 'get', path: '/adverse-actions', operationId: 'listAdverseActions', summary: 'Adverse action queue', tags: ['screening'], auth: 'session', permission: 'application:read',
    request: { query: adverseActionQuery }, responses: { 200: adverseActionPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const { cursor: _c, limit, ...filters } = query;
      const rows = await tenantDb(ctx).adverseAction.findMany({ where: filters, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, limit);
      return { body: { ...page, items: page.items.map(adverseDto) } };
    } }),
  defineRoute({ method: 'get', path: '/adverse-actions/:id', operationId: 'getAdverseAction', summary: 'Adverse action detail', tags: ['screening'], auth: 'session', permission: 'application:read',
    request: { params: idParams }, responses: { 200: adverseAction },
    handler: async ({ params, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.adverseAction.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      await loadApplication(ctx, row.applicationId, 'application:read');
      const final = await db.notice.findFirst({ where: { templateKey: 'notice.final_adverse', variables: { path: ['adverseActionId'], equals: row.id } }, select: { id: true } });
      return { body: { ...adverseDto(row), finalNoticeId: final?.id ?? null } };
    } }),
  defineRoute({ method: 'post', path: '/adverse-actions/:id/advance', operationId: 'advanceAdverseAction', summary: 'pre_adverse -> waiting once the notice is sent; waiting -> final only after the waiting period', tags: ['screening'], auth: 'mfa', permission: 'adverse_action:manage',
    request: { params: idParams }, responses: { 200: adverseAction },
    handler: async ({ params, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.adverseAction.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      const app = await loadApplication(ctx, row.applicationId, 'adverse_action:manage');
      const stage = row.stage as AdverseStage;
      const now = new Date();
      if (stage === 'pre_adverse') {
        const notice = row.noticeId ? await db.notice.findFirst({ where: { id: row.noticeId }, select: { status: true } }) : null;
        if (!notice || notice.status !== 'sent') throw errors.conflict('The pre-adverse notice must be approved and sent before the waiting period starts');
        adverseMachine.assertTransition(stage, 'waiting', [...ctx.permissions] as Permission[]);
        const updated = await db.adverseAction.update({ where: { id: row.id }, data: { stage: 'waiting', waitingPeriodEndsAt: row.waitingPeriodEndsAt ?? addBusinessDays(now, WAITING_BUSINESS_DAYS) } });
        await audit(ctx, { action: 'adverse_action.waiting', resourceType: 'adverse_action', resourceId: row.id, before: { stage }, after: { stage: 'waiting', waitingPeriodEndsAt: updated.waitingPeriodEndsAt } });
        return { status: 200, body: adverseDto(updated) };
      }
      if (stage === 'waiting') {
        const daysSincePreAdverse = businessDaysBetween(row.createdAt, now);
        const endsAt = row.waitingPeriodEndsAt ?? addBusinessDays(row.createdAt, WAITING_BUSINESS_DAYS);
        if (now.getTime() < endsAt.getTime()) {
          // The adverse action rests on a consented report: carry the consent fact so only the waiting-period rule can fire.
          const consented = await db.screeningOrder.findFirst({ where: { applicationId: row.applicationId, consentAt: { not: null } }, orderBy: { consentAt: 'desc' }, select: { consentAt: true } });
          const evaluation = await evaluateAndPersist(ctx, { domain: 'screening', resourceType: 'adverse_action', resourceId: row.id, facts: { daysSincePreAdverse, waitingPeriodEndsAt: endsAt.toISOString(), stage: 'final', consentAt: consented?.consentAt?.toISOString() ?? null }, propertyId: app.propertyId });
          const keys = evaluation.hits.length ? evaluation.hits.map((h) => h.ruleKey) : [RULE_KEYS.adverseWaitingPeriod];
          await audit(ctx, { action: 'adverse_action.final', resourceType: 'adverse_action', resourceId: row.id, outcome: 'deny', metadata: { daysSincePreAdverse, waitingPeriodEndsAt: endsAt, hits: keys } });
          throw errors.conflict(`Blocked by rule ${keys.join(', ')}: waiting period ends ${endsAt.toISOString()} (${daysSincePreAdverse} business days elapsed)`);
        }
        adverseMachine.assertTransition(stage, 'final', [...ctx.permissions] as Permission[]);
        const latestResult = await db.screeningResult.findFirst({ where: { order: { applicationId: row.applicationId } }, orderBy: { receivedAt: 'desc' } });
        const summary = (latestResult?.summaryJson ?? {}) as { providerContact?: string };
        const reasons = (Array.isArray(row.reasonCodes) ? (row.reasonCodes as string[]) : []).map((r) => r.replace(/_/g, ' ')).join('; ');
        const notice = await createNoticeDraft(ctx, { kind: 'adverse_action', templateKey: 'notice.final_adverse', recipientId: app.applicantId, propertyId: app.propertyId, variables: { decision: app.status.replace(/_/g, ' '), reasons, providerName: 'TransUnion Rental Screening', providerContact: summary.providerContact ?? 'see enclosed summary of rights', adverseActionId: row.id, applicationId: app.id }, facts: { kind: 'adverse_action' } });
        const updated = await db.adverseAction.update({ where: { id: row.id }, data: { stage: 'final', approvedBy: ctx.actor!.userId } });
        await audit(ctx, { action: 'adverse_action.final', resourceType: 'adverse_action', resourceId: row.id, before: { stage }, after: { stage: 'final', finalNoticeId: notice.id } });
        await publish(ctx, 'adverse_action.final', { adverseActionId: row.id, applicationId: app.id, noticeId: notice.id, reasonCodes: row.reasonCodes });
        return { status: 200, body: { ...adverseDto(updated), finalNoticeId: notice.id } };
      }
      throw errors.invalidTransition(stage, stage === 'disputed' ? 'final' : 'waiting');
    } }),
  defineRoute({ method: 'post', path: '/adverse-actions/:id/dispute', operationId: 'disputeAdverseAction', summary: 'Open an applicant dispute; the clock pauses until resolved by a human', tags: ['screening'], auth: 'mfa', permission: 'adverse_action:manage',
    request: { params: idParams }, responses: { 200: adverseAction },
    handler: async ({ params, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.adverseAction.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      await loadApplication(ctx, row.applicationId, 'adverse_action:manage');
      adverseMachine.assertTransition(row.stage as AdverseStage, 'disputed', [...ctx.permissions] as Permission[]);
      const updated = await db.adverseAction.update({ where: { id: row.id }, data: { stage: 'disputed', disputeOpenedAt: new Date() } });
      await audit(ctx, { action: 'adverse_action.disputed', resourceType: 'adverse_action', resourceId: row.id, before: { stage: row.stage }, after: { stage: 'disputed' } });
      return { status: 200, body: adverseDto(updated) };
    } }),
  defineRoute({ method: 'post', path: '/adverse-actions/:id/withdraw', operationId: 'withdrawAdverseAction', summary: 'Withdraw an adverse action (e.g. dispute resolved in the applicant favour); application returns to review', tags: ['screening'], auth: 'mfa', permission: 'adverse_action:manage',
    request: { params: idParams }, responses: { 200: adverseAction },
    handler: async ({ params, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.adverseAction.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      const app = await loadApplication(ctx, row.applicationId, 'adverse_action:manage');
      adverseMachine.assertTransition(row.stage as AdverseStage, 'withdrawn', [...ctx.permissions] as Permission[]);
      const updated = await db.adverseAction.update({ where: { id: row.id }, data: { stage: 'withdrawn' } });
      await db.application.update({ where: { id: app.id }, data: { status: 'review', decidedAt: null, decidedBy: null } });
      if (row.noticeId) await db.notice.updateMany({ where: { id: row.noticeId, status: { in: ['draft', 'pending_approval', 'approved'] } }, data: { status: 'canceled' } });
      await audit(ctx, { action: 'adverse_action.withdrawn', resourceType: 'adverse_action', resourceId: row.id, before: { stage: row.stage }, after: { stage: 'withdrawn', applicationStatus: 'review' } });
      return { status: 200, body: adverseDto(updated) };
    } }),
];

export const screeningRouter: Router = Router();
mount(screeningRouter, screeningRoutes);
