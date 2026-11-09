import { describe, it, expect, beforeAll } from 'vitest';
import { twoTenantFixture, createUser } from '@bolar/testing';
import { prisma } from '@bolar/db';
import { systemContext } from '@bolar/shared';
import { SinkEmailAdapter } from '@bolar/integrations';
import { asUser } from './helpers.js';
import { drainMemoryQueue } from '../shared/queue.js';
import { notify, safeLogFields, type NotificationJobData } from '../modules/notification/service.js';

async function seedTemplates(adminId: string) {
  const mk = async (key: string, channel: string, subject: string | null, body: string, variables: string[]) => {
    const t = await prisma.template.create({ data: { key, channel, name: key, riskLevel: 'low', currentVersion: 1 } });
    await prisma.templateVersion.create({ data: { templateId: t.id, version: 1, subject, body, variables, status: 'approved', approvedBy: adminId, approvedAt: new Date(), createdBy: adminId } });
  };
  await mk('workorder.created', 'email', 'We received your request #{{workOrderId}}', 'Hi {{name}}, your request "{{title}}" was received.', ['name', 'workOrderId', 'title']);
  await mk('sms.workorder.scheduled', 'sms', null, 'BOLAR: visit scheduled for {{when}}.', ['when']);
  await mk('invite.staff', 'email', 'Invited to {{orgName}}', 'Accept: {{acceptUrl}}', ['orgName', 'acceptUrl']);
}

const jsonOf = (v: unknown) => JSON.stringify(v ?? {});

