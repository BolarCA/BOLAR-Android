/**
 * AI eval suite (Day 74 "AI eval suite"): every JSON fixture in modules/ai/evals/fixtures runs as one HTTP command against
 * the mock provider. Assertions cover tools called and their statuses, source citations, refusal wording, PII that must
 * never reach the provider or the AI tables, draft creation in the approval queue and budget refusals. Run with
 * `pnpm --filter @bolar/api exec vitest run ai`. docs/qa/ai-qa.md tabulates the cases.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@bolar/db';
import { MockAiProvider } from '@bolar/integrations';
import { asUser } from './helpers.js';
import { actorOf, aiFixture, refOf, type ActorKey, type AiFixture, type RefKey } from './ai.fixture.js';
import { setAiProviderForTests } from '../modules/ai/provider.js';

interface EvalFixture {
  name: string;
  category: string;
  actor: ActorKey;
  command: string;
  context?: { resourceType: string; ref: RefKey };
  setup?: 'exhaust_budget' | 'restore_budget';
  notes?: string;
  expect: {
    httpStatus: number;
    errorCode?: string;
    tools?: string[];
    statuses?: string[];
    citesSources?: boolean;
    contains?: string[];
    notContains?: string[];
    providerNeverReceives?: string[];
    providerPlanNeverReceives?: string[];
    storedUserMessageContains?: string[];
    storedUserMessageNotContains?: string[];
    storedMessagesNotContain?: string[];
    noticeDraftCreated?: boolean;
    noticeStatus?: string;
    auditAction?: string;
  };
}

const dir = resolve(process.cwd(), 'src/modules/ai/evals/fixtures');
const fixtures: EvalFixture[] = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as EvalFixture);

describe('ai evals: fixtures against the mock provider', () => {
  let fx: AiFixture;
  let provider: MockAiProvider;
  beforeAll(async () => {
    fx = await aiFixture();
    provider = new MockAiProvider();
    setAiProviderForTests(provider);
  });
  afterAll(() => setAiProviderForTests(null));

  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => (key === 'expiredVendorA' ? fx.expiredVendorA.id : refOf(fx, key as RefKey)));

  it('has at least 12 fixtures covering summaries, denied access, injection, PII, budget and anomalies', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
    for (const c of ['summary', 'denied', 'injection', 'pii', 'budget', 'anomaly']) expect(fixtures.some((f) => f.category === c)).toBe(true);
  });

  for (const f of fixtures) {
    it(`[${f.category}] ${f.name}`, async () => {
      const agent = await asUser(actorOf(fx, f.actor));
      if (f.setup === 'exhaust_budget') {
        const admin = await asUser(fx.admins.a);
        const current = await agent.get('/ai/budget');
        expect((await admin.patch('/ai/budget').send({ monthlyLimitCents: current.body.spentCents })).status).toBe(200);
      }
      if (f.setup === 'restore_budget') {
        const admin = await asUser(fx.admins.a);
        expect((await admin.patch('/ai/budget').send({ monthlyLimitCents: 100_000 })).status).toBe(200);
      }
      const noticesBefore = await prisma.notice.count({ where: { tenantOrgId: fx.a.id } });
      provider.planLog.clear();
      provider.answerLog.clear();
      const body = { command: fill(f.command), ...(f.context ? { context: { resourceType: f.context.resourceType, resourceId: refOf(fx, f.context.ref) } } : {}) };
      const res = await agent.post('/ai/commands').send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(f.expect.httpStatus);
      if (f.expect.errorCode) expect(res.body.code).toBe(f.expect.errorCode);
      if (f.expect.auditAction) expect(await prisma.auditLog.count({ where: { tenantOrgId: fx.a.id, action: f.expect.auditAction, actorId: actorOf(fx, f.actor).id } })).toBeGreaterThan(0);
      const noticesAfter = await prisma.notice.count({ where: { tenantOrgId: fx.a.id } });
      if (f.expect.noticeDraftCreated !== undefined) expect(noticesAfter - noticesBefore).toBe(f.expect.noticeDraftCreated ? 1 : 0);
      if (res.status !== 201) return;

      const content: string = res.body.message.content;
      if (f.expect.tools) expect(res.body.toolCalls.map((c: { tool: string }) => c.tool)).toEqual(f.expect.tools);
      if (f.expect.statuses) expect(res.body.toolCalls.map((c: { status: string }) => c.status)).toEqual(f.expect.statuses);
      if (f.expect.citesSources === true) { expect(content).toMatch(/^Sources: /m); expect(res.body.message.sources.length).toBeGreaterThan(0); }
      if (f.expect.citesSources === false) { expect(content).not.toMatch(/^Sources: /m); expect(res.body.message.sources).toEqual([]); }
      for (const s of f.expect.contains ?? []) expect(content).toContain(fill(s));
      for (const s of f.expect.notContains ?? []) expect(content).not.toContain(fill(s));
      const sent = JSON.stringify([...provider.planLog.calls, ...provider.answerLog.calls]);
      for (const s of f.expect.providerNeverReceives ?? []) expect(sent).not.toContain(s);
      const planned = JSON.stringify(provider.planLog.calls);
      for (const s of f.expect.providerPlanNeverReceives ?? []) expect(planned).not.toContain(s);
      if (f.expect.noticeStatus) {
        const draft = res.body.drafts[0];
        expect(draft).toBeTruthy();
        const notice = await prisma.notice.findFirst({ where: { id: draft.id } });
        expect(notice?.status).toBe(f.expect.noticeStatus);
        expect(notice?.sentAt).toBeNull();
      }
      const stored = await prisma.aiMessage.findMany({ where: { threadId: res.body.thread.id }, orderBy: { createdAt: 'asc' } });
      const user = stored.find((m) => m.role === 'user')!;
      for (const s of f.expect.storedUserMessageContains ?? []) expect(user.content).toContain(s);
      for (const s of f.expect.storedUserMessageNotContains ?? []) expect(user.content).not.toContain(s);
      const all = JSON.stringify(stored);
      for (const s of f.expect.storedMessagesNotContain ?? []) expect(all).not.toContain(s);
      // Every successful command leaves exactly one ai.command audit row for its thread with model/cost/redaction metadata.
      const auditRows = await prisma.auditLog.findMany({ where: { tenantOrgId: fx.a.id, action: 'ai.command', resourceId: res.body.thread.id } });
      expect(auditRows).toHaveLength(1);
      const meta = auditRows[0]!.metadata as Record<string, unknown>;
      expect(meta.model).toBe('claude-fable-5-1');
      expect(meta.costCents).toBe(1);
      expect(typeof meta.redactionCount).toBe('number');
    });
  }
});
