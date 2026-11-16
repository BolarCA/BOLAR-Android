import { Router } from 'express';
import {
  AI_AUDIT_ACTIONS, aiAuditPage, aiAuditQuery, aiBudget, aiCommand, aiCommandResponse, aiThread, aiThreadDetail, aiThreadPage, aiThreadQuery, aiToolCallPage, aiToolCallQuery, createAiThread, idParams, updateAiBudget,
  type AiAuditRowDto,
} from '@bolar/contracts';
import { decodeCursor, toPage } from '@bolar/shared';
import type { Prisma } from '@bolar/db';
import { defineRoute, mount, type RouteDef } from '../../shared/route.js';
import { tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { hasPermission, requireAccess } from '../../shared/access.js';
import { budgetDto, loadBudget } from './budget.js';
import { createThread, loadThread, runCommand, threadDetail, threadDto, toolCallDto } from './service.js';

/**
 * AI assistant module (Days 61-74, API p35): /ai/commands, /ai/threads, /ai/tool-calls, /ai/audit, /ai/budget.
 * `ai:use` gates the assistant; `ai:audit` (compliance, platform) reads every thread, tool call and AI audit row.
 */
type AuditRow = { id: string; createdAt: Date; actorId: string | null; action: string; outcome: string; requestId: string; metadata: unknown };

function auditRowDto(r: AuditRow): AiAuditRowDto {
  const m = (r.metadata ?? {}) as Record<string, unknown>;
  const tools = Array.isArray(m.tools) ? (m.tools as { tool: string; status: string }[]) : typeof m.tool === 'string' ? [{ tool: m.tool, status: 'denied' }] : [];
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    id: r.id, createdAt: r.createdAt.toISOString(), actorId: r.actorId, action: r.action, outcome: r.outcome, requestId: r.requestId,
    threadId: typeof m.threadId === 'string' ? m.threadId : null, tools, model: typeof m.model === 'string' ? m.model : null,
    inputTokens: num(m.inputTokens), outputTokens: num(m.outputTokens), costCents: num(m.costCents), redactionCount: num(m.redactionCount),
    reason: typeof m.reason === 'string' ? m.reason : r.action === 'ai.budget_exceeded' ? `budget exhausted for ${String(m.period ?? 'period')}` : null,
  };
}

export const aiRoutes: RouteDef[] = [
  defineRoute({ method: 'post', path: '/ai/commands', operationId: 'aiCommand', summary: 'Run a natural-language command: plan registered tools, execute them with the actor\'s access, answer with citations; drafts await human approval', tags: ['ai'], auth: 'session', permission: 'ai:use',
    request: { body: aiCommand }, responses: { 201: aiCommandResponse },
    handler: async ({ body, ctx }) => ({ status: 201, body: await runCommand(ctx, body) }) }),

  defineRoute({ method: 'get', path: '/ai/threads', operationId: 'listAiThreads', summary: 'List the actor\'s assistant threads (ai:audit sees every thread in the org)', tags: ['ai'], auth: 'session', permission: 'ai:use',
    request: { query: aiThreadQuery }, responses: { 200: aiThreadPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const where: Prisma.AiThreadWhereInput = { ...(hasPermission(ctx, 'ai:audit') ? {} : { createdBy: ctx.actor!.userId }), ...(query.contextType ? { contextType: query.contextType } : {}), ...(query.contextId ? { contextId: query.contextId } : {}) };
      const rows = await tenantDb(ctx).aiThread.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: query.limit + 1, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map(threadDto) } };
    } }),

  defineRoute({ method: 'post', path: '/ai/threads', operationId: 'createAiThread', summary: 'Open an assistant thread, optionally bound to a record', tags: ['ai'], auth: 'session', permission: 'ai:use',
    request: { body: createAiThread }, responses: { 201: aiThread },
    handler: async ({ body, ctx }) => ({ status: 201, body: threadDto(await createThread(ctx, body)) }) }),

  defineRoute({ method: 'get', path: '/ai/threads/:id', operationId: 'getAiThread', summary: 'Thread with its messages and tool calls', tags: ['ai'], auth: 'session', permission: 'ai:use',
    request: { params: idParams }, responses: { 200: aiThreadDetail },
    handler: async ({ params, ctx }) => ({ body: await threadDetail(ctx, await loadThread(ctx, params.id)) }) }),

  defineRoute({ method: 'get', path: '/ai/tool-calls', operationId: 'listAiToolCalls', summary: 'Tool-call records (status ok|denied|error, input/output hashes) for the actor\'s threads', tags: ['ai'], auth: 'session', permission: 'ai:use',
    request: { query: aiToolCallQuery }, responses: { 200: aiToolCallPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      if (query.threadId) await loadThread(ctx, query.threadId);
      const where: Prisma.AiToolCallWhereInput = {
        ...(query.threadId ? { threadId: query.threadId } : hasPermission(ctx, 'ai:audit') ? {} : { thread: { createdBy: ctx.actor!.userId } }),
        ...(query.status ? { status: query.status } : {}), ...(query.tool ? { tool: query.tool } : {}),
      };
      const rows = await tenantDb(ctx).aiToolCall.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map(toolCallDto) } };
    } }),

  defineRoute({ method: 'get', path: '/ai/audit', operationId: 'listAiAudit', summary: 'AI audit records: commands with tools, model, tokens, cost and redaction counts; denied tool calls; budget refusals', tags: ['ai'], auth: 'session', permission: 'ai:audit',
    request: { query: aiAuditQuery }, responses: { 200: aiAuditPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const and: Prisma.AuditLogWhereInput[] = [{ action: query.action ? query.action : { in: [...AI_AUDIT_ACTIONS] } }];
      if (query.actorId) and.push({ actorId: query.actorId });
      if (query.tool) and.push({ metadata: { path: ['toolNames'], array_contains: [query.tool] } });
      if (query.status === 'exceeded') and.push({ action: 'ai.budget_exceeded' });
      else if (query.status) and.push({ metadata: { path: ['toolStatuses'], array_contains: [query.status] } });
      const rows = await tenantDb(ctx).auditLog.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map(auditRowDto) } };
    } }),

  defineRoute({ method: 'get', path: '/ai/budget', operationId: 'getAiBudget', summary: 'Monthly AI budget for the org (resets lazily each month)', tags: ['ai'], auth: 'session', permission: 'ai:use',
    responses: { 200: aiBudget },
    handler: async ({ ctx }) => ({ body: budgetDto(await loadBudget(ctx)) }) }),

  defineRoute({ method: 'patch', path: '/ai/budget', operationId: 'updateAiBudget', summary: 'Set the monthly AI budget (platform admin or org admin)', tags: ['ai'], auth: 'mfa',
    request: { body: updateAiBudget }, responses: { 200: aiBudget },
    handler: async ({ body, ctx }) => {
      if (!hasPermission(ctx, 'platform:admin')) await requireAccess(ctx, 'org:write'); // 403 + access.denied audit when neither applies
      const row = await loadBudget(ctx);
      const updated = await tenantDb(ctx).aiBudget.update({ where: { id: row.id }, data: { monthlyLimitCents: body.monthlyLimitCents } });
      await audit(ctx, { action: 'ai.budget_update', resourceType: 'ai_budget', resourceId: row.id, before: { monthlyLimitCents: row.monthlyLimitCents }, after: { monthlyLimitCents: updated.monthlyLimitCents } });
      return { status: 200, body: budgetDto(updated) };
    } }),
];

export const aiRouter: Router = Router();
mount(aiRouter, aiRoutes);