describe('notifications (Day 28): service, delivery jobs, retry, redaction, access', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  let tenant: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    fx = await twoTenantFixture();
    tenant = await createUser(fx.a, 'tenant', 'theo.tenant@alpha.test');
    await seedTemplates(fx.admins.a.id);
    await prisma.tenantProfile.create({ data: { tenantOrgId: fx.a.id, userId: tenant.id, displayName: 'Theo', phone: '+15125550100', status: 'active' } });
  });

  it('email notification: rendered, queued, job enqueued with resolved address; API DTO and audit never expose the address or body', async () => {
    const m = await asUser(fx.managers.a);
    drainMemoryQueue('notifications');
    const res = await m.post('/notifications').send({ recipientUserId: tenant.id, channel: 'email', templateKey: 'workorder.created', variables: { name: 'Theo', workOrderId: 'WO-1', title: 'Leak' }, idempotencyKey: 'wo-1-created-email' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'queued', channel: 'email', recipientId: tenant.id, attempts: 0 });
    expect(res.body.recipientAddress).toBeUndefined();
    expect(jsonOf(res.body)).not.toContain('theo.tenant@alpha.test');
    const jobs = drainMemoryQueue('notifications');
    expect(jobs).toHaveLength(1);
    const job = jobs[0]!.data as NotificationJobData;
    expect(job).toMatchObject({ notificationId: res.body.id, channel: 'email', to: 'theo.tenant@alpha.test', subject: 'We received your request #WO-1', tenantOrgId: fx.a.id });
    expect(job.body).toContain('Hi Theo');

    const audits = await prisma.auditLog.findMany({ where: { tenantOrgId: fx.a.id, resourceType: 'notification', resourceId: res.body.id } });
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) {
      const blob = jsonOf({ metadata: a.metadata, before: a.before, after: a.after });
      expect(blob).not.toContain('theo.tenant@alpha.test');
      expect(blob).not.toContain('Hi Theo');
      expect(blob).not.toContain('Leak');
    }
    const n = await prisma.notification.findUniqueOrThrow({ where: { id: res.body.id } });
    const fields = safeLogFields(n);
    expect(Object.keys(fields).sort()).toEqual(['attempts', 'channel', 'notificationId', 'status', 'templateKey', 'tenantOrgId']);
    expect(jsonOf(fields)).not.toContain('@');

    // idempotency: same key -> same notification, no second job
    const again = await m.post('/notifications').send({ recipientUserId: tenant.id, channel: 'email', templateKey: 'workorder.created', variables: { name: 'Theo', workOrderId: 'WO-1', title: 'Leak' }, idempotencyKey: 'wo-1-created-email' });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(res.body.id);
    expect(drainMemoryQueue('notifications')).toHaveLength(0);

    // Mailhog/sink smoke: the queued job is deliverable through the email adapter in sink mode.
    const sink = new SinkEmailAdapter();
    const delivered = await sink.execute({ to: job.to, subject: job.subject ?? '', text: job.body }, { requestId: job.requestId, tenantOrgId: job.tenantOrgId, actorId: null, idempotencyKey: job.notificationId });
    expect(delivered.accepted).toBe(true);
    expect(sink.log.calls[0]!.input.to).toBe('theo.tenant@alpha.test');
  });

  it('missing template variables fail with 400 listing them; unknown template key is a validation error', async () => {
    const m = await asUser(fx.managers.a);
    const bad = await m.post('/notifications').send({ recipientUserId: tenant.id, channel: 'email', templateKey: 'workorder.created', variables: { name: 'Theo' } });
    expect(bad.status).toBe(400);
    expect(bad.body.fieldErrors.map((f: { path: string }) => f.path).sort()).toEqual(['variables.title', 'variables.workOrderId']);
    expect((await m.post('/notifications').send({ recipientUserId: tenant.id, channel: 'email', templateKey: 'nope.nope', variables: {} })).status).toBe(400);
    expect((await m.post('/notifications').send({ recipientUserId: fx.managers.b.id, channel: 'email', templateKey: 'invite.staff', variables: { orgName: 'A', acceptUrl: 'u' } })).status).toBe(400);
  });

  it('sms resolves the phone from the tenant profile; a recipient without a phone is suppressed (no job)', async () => {
    const m = await asUser(fx.managers.a);
    drainMemoryQueue('notifications');
    const sms = await m.post('/notifications').send({ recipientUserId: tenant.id, channel: 'sms', templateKey: 'sms.workorder.scheduled', variables: { when: 'Tue 9am' } });
    expect(sms.status).toBe(201);
    expect(sms.body.status).toBe('queued');
    const job = drainMemoryQueue('notifications')[0]!.data as NotificationJobData;
    expect(job.to).toBe('+15125550100');
    expect(job.body).toBe('BOLAR: visit scheduled for Tue 9am.');
    const noPhone = await m.post('/notifications').send({ recipientUserId: fx.managers.a.id, channel: 'sms', templateKey: 'sms.workorder.scheduled', variables: { when: 'x' } });
    expect(noPhone.body.status).toBe('suppressed');
    expect(noPhone.body.lastError).toBe('no_phone');
    expect(drainMemoryQueue('notifications')).toHaveLength(0);
  });

  it('in-app: delivered immediately; recipient lists own with rendered body and marks read; others cannot read it; senders see all', async () => {
    const m = await asUser(fx.managers.a);
    const inApp = await m.post('/notifications').send({ recipientUserId: tenant.id, channel: 'in_app', templateKey: 'workorder.created', variables: { name: 'Theo', workOrderId: 'WO-2', title: 'Heat' } });
    expect(inApp.body.status).toBe('delivered');
    const t = await asUser(tenant);
    const mine = await t.get('/notifications?unread=true');
    expect(mine.status).toBe(200);
    expect(mine.body.items.every((n: { recipientId: string }) => n.recipientId === tenant.id)).toBe(true);
    const row = mine.body.items.find((n: { id: string }) => n.id === inApp.body.id);
    expect(row.body).toContain('Heat');
    expect(row.subject).toBe('We received your request #WO-2');
    const read = await t.post(`/notifications/${inApp.body.id}/read`);
    expect(read.status).toBe(200);
    expect(read.body.readAt).not.toBeNull();
    expect((await t.get('/notifications?unread=true')).body.items.map((n: { id: string }) => n.id)).not.toContain(inApp.body.id);
    expect((await t.post(`/notifications/${inApp.body.id}/retry`)).status).toBe(403);
    const other = await asUser(await createUser(fx.a, 'tenant'));
    expect((await other.post(`/notifications/${inApp.body.id}/read`)).status).toBe(404);
    expect((await other.get('/notifications')).body.items).toHaveLength(0);
    const all = await m.get(`/notifications?recipientId=${tenant.id}`);
    expect(all.body.items.length).toBeGreaterThanOrEqual(3);
    // tenant isolation
    const b = await asUser(fx.managers.b);
    expect((await b.get('/notifications')).body.items).toHaveLength(0);
    expect((await b.post(`/notifications/${inApp.body.id}/retry`)).status).toBe(404);
  });

  it('retry re-renders, increments attempts and re-enqueues; delivered notifications cannot be retried', async () => {
    const m = await asUser(fx.managers.a);
    const n = await m.post('/notifications').send({ recipientUserId: tenant.id, channel: 'email', templateKey: 'workorder.created', variables: { name: 'Theo', workOrderId: 'WO-3', title: 'Door' } });
    await prisma.notification.update({ where: { id: n.body.id }, data: { status: 'failed', lastError: 'provider_rejected', attempts: 1 } });
    drainMemoryQueue('notifications');
    const retried = await m.post(`/notifications/${n.body.id}/retry`);
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ status: 'queued', attempts: 2, lastError: null });
    const jobs = drainMemoryQueue('notifications');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.opts?.jobId).toBe(`${n.body.id}:2`);
    await prisma.notification.update({ where: { id: n.body.id }, data: { status: 'delivered' } });
    expect((await m.post(`/notifications/${n.body.id}/retry`)).status).toBe(409);
    expect(await prisma.auditLog.findFirst({ where: { action: 'notification.retry', resourceId: n.body.id } })).not.toBeNull();
  });

  it('service: worker-style system context can notify an external address (invitee) idempotently per request/template/recipient', async () => {
    const ctx = systemContext(fx.a.id, 'req_invite_1');
    drainMemoryQueue('notifications');
    const key = `${ctx.requestId}:invite.staff:new.hire@alpha.test`;
    const first = await notify(ctx, { recipientAddress: 'new.hire@alpha.test', channel: 'email', templateKey: 'invite.staff', variables: { orgName: 'Alpha', acceptUrl: 'https://x/accept' }, idempotencyKey: key });
    const second = await notify(ctx, { recipientAddress: 'new.hire@alpha.test', channel: 'email', templateKey: 'invite.staff', variables: { orgName: 'Alpha', acceptUrl: 'https://x/accept' }, idempotencyKey: key });
    expect(second.id).toBe(first.id);
    expect(first.recipientId.startsWith('external:')).toBe(true);
    expect(first.recipientId).not.toContain('@');
    expect(drainMemoryQueue('notifications')).toHaveLength(1);
    const other = await notify(systemContext(fx.b.id, 'req_b'), { recipientAddress: 'x@beta.test', channel: 'email', templateKey: 'invite.staff', variables: { orgName: 'Beta', acceptUrl: 'u' }, idempotencyKey: key }).catch((e) => e);
    expect(other).toMatchObject({ code: 'idempotency_conflict' });
  });
});
