import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';
import { renderVersion, missingVariables, escapeHtml } from '../modules/template/render.js';

async function seedPlatformTemplate(adminId: string) {
  const t = await prisma.template.create({ data: { key: 'invite.staff', channel: 'email', name: 'Staff invitation', riskLevel: 'low', currentVersion: 1 } });
  await prisma.templateVersion.create({ data: { templateId: t.id, version: 1, subject: 'You are invited to {{orgName}}', body: 'Hi {{name}}, accept: {{acceptUrl}}', variables: ['orgName', 'name', 'acceptUrl'], status: 'approved', approvedBy: adminId, approvedAt: new Date(), createdBy: adminId } });
  return t;
}

describe('templates (Day 29): registry, approval workflow, rendering', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let lawyer: Awaited<ReturnType<typeof createUser>>;
  let platformTemplateId: string;

  beforeAll(async () => {
    fx = await twoTenantFixture();
    lawyer = await createUser(fx.a, 'lawyer');
    platformTemplateId = (await seedPlatformTemplate(fx.admins.a.id)).id;
  });

  it('render engine: interpolates with HTML escaping, lists every missing variable, sms stays plain', () => {
    const v = { subject: 'Hello {{ name }}', body: 'Rent {{amount}} due {{dueDate}}', variables: ['name', 'amount', 'dueDate', 'extra'] };
    expect(missingVariables(v, { name: 'A' })).toEqual(['amount', 'dueDate', 'extra']);
    expect(() => renderVersion(v, { name: 'A' }, 'email')).toThrowError(/Missing template variables: amount, dueDate, extra/);
    const out = renderVersion(v, { name: '<b>Theo</b>', amount: '$1,450', dueDate: '2026-12-01', extra: 1 }, 'email');
    expect(out.subject).toBe('Hello &lt;b&gt;Theo&lt;/b&gt;');
    expect(out.body).toBe('Rent $1,450 due 2026-12-01');
    expect(renderVersion({ subject: null, body: 'Visit {{when}}', variables: [] }, { when: 'Mon & Tue' }, 'sms').body).toBe('Visit Mon & Tue');
    expect(escapeHtml(`"quotes" & 'apos'`)).toBe('&quot;quotes&quot; &amp; &#39;apos&#39;');
  });

  it('lists platform + org templates; platform templates render but cannot be edited by org users', async () => {
    const m = await asUser(fx.managers.a);
    const list = await m.get('/templates');
    expect(list.status).toBe(200);
    expect(list.body.items.some((t: { id: string; scope: string }) => t.id === platformTemplateId && t.scope === 'platform')).toBe(true);
    const render = await m.post('/templates/invite.staff/render').send({ variables: { orgName: 'Alpha', name: 'Sam', acceptUrl: 'https://x.test/a' } });
    expect(render.status).toBe(200);
    expect(render.body.subject).toBe('You are invited to Alpha');
    const missing = await m.post('/templates/invite.staff/render').send({ variables: { orgName: 'Alpha' } });
    expect(missing.status).toBe(400);
    expect(missing.body.fieldErrors.map((f: { path: string }) => f.path).sort()).toEqual(['variables.acceptUrl', 'variables.name']);
    expect((await m.post('/templates/does.not.exist/render').send({ variables: {} })).status).toBe(400);
    expect((await m.post(`/templates/${platformTemplateId}/versions`).send({ body: 'hijack' })).status).toBe(403);
  });

  it('low-risk org template auto-approves on submit; org override wins over platform default when rendering', async () => {
    const m = await asUser(fx.managers.a);
    const created = await m.post('/templates').send({ key: 'invite.staff', channel: 'email', name: 'Our invite', riskLevel: 'low', subject: 'Join {{orgName}}', body: 'Welcome {{name}}: {{acceptUrl}}' });
    expect(created.status).toBe(201);
    expect(created.body.scope).toBe('org');
    expect(created.body.versions[0].status).toBe('draft');
    expect((await m.post('/templates').send({ key: 'invite.staff', channel: 'email', name: 'dup', body: 'x' })).status).toBe(409);
    const v1 = created.body.versions[0].id as string;
    // approving a draft directly is an invalid transition
    const l = await asUser(lawyer);
    const early = await l.post(`/templates/${created.body.id}/versions/${v1}/approve`);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('invalid_transition');
    const submitted = await m.post(`/templates/${created.body.id}/versions/${v1}/submit`);
    expect(submitted.status).toBe(200);
    expect(submitted.body.versions[0].status).toBe('approved');
    expect(submitted.body.currentVersion).toBe(1);
    const render = await m.post('/templates/invite.staff/render').send({ variables: { orgName: 'Alpha', name: 'Sam', acceptUrl: 'u' } });
    expect(render.body.subject).toBe('Join Alpha');
    expect(render.body.templateId).toBe(created.body.id);
    const b = await asUser(fx.managers.b);
    expect((await b.get(`/templates/${created.body.id}`)).status).toBe(404);
    expect((await b.post('/templates/invite.staff/render').send({ variables: { orgName: 'Beta', name: 'S', acceptUrl: 'u' } })).body.subject).toBe('You are invited to Beta');
  });

  it('high-risk template needs a second-person approval; author cannot approve; new approval retires the old version; reject path', async () => {
    const m = await asUser(fx.managers.a);
    const created = await m.post('/templates').send({ key: 'notice.late_rent', channel: 'notice', name: 'Late rent (TX)', riskLevel: 'high', jurisdiction: 'US-TX', subject: 'Notice of late rent', body: 'Dear {{tenantName}}, rent of {{amount}} is late. {{jurisdictionClause}}', variables: ['tenantName', 'amount', 'jurisdictionClause'] });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const v1 = created.body.versions[0].id as string;
    const submitted = await m.post(`/templates/${id}/versions/${v1}/submit`);
    expect(submitted.body.versions[0].status).toBe('pending_approval');
    expect((await m.post('/templates/notice.late_rent/render').send({ variables: { tenantName: 'T', amount: '$1', jurisdictionClause: 'c' } })).status).toBe(400);
    // manager lacks template:approve -> 403; an approver who authored it is also refused
    expect((await m.post(`/templates/${id}/versions/${v1}/approve`)).status).toBe(403);
    const admin = await asUser(fx.admins.a);
    const own = await admin.post('/templates').send({ key: 'notice.self', channel: 'notice', name: 'Self', riskLevel: 'high', body: 'x' });
    const ownV = own.body.versions[0].id as string;
    await admin.post(`/templates/${own.body.id}/versions/${ownV}/submit`);
    expect((await admin.post(`/templates/${own.body.id}/versions/${ownV}/approve`)).status).toBe(403);

    const l = await asUser(lawyer);
    const approved = await l.post(`/templates/${id}/versions/${v1}/approve`).send({ note: 'Reviewed against Tex. Prop. Code' });
    expect(approved.status).toBe(200);
    expect(approved.body.versions[0]).toMatchObject({ status: 'approved', approvedBy: lawyer.id });
    expect((await l.post(`/templates/${id}/versions/${v1}/approve`)).status).toBe(409);
    const rendered = await m.post('/templates/notice.late_rent/render').send({ variables: { tenantName: 'Theo <script>', amount: '$1,450', jurisdictionClause: 'Clause' } });
    expect(rendered.status).toBe(200);
    expect(rendered.body.body).toContain('Theo &lt;script&gt;');

    // v2 approved -> v1 retired
    const v2res = await m.post(`/templates/${id}/versions`).send({ subject: 'Notice of late rent (v2)', body: 'Dear {{tenantName}}, {{amount}} is overdue. {{jurisdictionClause}}', variables: ['tenantName', 'amount', 'jurisdictionClause'] });
    expect(v2res.status).toBe(201);
    const v2 = v2res.body.versions[0].id as string;
    await m.post(`/templates/${id}/versions/${v2}/submit`);
    const approvedV2 = await l.post(`/templates/${id}/versions/${v2}/approve`);
    expect(approvedV2.body.currentVersion).toBe(2);
    const statuses = Object.fromEntries(approvedV2.body.versions.map((v: { id: string; status: string }) => [v.id, v.status]));
    expect(statuses[v1]).toBe('retired');
    expect(statuses[v2]).toBe('approved');
    expect((await m.post('/templates/notice.late_rent/render').send({ variables: { tenantName: 'T', amount: '$1', jurisdictionClause: 'c' } })).body.version).toBe(2);

    // reject path
    const v3res = await m.post(`/templates/${id}/versions`).send({ body: 'bad {{tenantName}}' });
    const v3 = v3res.body.versions[0].id as string;
    await m.post(`/templates/${id}/versions/${v3}/submit`);
    const rejected = await l.post(`/templates/${id}/versions/${v3}/reject`).send({ note: 'Missing cure period' });
    expect(rejected.body.versions[0].status).toBe('rejected');
    expect((await m.post(`/templates/${id}/versions/${v3}/submit`)).status).toBe(409);

    const audits = await prisma.auditLog.findMany({ where: { tenantOrgId: fx.a.id, resourceId: id } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['template.create', 'template.submit', 'template.approve', 'template.version_create', 'template.reject']));
  });

  it('denied path: tenant role cannot read or create templates (403)', async () => {
    const tenant = await createUser(fx.a, 'tenant');
    const t = await asUser(tenant);
    expect((await t.get('/templates')).status).toBe(403);
    expect((await t.post('/templates').send({ key: 'x.y', channel: 'email', name: 'x', body: 'x' })).status).toBe(403);
  });
});
