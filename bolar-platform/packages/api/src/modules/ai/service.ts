/**
 * AI command router (Days 61-74). One command = one plan (provider) -> registered tools only, each gated by the same
 * access checks as the HTTP routes -> one answer (provider) with retrieved text wrapped as untrusted data. Everything
 * that leaves the API or is stored passes through redactForModel; each command writes an `ai.command` audit row with
 * tools, model, tokens, cost and redaction counts; the org budget is pre-checked and charged. Drafts land in the owning
 * module's approval queue; the assistant never sends, approves or decides.
 */
import { createHash } from 'node:crypto';
import type { AiCommandDto, AiCommandResponseDto, AiDraftRefDto, AiMessageDto, AiSourceDto, AiThreadDetailDto, AiThreadDto, AiToolCallDto } from '@bolar/contracts';
import { formatSources, type AiHistoryMessage, type AiPlan, type AiPlannedCall, type AiToolOutcome, type AiToolStatus } from '@bolar/integrations';
import { errors, isAppError, type RequestContext } from '@bolar/shared';
import type { AiMessage, AiThread, AiToolCall } from '@bolar/db';
import { tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { hasPermission } from '../../shared/access.js';
import { publish } from '../../shared/events.js';
import { toDto } from '../../shared/route.js';
import { logger } from '../../logger.js';
import { aiProvider } from './provider.js';
import { assertBudget, budgetDto, chargeBudget, loadBudget } from './budget.js';
import { redactForModel, redactTextCounted } from './redaction.js';
import { getTool, toolSpecs, type AiToolRunResult } from './tools.js';

const MAX_TOOL_CALLS = 3;
const HISTORY_LIMIT = 6;

export const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');

export function threadDto(row: AiThread): AiThreadDto {
  return toDto(row, ['tenantOrgId']) as unknown as AiThreadDto;
}
export function messageDto(row: AiMessage): AiMessageDto {
  return toDto(row, ['tenantOrgId']) as unknown as AiMessageDto;
}
export function toolCallDto(row: AiToolCall): AiToolCallDto {
  return toDto(row, ['tenantOrgId']) as unknown as AiToolCallDto;
}

/** Threads belong to their author; ai:audit holders (compliance, platform) may read any thread in the org. Denied -> 404. */
export async function loadThread(ctx: RequestContext, id: string): Promise<AiThread> {
  const row = await tenantDb(ctx).aiThread.findFirst({ where: { id } });
  if (!row) throw errors.notFound();
  if (row.createdBy !== ctx.actor!.userId && !hasPermission(ctx, 'ai:audit')) {
    await audit(ctx, { action: 'access.denied', resourceType: 'ai_thread', resourceId: row.id, outcome: 'deny', metadata: { permission: 'ai:use', reason: 'thread belongs to another user' } });
    throw errors.notFound();
  }
  return row;
}

export async function threadDetail(ctx: RequestContext, row: AiThread): Promise<AiThreadDetailDto> {
  const db = tenantDb(ctx);
  const [messages, toolCalls] = await Promise.all([
    db.aiMessage.findMany({ where: { threadId: row.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 200 }),
    db.aiToolCall.findMany({ where: { threadId: row.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 200 }),
  ]);
  return { ...threadDto(row), messages: messages.map(messageDto), toolCalls: toolCalls.map(toolCallDto) };
}

export async function createThread(ctx: RequestContext, input: { title?: string; context: { resourceType?: string; resourceId?: string } }): Promise<AiThread> {
  const title = redactTextCounted(input.title?.trim() || 'New conversation').text.slice(0, 120);
  const row = await tenantDb(ctx).aiThread.create({ data: { tenantOrgId: ctx.tenantOrgId!, createdBy: ctx.actor!.userId, title, contextType: input.context.resourceType ?? null, contextId: input.context.resourceId ?? null } });
  await audit(ctx, { action: 'ai.thread_create', resourceType: 'ai_thread', resourceId: row.id, after: { title, contextType: row.contextType, contextId: row.contextId } });
  return row;
}

interface ExecutedCall { call: AiPlannedCall; outcome: AiToolOutcome; result: AiToolRunResult | null; durationMs: number; error: string | null }

function denialMessage(code: string): string {
  if (code === 'review_required') return 'that record is classified and needs an approved sensitive-access request first';
  return 'you do not have access to that record, or it does not exist';
}

/** Run one planned call through the registry with the same access checks as the routes. Never throws. */
async function executeCall(ctx: RequestContext, call: AiPlannedCall): Promise<ExecutedCall> {
  const started = Date.now();
  const tool = getTool(call.name);
  const base = { callId: call.id, name: call.name, facts: {}, sources: [], untrusted: [] };
  if (!tool) return { call, outcome: { ...base, status: 'denied', message: 'that tool is not registered' }, result: null, durationMs: Date.now() - started, error: 'tool_not_registered' };
  if (!hasPermission(ctx, tool.permission)) return { call, outcome: { ...base, status: 'denied', message: 'your role does not include this action' }, result: null, durationMs: Date.now() - started, error: `missing permission ${tool.permission}` };
  const parsed = tool.input.safeParse(call.input ?? {});
  if (!parsed.success) return { call, outcome: { ...base, status: 'error', message: 'the request did not name a valid record' }, result: null, durationMs: Date.now() - started, error: `invalid input: ${parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}` };
  try {
    const result = await tool.run(ctx, parsed.data);
    const facts = redactForModel(result.facts).value;
    const untrusted = (result.untrusted ?? []).map((u) => ({ label: u.label, text: redactTextCounted(u.text).text }));
    return { call, outcome: { callId: call.id, name: call.name, status: 'ok', facts, sources: result.sources, untrusted }, result, durationMs: Date.now() - started, error: null };
  } catch (err) {
    if (isAppError(err) && (err.code === 'not_found' || err.code === 'forbidden' || err.code === 'review_required' || err.code === 'unauthenticated')) {
      return { call, outcome: { ...base, status: 'denied', message: denialMessage(err.code) }, result: null, durationMs: Date.now() - started, error: err.code };
    }
    if (isAppError(err)) return { call, outcome: { ...base, status: 'error', message: err.message }, result: null, durationMs: Date.now() - started, error: `${err.code}: ${err.message}` };
    logger.error({ err, tool: call.name, requestId: ctx.requestId }, 'ai tool failed');
    return { call, outcome: { ...base, status: 'error', message: 'internal error' }, result: null, durationMs: Date.now() - started, error: 'internal_error' };
  }
}

function countRedactionsIn(value: unknown): number {
  return redactForModel(value).count;
}

export async function runCommand(ctx: RequestContext, body: AiCommandDto): Promise<AiCommandResponseDto> {
  const db = tenantDb(ctx);
  const provider = aiProvider();
  const budget = await loadBudget(ctx);
  await assertBudget(ctx, budget);

  const context = { resourceType: body.context.resourceType, resourceId: body.context.resourceId };
  const thread = body.threadId ? await loadThread(ctx, body.threadId) : await createThread(ctx, { title: body.command.slice(0, 80), context });
  const effectiveContext = context.resourceId ? context : { resourceType: thread.contextType ?? undefined, resourceId: thread.contextId ?? undefined };

  // 1. Redact the command before it is stored or leaves the API.
  const command = redactTextCounted(body.command);
  let redactionCount = command.count;
  const userMessage = await db.aiMessage.create({ data: { tenantOrgId: ctx.tenantOrgId!, threadId: thread.id, role: 'user', content: command.text, redactionCount: command.count } });
  const historyRows = await db.aiMessage.findMany({ where: { threadId: thread.id, id: { not: userMessage.id } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: HISTORY_LIMIT });
  const history: AiHistoryMessage[] = historyRows.reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  const adapterCtx = { requestId: ctx.requestId, tenantOrgId: ctx.tenantOrgId, actorId: ctx.actor!.userId };

  // 2. Plan: the provider sees the registry and the redacted command; it never executes anything.
  const plan: AiPlan = await provider.plan({ command: command.text, context: effectiveContext, tools: toolSpecs(), history }, adapterCtx);
  const planned = plan.calls.slice(0, MAX_TOOL_CALLS);

  // 3. Execute each planned call through the registry (permission + resource checks identical to the routes).
  const executed: ExecutedCall[] = [];
  for (const call of planned) executed.push(await executeCall(ctx, call));

  const toolCallRows: AiToolCall[] = [];
  const drafts: AiDraftRefDto[] = [];
  for (const e of executed) {
    const inputRedacted = redactForModel(e.call.input ?? {});
    redactionCount += inputRedacted.count;
    if (e.result) redactionCount += countRedactionsIn(e.result.facts) + (e.result.untrusted ?? []).reduce((n, u) => n + redactTextCounted(u.text).count, 0);
    const row = await db.aiToolCall.create({
      data: {
        tenantOrgId: ctx.tenantOrgId!, threadId: thread.id, tool: e.call.name, status: e.outcome.status, inputHash: hash(e.call.input ?? {}),
        outputHash: e.outcome.status === 'ok' ? hash({ facts: e.outcome.facts, sources: e.outcome.sources, untrusted: e.outcome.untrusted }) : null,
        inputSummary: inputRedacted.value as object, sources: e.outcome.sources as unknown as object, draftRef: (e.result?.draft as unknown as object | undefined) ?? undefined, error: e.error, durationMs: e.durationMs,
      },
    });
    toolCallRows.push(row);
    if (e.result?.draft) drafts.push(e.result.draft);
    if (e.outcome.status === 'denied') {
      await audit(ctx, { action: 'ai.tool_denied', resourceType: 'ai_tool_call', resourceId: row.id, outcome: 'deny', metadata: { threadId: thread.id, tool: e.call.name, reason: e.error, toolNames: [e.call.name], toolStatuses: ['denied'], inputHash: row.inputHash } });
    }
  }

  // 4. Answer from outcomes only; retrieved text is wrapped as untrusted data by the provider.
  const outcomes = executed.map((e) => e.outcome);
  const answer = await provider.answer({ command: command.text, context: effectiveContext, history, plan, outcomes }, adapterCtx);
  const okSources: AiSourceDto[] = outcomes.filter((o) => o.status === 'ok').flatMap((o) => o.sources);
  const answerRedacted = redactTextCounted(answer.text);
  redactionCount += answerRedacted.count;
  let text = answerRedacted.text;
  if (okSources.length && !/^Sources:/m.test(text)) text = `${text}\n\n${formatSources(okSources)}`; // router-enforced citations
  const usage = { inputTokens: plan.usage.inputTokens + answer.usage.inputTokens, outputTokens: plan.usage.outputTokens + answer.usage.outputTokens };
  const costCents = provider.estimateCostCents(usage);
  const model = answer.model || plan.model || provider.model;

  const assistant = await db.aiMessage.create({ data: { tenantOrgId: ctx.tenantOrgId!, threadId: thread.id, role: 'assistant', content: text, sources: okSources as unknown as object, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costCents, redactionCount } });
  if (toolCallRows.length) await db.aiToolCall.updateMany({ where: { id: { in: toolCallRows.map((r) => r.id) } }, data: { messageId: assistant.id } });
  await db.aiThread.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
  const charged = await chargeBudget(ctx, budget, costCents);

  // 5. AI output audit (p35): tools used, model, tokens, cost, redactions.
  const tools = executed.map((e) => ({ tool: e.call.name, status: e.outcome.status as AiToolStatus }));
  await audit(ctx, {
    action: 'ai.command', resourceType: 'ai_thread', resourceId: thread.id, outcome: answer.refused ? 'deny' : 'allow',
    metadata: { threadId: thread.id, messageId: assistant.id, tools, toolNames: tools.map((t) => t.tool), toolStatuses: tools.map((t) => t.status), toolCallIds: toolCallRows.map((r) => r.id), model, provider: provider.name, mode: provider.mode, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costCents, redactionCount, refused: answer.refused, drafts: drafts.map((d) => ({ type: d.type, id: d.id })) },
  });
  await publish(ctx, 'ai.command', { threadId: thread.id, messageId: assistant.id, toolNames: tools.map((t) => t.tool), toolStatuses: tools.map((t) => t.status), model, costCents, drafts: drafts.map((d) => ({ type: d.type, id: d.id })) });

  const finalRows = await db.aiToolCall.findMany({ where: { id: { in: toolCallRows.map((r) => r.id) } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return { thread: threadDto(thread), userMessage: messageDto(userMessage), message: messageDto(assistant), toolCalls: finalRows.map(toolCallDto), drafts, budget: budgetDto(charged) };
}
