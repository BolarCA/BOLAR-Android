import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';
import { drainMemoryQueue } from '../shared/queue.js';
import { renderTemplate } from '../modules/notice/service.js';
import { RULE_KEYS, ensureStarterRules } from '../modules/compliance/starter-rules.js';

describe('notice template rendering', () => {
  it('interpolates {{vars}} and blanks unknowns', () => {
    expect(renderTemplate('Hi {{ name }}, {{amount}} due {{dueDate}}.', { name: 'Theo', amount: '$1,450.00' })).toBe('Hi Theo, $1,450.00 due .');
  });
});

describe('notices (Days 43-45): template registry, guard, approval gate, send', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let officer: Awaited<ReturnType<typeof createUser>>;
  let recipient: { id: string };
  beforeAll(async () => {
    fx = await twoTenantFixture();
    await ensureStarterRules(fx.admins.a.id);
    officer = await createUser(fx.a, 'compliance_officer');
    recipient = await prisma.tenantProfile.create({ data: { tenantOrgId: fx.a.id, displayName: 'Theo Tenant', status: 'active' } });
    // platform template with an approved version (registry path) + a draft-only tenant template that must be ignored
    const tpl = await prisma.template.create({ data: { key: 'notice.late_rent', channel: 'notice', name: 'Late rent', riskLevel: 'high', currentVersion: 1 } });
    await prisma.templateVersion.create({ data: { templateId: tpl.id, version: 1, body: 'Dear {{tenantName}}, rent of {{amount}} was due {{dueDate}}. {{jurisdictionClause}}', status: 'approved', approvedBy: fx.admins.a.id, approvedAt: new Date(), createdBy: fx.admins.a.id } });
    const tenantTpl = await prisma.template.create({ data: { tenantOrgId: fx.a.id, key: 'notice.late_rent', channel: 'notice', name: 'Late rent (draft)', riskLevel: 'high' } });
    await prisma.templateVersion.create({ data: { tenantOrgId: fx.a.id, templateId: tenantTpl.id, version: 1, body: 'DRAFT ONLY', status: 'draft', createdBy: fx.admins.a.id } });
  });

  it('drafts from the approved template, submits, approver != author, approve publishes notice.approved, send marks sentAt', async () => {
    const m = await asUser(fx.managers.a);
    const created = await m.post('/notices').send({ kind: 'late_rent', templateKey: 'notice.late_rent', recipientId: recipient.id, variables: { amount: '$1,450.00', dueDate: 'Nov 1', jurisdictionClause: 'Texas Property Code applies.' } });
    expect(created.status).toBe(201);
    expect(created.body.bodyDraft).toBe('Dear Theo Tenant, rent of $1,450.00 was due Nov 1. Texas Property Code applies.');
    expect(created.body).toMatchObject({ status: 'draft', result: 'allow', guard: { flagged: false, hits: [] }, recipientName: 'Theo Tenant' });
    const id = created.body.id;
    expect((await m.post(`/notices/${id}/approve`)).status).toBe(403); // manager lacks notice:approve
    expect((await m.post(`/notices/${id}/send`)).status).toBe(409); // not approved yet
    expect((await m.post(`/notices/${id}/submit`)).body.status).toBe('pending_approval');
    const o = await asUser(officer);
    drainMemoryQueue();
    const approved = await o.post(`/notices/${id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'approved', approvedBy: officer.id });
    const events = drainMemoryQueue('domain-events').map((j) => j.data as { name: string; payload: { noticeId: string } });
    expect(events.find((e) => e.name === 'notice.approved')?.payload.noticeId).toBe(id);
    const sent = await m.post(`/notices/${id}/send`);
    expect(sent.body.status).toBe('sent');
    expect(sent.body.sentAt).not.toBeNull();
    expect((await m.post(`/notices/${id}/cancel`)).status).toBe(409); // sent cannot be canceled
    expect(await prisma.auditLog.findFirst({ where: { action: 'notice.approved', resourceId: id } })).not.toBeNull();
  });

  it('author cannot approve own notice; approver can reject with a note and the drafter can reopen', async () => {
    const o = await asUser(officer);
    const created = await o.post('/notices').send({ kind: 'general', templateKey: 'notice.general', recipientId: recipient.id, variables: { body: 'Pool closed for maintenance Friday.' } });
    expect(created.body.bodyDraft).toBe('Pool closed for maintenance Friday.');
    await o.post(`/notices/${created.body.id}/submit`);
    expect((await o.post(`/notices/${created.body.id}/approve`)).status).toBe(403);
    const lawyer = await createUser(fx.a, 'lawyer');
    const l = await asUser(lawyer);
    expect((await l.post(`/notices/${created.body.id}/reject`).send({ note: 'Add the reopening date.' })).body.status).toBe('rejected');
    expect((await o.post(`/notices/${created.body.id}/reopen`)).body.status).toBe('draft');
    expect(await prisma.auditLog.findFirst({ where: { action: 'notice.review_note', resourceId: created.body.id } })).not.toBeNull();
  });

  it('SOI / fair housing guard flags the draft and routes it to review with evidence', async () => {
    const m = await asUser(fx.managers.a);
    const created = await m.post('/notices').send({ kind: 'general', templateKey: 'community.rules', body: 'Reminder: {{line}}', recipientId: recipient.id, variables: { line: 'No Section 8 tenants in this building.' } });
    expect(created.status).toBe(201);
    expect(created.body.result).toBe('review');
    expect(created.body.guard.flagged).toBe(true);
    expect(created.body.guard.hits[0]).toMatchObject({ ruleKey: RULE_KEYS.soi, term: 'no section 8' });
    expect(created.body.ruleEvaluationIds).toHaveLength(1);
    const o = await asUser(officer);
    const q = await o.get(`/rules/evaluations?resourceType=notice&resourceId=${created.body.id}`);
    expect(q.body.items[0]).toMatchObject({ ruleKey: RULE_KEYS.soi, result: 'review' });
    expect(q.body.items[0].evidenceJson.matchedTerms).toEqual(['no section 8']);
    // review-level hits do not stop submission; the approver sees them
    expect((await m.post(`/notices/${created.body.id}/submit`)).body.status).toBe('pending_approval');
  });

  it('entry notice with < 24h lead time is blocked by the notice rule until the queue item is resolved', async () => {
    const m = await asUser(fx.managers.a);
    const created = await m.post('/notices').send({ kind: 'entry', templateKey: 'notice.entry', recipientId: recipient.id, variables: { entryAt: 'tomorrow 9am', reason: 'smoke detector check' }, facts: { entryLeadHours: 12, emergency: false }, propertyId: fx.propA.id });
    expect(created.body.result).toBe('block');
    expect(created.body.ruleHits[0].ruleKey).toBe(RULE_KEYS.entryNotice);
    const blocked = await m.post(`/notices/${created.body.id}/submit`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain(RULE_KEYS.entryNotice);
    const o = await asUser(officer);
    expect((await o.post(`/rules/evaluations/${created.body.ruleEvaluationIds[0]}/resolve`).send({ resolution: 'remediated', note: 'Entry rescheduled to 48h out.' })).status).toBe(200);
    expect((await m.post(`/notices/${created.body.id}/submit`)).status).toBe(200);
  });

  it('validation and isolation: unknown template without body, unknown recipient, other tenant 404, vendor denied with audit', async () => {
    const m = await asUser(fx.managers.a);
    expect((await m.post('/notices').send({ kind: 'general', templateKey: 'nope.missing', recipientId: recipient.id })).status).toBe(400);
    expect((await m.post('/notices').send({ kind: 'general', templateKey: 'notice.general', recipientId: 'tp_other', variables: { body: 'x' } })).status).toBe(400);
    const mine = await m.get('/notices');
    expect(mine.body.items.length).toBeGreaterThan(0);
    const b = await asUser(fx.managers.b);
    expect((await b.get('/notices')).body.items).toHaveLength(0);
    expect((await b.get(`/notices/${mine.body.items[0].id}`)).status).toBe(404);
    const vendor = await createUser(fx.a, 'vendor');
    expect((await (await asUser(vendor)).get('/notices')).status).toBe(403);
    expect(await prisma.auditLog.findFirst({ where: { action: 'access.denied', resourceType: 'notice', actorId: vendor.id } })).not.toBeNull();
  });
});
