import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';
import { addBusinessDays, businessDaysBetween } from '../modules/screening/state.js';
import { RULE_KEYS, ensureStarterRules } from '../modules/compliance/starter-rules.js';

describe('business-day helpers', () => {
  it('skips weekends', () => {
    const fri = new Date('2026-01-02T15:00:00Z'); // Friday
    expect(addBusinessDays(fri, 5).toISOString()).toBe('2026-01-09T15:00:00.000Z');
    expect(businessDaysBetween(fri, new Date('2026-01-05T10:00:00Z'))).toBe(1); // Mon
    expect(businessDaysBetween(fri, new Date('2026-01-09T10:00:00Z'))).toBe(5);
    expect(businessDaysBetween(fri, fri)).toBe(0);
  });
});

describe('screening (Days 43, 58): consent gate, restricted report, human decision, adverse action', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let applicant: { id: string };
  let officer: Awaited<ReturnType<typeof createUser>>;
  let appId: string;
  let orderId: string;
  let adverseId: string;
  let preNoticeId: string;

  beforeAll(async () => {
    fx = await twoTenantFixture();
    await ensureStarterRules(fx.admins.a.id);
    officer = await createUser(fx.a, 'compliance_officer');
    // Last name starting with Z -> mock provider recommends decline
    applicant = await prisma.tenantProfile.create({ data: { tenantOrgId: fx.a.id, displayName: 'Zara Zeta', email: 'zara@alpha.test', status: 'applicant', dateOfBirth: new Date('1990-05-05') } });
  });

  it('lookups + create + submit; tenant role denied with access.denied audit', async () => {
    const m = await asUser(fx.managers.a);
    const lookups = await m.get('/applications/lookups');
    expect(lookups.body.properties.map((p: { id: string }) => p.id)).toContain(fx.propA.id);
    expect(lookups.body.applicants.map((a: { id: string }) => a.id)).toContain(applicant.id);
    const created = await m.post('/applications').send({ propertyId: fx.propA.id, applicantId: applicant.id });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'draft', applicantName: 'Zara Zeta', propertyName: fx.propA.name });
    appId = created.body.id;
    // cross-tenant property is a validation error (no existence leak beyond "unknown")
    expect((await m.post('/applications').send({ propertyId: fx.propB.id, applicantId: applicant.id })).status).toBe(400);
    const tenant = await createUser(fx.a, 'tenant');
    const t = await asUser(tenant);
    expect((await t.get('/applications')).status).toBe(403);
    expect((await m.post(`/applications/${appId}/submit`)).body.status).toBe('submitted');
    expect((await m.post(`/applications/${appId}/submit`)).status).toBe(409); // invalid transition
  });

  it('ordering without consent is blocked by rule and lands in the compliance queue; consent then unblocks', async () => {
    const m = await asUser(fx.managers.a);
    const blocked = await m.post(`/applications/${appId}/screening-orders`).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain(RULE_KEYS.consentBeforeScreening);
    const o = await asUser(officer);
    const q = await o.get(`/rules/evaluations?resourceType=application&resourceId=${appId}`);
    expect(q.body.items.map((e: { ruleKey: string; result: string }) => [e.ruleKey, e.result])).toEqual([[RULE_KEYS.consentBeforeScreening, 'block']]);
    const consent = await m.post(`/applications/${appId}/consent`).send({ consentDocumentId: 'doc_consent_1' });
    expect(consent.status).toBe(201);
    expect(consent.body).toMatchObject({ status: 'pending_consent', consentDocId: 'doc_consent_1' });
    expect(consent.body.consentAt).not.toBeNull();
    const ordered = await m.post(`/applications/${appId}/screening-orders`).send({ products: ['credit', 'eviction'] });
    expect(ordered.status).toBe(201);
    expect(ordered.body.status).toBe('ordered');
    orderId = ordered.body.id;
    expect((await m.get(`/applications/${appId}`)).body.status).toBe('screening');
    expect(await prisma.auditLog.findFirst({ where: { action: 'screening.consent', resourceId: orderId } })).not.toBeNull();
  });

  it('run stores a restricted result + report; result is review-required for the manager, readable with purpose+permission or approval', async () => {
    const m = await asUser(fx.managers.a);
    const run = await m.post(`/screening-orders/${orderId}/run`);
    expect(run.status).toBe(200);
    expect(run.body.status).toBe('completed');
    expect(run.body.resultId).toBeTruthy();
    expect((await m.post(`/screening-orders/${orderId}/run`)).status).toBe(409);
    const result = await prisma.screeningResult.findFirst({ where: { orderId } });
    expect(result?.classification).toBe('restricted');
    expect(result?.storageKey).toBe(`org/${fx.a.id}/screening/${orderId}.pdf`);
    expect((await m.get(`/applications/${appId}`)).body.status).toBe('review');
    // detail never leaks the summary
    const detail = await m.get(`/applications/${appId}`);
    expect(JSON.stringify(detail.body)).not.toContain('recommendation');
    // manager (no screening:read_report) -> review_required
    const denied = await m.get(`/screening-orders/${orderId}/result`);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('review_required');
    expect(await prisma.auditLog.findFirst({ where: { action: 'sensitive.access', resourceId: result!.id, outcome: 'review_required' } })).not.toBeNull();
    // org admin has screening:read_report; needs a declared purpose
    const a = await asUser(fx.admins.a);
    expect((await a.get(`/screening-orders/${orderId}/result`)).status).toBe(403);
    const aWithPurpose = await asUser(fx.admins.a, { 'X-Access-Purpose': 'compliance_review' });
    const ok = await aWithPurpose.get(`/screening-orders/${orderId}/result`);
    expect(ok.status).toBe(200);
    expect(ok.body.summary.recommendation).toBe('decline');
    expect(ok.body.download.url).toContain('/storage/object?key=');
    // approved sensitive access request unlocks the manager
    const req = await m.post('/sensitive-access/requests').send({ resourceType: 'screening_result', resourceId: result!.id, classification: 'restricted', purpose: 'compliance_review', justification: 'Need to review the report before a decision meeting.' });
    expect(req.status).toBe(201);
    expect((await a.post(`/sensitive-access/requests/${req.body.id}/decide`).send({ decision: 'approved', ttlHours: 1 })).status).toBe(200);
    expect((await m.get(`/screening-orders/${orderId}/result`)).status).toBe(200);
    // other tenant: 404
    expect((await (await asUser(fx.managers.b)).get(`/screening-orders/${orderId}/result`)).status).toBe(404);
    expect((await (await asUser(fx.managers.b)).get(`/applications/${appId}`)).status).toBe(404);
  });

  it('human denial creates a pre-adverse action with a 5-business-day wait and a draft notice; reason codes required', async () => {
    const m = await asUser(fx.managers.a);
    expect((await m.post(`/applications/${appId}/decide`).send({ decision: 'denied', reasonCodes: [] })).status).toBe(400);
    const decided = await m.post(`/applications/${appId}/decide`).send({ decision: 'denied', reasonCodes: ['eviction_record', 'credit_history'], note: 'Reviewed report with applicant on the phone.' });
    expect(decided.status).toBe(201);
    expect(decided.body.application.status).toBe('denied');
    expect(decided.body.adverseAction).toMatchObject({ stage: 'pre_adverse', reasonCodes: ['eviction_record', 'credit_history'] });
    adverseId = decided.body.adverseAction.id;
    preNoticeId = decided.body.adverseAction.noticeId;
    const aa = await prisma.adverseAction.findUniqueOrThrow({ where: { id: adverseId } });
    expect(businessDaysBetween(aa.createdAt, aa.waitingPeriodEndsAt!)).toBe(5);
    const notice = await prisma.notice.findUniqueOrThrow({ where: { id: preNoticeId } });
    expect(notice).toMatchObject({ kind: 'adverse_action', templateKey: 'notice.pre_adverse', status: 'draft', recipientId: applicant.id });
    expect(notice.bodyDraft).toContain('Dear Zara Zeta');
    expect(notice.bodyDraft).toContain('5 days to dispute');
    expect((await m.post(`/applications/${appId}/decide`).send({ decision: 'approved' })).status).toBe(409); // already decided
    expect(await prisma.auditLog.findFirst({ where: { action: 'application.decide', resourceId: appId } })).not.toBeNull();
    // tenant cannot decide
    const tenant = await createUser(fx.a, 'tenant');
    expect((await (await asUser(tenant)).post(`/applications/${appId}/decide`).send({ decision: 'approved' })).status).toBe(403);
  });

  it('advance gates: notice must be sent, waiting period enforced by rule, final issues the final notice and event', async () => {
    const m = await asUser(fx.managers.a);
    expect((await m.post(`/adverse-actions/${adverseId}/advance`)).status).toBe(409); // notice still draft
    expect((await m.post(`/notices/${preNoticeId}/submit`)).body.status).toBe('pending_approval');
    expect((await m.post(`/notices/${preNoticeId}/approve`)).status).toBe(403); // author cannot approve
    const o = await asUser(officer);
    expect((await o.post(`/notices/${preNoticeId}/approve`)).body.status).toBe('approved');
    expect((await m.post(`/adverse-actions/${adverseId}/advance`)).status).toBe(409); // approved but not sent
    expect((await m.post(`/notices/${preNoticeId}/send`)).body.status).toBe('sent');
    const waiting = await m.post(`/adverse-actions/${adverseId}/advance`);
    expect(waiting.status).toBe(200);
    expect(waiting.body.stage).toBe('waiting');
    const early = await m.post(`/adverse-actions/${adverseId}/advance`);
    expect(early.status).toBe(409);
    expect(early.body.message).toContain(RULE_KEYS.adverseWaitingPeriod);
    const q = await o.get(`/rules/evaluations?resourceType=adverse_action&resourceId=${adverseId}`);
    expect(q.body.items[0]).toMatchObject({ ruleKey: RULE_KEYS.adverseWaitingPeriod, result: 'block' });
    // time travel: pre-adverse issued 10 business days ago
    const past = new Date(Date.now() - 14 * 86_400_000);
    await prisma.adverseAction.update({ where: { id: adverseId }, data: { createdAt: past, waitingPeriodEndsAt: addBusinessDays(past, 5) } });
    const final = await m.post(`/adverse-actions/${adverseId}/advance`);
    expect(final.status).toBe(200);
    expect(final.body.stage).toBe('final');
    expect(final.body.finalNoticeId).toBeTruthy();
    const finalNotice = await prisma.notice.findUniqueOrThrow({ where: { id: final.body.finalNoticeId } });
    expect(finalNotice.templateKey).toBe('notice.final_adverse');
    expect(finalNotice.bodyDraft).toContain('eviction record; credit history');
    expect((await m.get(`/adverse-actions/${adverseId}`)).body.finalNoticeId).toBe(final.body.finalNoticeId);
    expect((await m.post(`/adverse-actions/${adverseId}/advance`)).status).toBe(409);
    expect((await m.post(`/adverse-actions/${adverseId}/dispute`)).status).toBe(409); // cannot dispute after final
    expect(await prisma.auditLog.findFirst({ where: { action: 'adverse_action.final', resourceId: adverseId, outcome: 'allow' } })).not.toBeNull();
  });

  it('dispute pauses a second adverse action; withdraw returns the application to review; list is tenant-scoped', async () => {
    const m = await asUser(fx.managers.a);
    const app2 = await m.post('/applications').send({ propertyId: fx.propA.id, applicantId: applicant.id });
    await m.post(`/applications/${app2.body.id}/submit`);
    await prisma.application.update({ where: { id: app2.body.id }, data: { status: 'review' } });
    const decided = await m.post(`/applications/${app2.body.id}/decide`).send({ decision: 'conditionally_approved', reasonCodes: ['insufficient_income'] });
    expect(decided.status).toBe(201);
    const id = decided.body.adverseAction.id;
    expect((await m.post(`/adverse-actions/${id}/dispute`)).body.stage).toBe('disputed');
    expect((await m.post(`/adverse-actions/${id}/advance`)).status).toBe(409);
    expect((await m.post(`/adverse-actions/${id}/withdraw`)).body.stage).toBe('withdrawn');
    expect((await m.get(`/applications/${app2.body.id}`)).body.status).toBe('review');
    const list = await m.get('/adverse-actions');
    expect(list.body.items.length).toBeGreaterThanOrEqual(2);
    expect((await (await asUser(fx.managers.b)).get('/adverse-actions')).body.items).toHaveLength(0);
    expect((await (await asUser(fx.managers.b)).get('/applications')).body.items).toHaveLength(0);
  });
});
