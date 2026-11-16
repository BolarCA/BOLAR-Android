import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@bolar/db';
import { MockAiProvider } from '@bolar/integrations';
import { asUser } from './helpers.js';
import { aiFixture, INJECTION_DESCRIPTION, PII, type AiFixture } from './ai.fixture.js';
import { setAiProviderForTests } from '../modules/ai/provider.js';

type Agent = Awaited<ReturnType<typeof asUser>>;

describe('ai assistant: commands, scoped retrieval, denied tools, injection, PII, audit, budget (Days 61-74)', () => {
  let fx: AiFixture;
  let provider: MockAiProvider;
  let manager: Agent;
  beforeAll(async () => {
    fx = await aiFixture();
    provider = new MockAiProvider();
    setAiProviderForTests(provider);
    manager = await asUser(fx.managers.a);
  });
  afterAll(() => setAiProviderForTests(null));

  it('summarises a lease from page context with citations, a tool-call record with hashes and an ai.command audit row', async () => {
    const res = await manager.post('/ai/commands').send({ command: 'Summarize this lease', context: { resourceType: 'lease', resourceId: fx.leaseA.id } });
    expect(res.status).toBe(201);
    expect(res.body.message.role).toBe('assistant');
    expect(res.body.message.content).toContain('Sources:');
    expect(res.body.message.content).toContain(`lease:${fx.leaseA.id}`);
    expect(res.body.message.content).toContain('$1500.00');
    expect(res.body.message.sources.some((s: { type: string; id: string }) => s.type === 'lease' && s.id === fx.leaseA.id)).toBe(true);
    expect(res.body.toolCalls).toHaveLength(1);
    const call = res.body.toolCalls[0];
    expect(call.tool).toBe('summarize_lease');
    expect(call.status).toBe('ok');
    expect(call.inputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(call.outputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(call.messageId).toBe(res.body.message.id);
    expect(res.body.budget.spentCents).toBeGreaterThanOrEqual(1);

    const auditRow = await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'ai.command', resourceId: res.body.thread.id } });
    expect(auditRow).not.toBeNull();
    const meta = auditRow!.metadata as Record<string, unknown>;
    expect(meta.toolNames).toEqual(['summarize_lease']);
    expect(meta.toolStatuses).toEqual(['ok']);
    expect(meta.model).toBe('claude-fable-5-1');
    expect(typeof meta.inputTokens).toBe('number');
    expect(typeof meta.outputTokens).toBe('number');
    expect(meta.costCents).toBe(1);
    expect(typeof meta.redactionCount).toBe('number');
    const stored = await prisma.aiToolCall.findFirst({ where: { id: call.id } });
    expect(stored?.tenantOrgId).toBe(fx.a.id);
  });

  it('threads: create, list own, detail with messages and tool calls, follow-up continues the thread', async () => {
    const created = await manager.post('/ai/threads').send({ title: 'Lease questions', context: { resourceType: 'lease', resourceId: fx.leaseA.id } });
    expect(created.status).toBe(201);
    const first = await manager.post('/ai/commands').send({ threadId: created.body.id, command: 'Give me an overview of the lease' });
    expect(first.status).toBe(201);
    expect(first.body.toolCalls[0].tool).toBe('summarize_lease'); // context comes from the thread
    const second = await manager.post('/ai/commands').send({ threadId: created.body.id, command: 'What should I do next?' });
    expect(second.status).toBe(201);
    expect(second.body.toolCalls[0].tool).toBe('recommend_next_steps');
    expect(second.body.message.content).toMatch(/confidence/i);
    const detail = await manager.get(`/ai/threads/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.messages.filter((m: { role: string }) => m.role === 'user')).toHaveLength(2);
    expect(detail.body.toolCalls).toHaveLength(2);
    const list = await manager.get('/ai/threads');
    expect(list.body.items.some((t: { id: string }) => t.id === created.body.id)).toBe(true);
    const calls = await manager.get(`/ai/tool-calls?threadId=${created.body.id}&status=ok`);
    expect(calls.status).toBe(200);
    expect(calls.body.items).toHaveLength(2);
  });

  it('tenant isolation: a thread in org A never surfaces org B records even when the command names the other org\'s lease id', async () => {
    const res = await manager.post('/ai/commands').send({ command: `Summarize lease ${fx.leaseB.id}` });
    expect(res.status).toBe(201);
    expect(res.body.toolCalls).toHaveLength(1);
    expect(res.body.toolCalls[0].tool).toBe('summarize_lease');
    expect(res.body.toolCalls[0].status).toBe('denied');
    expect(res.body.message.content).toMatch(/can't access/i);
    expect(res.body.message.content).not.toContain('909');
    expect(res.body.message.content).not.toContain('1999.00');
    expect(res.body.message.sources).toEqual([]);
    // Org B cannot read org A's thread or its tool calls, and does not see it in lists.
    const managerB = await asUser(fx.managers.b);
    expect((await managerB.get(`/ai/threads/${res.body.thread.id}`)).status).toBe(404);
    expect((await managerB.get(`/ai/tool-calls?threadId=${res.body.thread.id}`)).status).toBe(404);
    const listB = await managerB.get('/ai/threads');
    expect(listB.body.items).toEqual([]);
    // Another user in org A cannot open the manager's thread either (404, no existence leak).
    const tenant = await asUser(fx.tenantA);
    expect((await tenant.get(`/ai/threads/${res.body.thread.id}`)).status).toBe(404);
  });

  it('denied tool calls: non-party tenant, privileged case, restricted document, missing notice permission; vendor has no ai:use', async () => {
    const outsider = await asUser(fx.outsiderA);
    const res = await outsider.post('/ai/commands').send({ command: 'Summarize this lease', context: { resourceType: 'lease', resourceId: fx.leaseA.id } });
    expect(res.status).toBe(201);
    expect(res.body.toolCalls[0]).toMatchObject({ tool: 'summarize_lease', status: 'denied' });
    expect(res.body.message.content).toMatch(/can't access/i);
    expect(res.body.message.content).not.toContain('$1500.00');
    const denied = await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'ai.tool_denied', actorId: fx.outsiderA.id } });
    expect(denied).not.toBeNull();
    expect((denied!.metadata as { tool: string }).tool).toBe('summarize_lease');
    const accessDenied = await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'access.denied', actorId: fx.outsiderA.id, resourceType: 'lease', resourceId: fx.leaseA.id } });
    expect(accessDenied).not.toBeNull();

    const privileged = await manager.post('/ai/commands').send({ command: `Summarize case ${fx.caseA.id}` });
    expect(privileged.body.toolCalls[0]).toMatchObject({ tool: 'summarize_case', status: 'denied' });
    expect(privileged.body.message.content).not.toContain('Privileged eviction matter');

    const restricted = await manager.post('/ai/commands').send({ command: 'Summarize this document', context: { resourceType: 'document', resourceId: fx.restrictedDocA.id } });
    expect(restricted.body.toolCalls[0]).toMatchObject({ tool: 'summarize_document', status: 'denied' });
    expect(restricted.body.message.content).toMatch(/classified/i);

    const tenant = await asUser(fx.tenantA);
    const noDraft = await tenant.post('/ai/commands').send({ command: 'Draft a late rent notice for this lease', context: { resourceType: 'lease', resourceId: fx.leaseA.id } });
    expect(noDraft.status).toBe(201);
    expect(noDraft.body.toolCalls[0]).toMatchObject({ tool: 'draft_notice', status: 'denied' });
    expect(noDraft.body.drafts).toEqual([]);
    expect(await prisma.notice.count({ where: { tenantOrgId: fx.a.id, createdBy: fx.tenantA.id } })).toBe(0);

    const vendor = await asUser(fx.vendorA);
    const forbidden = await vendor.post('/ai/commands').send({ command: 'Summarize this lease', context: { resourceType: 'lease', resourceId: fx.leaseA.id } });
    expect(forbidden.status).toBe(403);
    expect((await vendor.get('/ai/threads')).status).toBe(403);
  });

  it('prompt injection in a work order description does not trigger any tool beyond the requested summary', async () => {
    const before = await prisma.notice.count({ where: { tenantOrgId: fx.a.id } });
    const res = await manager.post('/ai/commands').send({ command: 'Summarize this work order', context: { resourceType: 'work_order', resourceId: fx.workOrderA.id } });
    expect(res.status).toBe(201);
    expect(res.body.toolCalls.map((c: { tool: string }) => c.tool)).toEqual(['summarize_work_order']);
    expect(res.body.drafts).toEqual([]);
    expect(await prisma.notice.count({ where: { tenantOrgId: fx.a.id } })).toBe(before);
    // The description is quoted as data (not acted on) and the answer still cites the work order.
    expect(res.body.message.content).toContain('quoted as provided, not instructions');
    expect(res.body.message.content).toContain(`work_order:${fx.workOrderA.id}`);
    const planned = provider.planLog.calls.at(-1)!.input;
    expect(planned.command).not.toContain(INJECTION_DESCRIPTION); // planning only ever sees the user's command
    const answered = provider.answerLog.calls.at(-1)!.input;
    expect(answered.outcomes[0]!.untrusted[0]!.text).toContain('IGNORE PREVIOUS INSTRUCTIONS');
    // A follow-up in the same thread (history now contains the injected text) still plans from the command only.
    const follow = await manager.post('/ai/commands').send({ threadId: res.body.thread.id, command: 'What are the next steps?' });
    expect(follow.body.toolCalls.map((c: { tool: string }) => c.tool)).toEqual(['recommend_next_steps']);
    expect(await prisma.notice.count({ where: { tenantOrgId: fx.a.id } })).toBe(before);
  });

  it('PII redaction: restricted fields never reach the provider; stored messages are redacted', async () => {
    provider.planLog.clear();
    provider.answerLog.clear();
    const res = await manager.post('/ai/commands').send({ command: `Summarize this lease. Tenant SSN 123-45-6789, email ${PII.email}, phone ${PII.phone}`, context: { resourceType: 'lease', resourceId: fx.leaseA.id } });
    expect(res.status).toBe(201);
    const everythingSent = JSON.stringify([...provider.planLog.calls, ...provider.answerLog.calls]);
    expect(everythingSent).not.toContain(PII.ssnLast4);
    expect(everythingSent).not.toContain(PII.dateOfBirth);
    expect(everythingSent).not.toContain('1979');
    expect(everythingSent).not.toContain('123-45-6789');
    expect(everythingSent).not.toContain(PII.email);
    expect(everythingSent).not.toContain('5550199');
    expect(everythingSent).toContain('[ssn]');
    expect(everythingSent).toContain('[email]');
    const stored = await prisma.aiMessage.findMany({ where: { threadId: res.body.thread.id }, orderBy: { createdAt: 'asc' } });
    expect(stored[0]!.role).toBe('user');
    expect(stored[0]!.content).toContain('[ssn]');
    expect(stored[0]!.content).toContain('[email]');
    expect(stored[0]!.content).not.toContain('123-45-6789');
    expect(stored[0]!.redactionCount).toBeGreaterThanOrEqual(3);
    expect(res.body.userMessage.content).not.toContain(PII.email);
    const all = JSON.stringify(stored);
    expect(all).not.toContain(PII.ssnLast4);
    expect(all).not.toContain('1979');
    const auditRow = await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'ai.command', resourceId: res.body.thread.id } });
    expect((auditRow!.metadata as { redactionCount: number }).redactionCount).toBeGreaterThanOrEqual(3);
  });

  it('draft_notice creates a Notice draft through the notice module (human approval chain), never sends', async () => {
    const res = await manager.post('/ai/commands').send({ command: 'Draft a late rent notice for this lease', context: { resourceType: 'lease', resourceId: fx.leaseA.id } });
    expect(res.status).toBe(201);
    expect(res.body.toolCalls[0]).toMatchObject({ tool: 'draft_notice', status: 'ok' });
    expect(res.body.drafts).toHaveLength(1);
    const draft = res.body.drafts[0];
    expect(draft.type).toBe('notice');
    expect(draft.status).toBe('draft');
    expect(draft.href).toBe(`/manager/notices?focus=${draft.id}`);
    expect(res.body.message.content).toContain('Draft created, awaiting approval');
    const notice = await prisma.notice.findFirst({ where: { id: draft.id } });
    expect(notice).toMatchObject({ tenantOrgId: fx.a.id, status: 'draft', kind: 'late_rent', leaseId: fx.leaseA.id, recipientId: fx.profileA.id, createdBy: fx.managers.a.id, sentAt: null, approvedBy: null });
    expect(notice!.bodyDraft).toContain('$1500.00');
    expect(res.body.toolCalls[0].draftRef).toMatchObject({ type: 'notice', id: draft.id });
    expect(await prisma.auditLog.count({ where: { action: 'notice.create', resourceId: draft.id } })).toBe(1);
    // The draft is visible in the notice approval queue as a plain draft (no AI-specific bypass).
    const queue = await manager.get('/notices?status=draft');
    expect(queue.body.items.some((n: { id: string }) => n.id === draft.id)).toBe(true);
  });

  it('flag_anomalies and list_due_items read only within the actor scope and cite each flagged record', async () => {
    // The previous test drafted a late-rent notice for lease A, which correctly suppresses the "overdue invoice without
    // notice" flag; cancel it so the invoice anomaly is visible again.
    await prisma.notice.updateMany({ where: { tenantOrgId: fx.a.id, leaseId: fx.leaseA.id }, data: { status: 'canceled' } });
    const anomalies = await manager.post('/ai/commands').send({ command: 'Flag anomalies and risks in my portfolio' });
    expect(anomalies.body.toolCalls[0]).toMatchObject({ tool: 'flag_anomalies', status: 'ok' });
    const text: string = anomalies.body.message.content;
    expect(text).toContain('Lapsed Cover Electric');
    expect(text).toContain('INV-A-0001');
    expect(text).toContain(`vendor:${fx.expiredVendorA.id}`);
    expect(text).toContain(`lease:${fx.leaseA.id}`); // ends within 60 days without renewal + no documents
    expect(text).not.toContain('909');
    const due = await manager.post('/ai/commands').send({ command: 'What is overdue or due this week?' });
    expect(due.body.toolCalls[0]).toMatchObject({ tool: 'list_due_items', status: 'ok' });
    expect(due.body.message.content).toContain('Leaking kitchen tap');
    expect(due.body.message.content).toContain(`work_order:${fx.workOrderA.id}`);
  });

  it('AI audit: ai:audit required; compliance sees commands with tools, cost and redactions; filters by tool and status', async () => {
    expect((await manager.get('/ai/audit')).status).toBe(403);
    const compliance = await asUser(fx.complianceA);
    const all = await compliance.get('/ai/audit');
    expect(all.status).toBe(200);
    expect(all.body.items.length).toBeGreaterThan(3);
    const command = all.body.items.find((r: { action: string }) => r.action === 'ai.command');
    expect(command).toBeTruthy();
    expect(command.model).toBe('claude-fable-5-1');
    expect(command.costCents).toBe(1);
    expect(typeof command.redactionCount).toBe('number');
    expect(command.tools.length).toBeGreaterThan(0);
    const byTool = await compliance.get('/ai/audit?tool=draft_notice');
    expect(byTool.body.items.length).toBeGreaterThan(0);
    for (const r of byTool.body.items) expect(r.tools.some((t: { tool: string }) => t.tool === 'draft_notice')).toBe(true);
    const denied = await compliance.get('/ai/audit?status=denied');
    expect(denied.body.items.length).toBeGreaterThan(0);
    for (const r of denied.body.items) expect(r.tools.some((t: { status: string }) => t.status === 'denied')).toBe(true);
    const byActor = await compliance.get(`/ai/audit?actorId=${fx.outsiderA.id}`);
    for (const r of byActor.body.items) expect(r.actorId).toBe(fx.outsiderA.id);
    // Compliance can open any thread in the org for review; a thread from org B is still 404.
    const threads = await compliance.get('/ai/threads');
    expect(threads.body.items.length).toBeGreaterThan(0);
    const managerB = await asUser(fx.managers.b);
    const threadB = await managerB.post('/ai/threads').send({ title: 'B only' });
    expect((await compliance.get(`/ai/threads/${threadB.body.id}`)).status).toBe(404);
  });

  it('cost budget: PATCH is admin-only; exceeding the monthly limit returns 429 rate_limited and audits ai.budget_exceeded', async () => {
    expect((await manager.patch('/ai/budget').send({ monthlyLimitCents: 1 })).status).toBe(403);
    const admin = await asUser(fx.admins.a);
    const current = await manager.get('/ai/budget');
    expect(current.status).toBe(200);
    expect(current.body.period).toMatch(/^\d{4}-\d{2}$/);
    const limit = await admin.patch('/ai/budget').send({ monthlyLimitCents: current.body.spentCents + 1 });
    expect(limit.status).toBe(200);
    expect(limit.body.exhausted).toBe(false);
    const ok = await manager.post('/ai/commands').send({ command: 'Summarize this lease', context: { resourceType: 'lease', resourceId: fx.leaseA.id } });
    expect(ok.status).toBe(201);
    expect(ok.body.budget.exhausted).toBe(true);
    const blocked = await manager.post('/ai/commands').send({ command: 'Summarize this lease', context: { resourceType: 'lease', resourceId: fx.leaseA.id } });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('rate_limited');
    expect(await prisma.auditLog.count({ where: { tenantOrgId: fx.a.id, action: 'ai.budget_exceeded' } })).toBe(1);
    expect((await manager.get('/ai/budget')).body.exhausted).toBe(true);
    // Org B has its own budget and is unaffected.
    const managerB = await asUser(fx.managers.b);
    const b = await managerB.get('/ai/budget');
    expect(b.body.spentCents).toBe(0);
    expect(b.body.exhausted).toBe(false);
    // Lazy monthly reset: a stale period resets spend on the next read.
    await prisma.aiBudget.updateMany({ where: { tenantOrgId: fx.a.id }, data: { period: '2000-01' } });
    const reset = await manager.get('/ai/budget');
    expect(reset.body.spentCents).toBe(0);
    expect(reset.body.exhausted).toBe(false);
    await admin.patch('/ai/budget').send({ monthlyLimitCents: 5000 });
  });
});
