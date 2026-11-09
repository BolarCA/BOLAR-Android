// ai contracts (Days 61-74): assistant commands with scoped retrieval, tool-call records, audit and budgets.
// The assistant only summarises, drafts and flags; every draft lands in an existing approval queue (p300).
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery } from './common.js';

export const AI_CONTEXT_TYPES = ['lease', 'work_order', 'case', 'document', 'property'] as const;
export const AI_TOOL_STATUSES = ['ok', 'denied', 'error'] as const;
export const AI_TOOL_NAMES = [
  'summarize_lease', 'summarize_case', 'summarize_work_order', 'summarize_document', 'list_due_items', 'flag_anomalies',
  'draft_notice', 'draft_email', 'prepare_packet_outline', 'recommend_next_steps',
] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];

export const aiSource = z.object({ type: z.string(), id: z.string(), label: z.string() }).openapi('AiSource');
export const aiDraftRef = z.object({ type: z.literal('notice'), id: idSchema, status: z.string(), href: z.string(), label: z.string() }).openapi('AiDraftRef');

export const aiContext = z.object({ resourceType: z.enum(AI_CONTEXT_TYPES).optional(), resourceId: idSchema.optional() }).openapi('AiContext');

export const aiThread = z
  .object({ id: idSchema, title: z.string(), contextType: z.string().nullable(), contextId: z.string().nullable(), status: z.string(), createdBy: idSchema, createdAt: z.string(), updatedAt: z.string() })
  .openapi('AiThread');
export const aiThreadPage = pageOf(aiThread, 'AiThread');
export const aiThreadQuery = paginationQuery.extend({ contextType: z.enum(AI_CONTEXT_TYPES).optional(), contextId: idSchema.optional() });
export const createAiThread = z.object({ title: z.string().trim().min(1).max(120).optional(), context: aiContext.default({}) }).openapi('CreateAiThread');

export const aiMessage = z
  .object({
    id: idSchema, threadId: idSchema, role: z.enum(['user', 'assistant']), content: z.string(), sources: z.array(aiSource), model: z.string().nullable(),
    inputTokens: z.number().int().nullable(), outputTokens: z.number().int().nullable(), costCents: z.number().int().nullable(), redactionCount: z.number().int(), createdAt: z.string(),
  })
  .openapi('AiMessage');

export const aiToolCall = z
  .object({
    id: idSchema, threadId: idSchema, messageId: idSchema.nullable(), tool: z.string(), status: z.enum(AI_TOOL_STATUSES), inputHash: z.string(), outputHash: z.string().nullable(),
    inputSummary: z.record(z.string(), z.unknown()), sources: z.array(aiSource), draftRef: aiDraftRef.nullable(), error: z.string().nullable(), durationMs: z.number().int().nullable(), createdAt: z.string(),
  })
  .openapi('AiToolCall');
export const aiToolCallPage = pageOf(aiToolCall, 'AiToolCall');
export const aiToolCallQuery = paginationQuery.extend({ threadId: idSchema.optional(), status: z.enum(AI_TOOL_STATUSES).optional(), tool: z.enum(AI_TOOL_NAMES).optional() });

export const aiThreadDetail = aiThread.extend({ messages: z.array(aiMessage), toolCalls: z.array(aiToolCall) }).openapi('AiThreadDetail');

export const aiBudget = z
  .object({ monthlyLimitCents: z.number().int(), spentCents: z.number().int(), remainingCents: z.number().int(), commandCount: z.number().int(), period: z.string(), exhausted: z.boolean() })
  .openapi('AiBudget');
export const updateAiBudget = z.object({ monthlyLimitCents: z.number().int().min(0).max(100_000_000) }).openapi('UpdateAiBudget');

export const aiCommand = z
  .object({ threadId: idSchema.optional(), command: z.string().trim().min(1).max(4000), context: aiContext.default({}) })
  .openapi('AiCommand');
export const aiCommandResponse = z
  .object({ thread: aiThread, userMessage: aiMessage, message: aiMessage, toolCalls: z.array(aiToolCall), drafts: z.array(aiDraftRef), budget: aiBudget })
  .openapi('AiCommandResponse');

export const AI_AUDIT_ACTIONS = ['ai.command', 'ai.tool_denied', 'ai.budget_exceeded'] as const;
export const aiAuditRow = z
  .object({
    id: idSchema, createdAt: z.string(), actorId: idSchema.nullable(), action: z.string(), outcome: z.string(), requestId: z.string(), threadId: z.string().nullable(),
    tools: z.array(z.object({ tool: z.string(), status: z.string() })), model: z.string().nullable(), inputTokens: z.number().int().nullable(), outputTokens: z.number().int().nullable(),
    costCents: z.number().int().nullable(), redactionCount: z.number().int().nullable(), reason: z.string().nullable(),
  })
  .openapi('AiAuditRow');
export const aiAuditPage = pageOf(aiAuditRow, 'AiAuditRow');
export const aiAuditQuery = paginationQuery.extend({
  actorId: idSchema.optional(),
  tool: z.enum(AI_TOOL_NAMES).optional(),
  /** ok|denied|error filter tool-call outcomes; exceeded selects budget refusals. */
  status: z.enum(['ok', 'denied', 'error', 'exceeded']).optional(),
  action: z.enum(AI_AUDIT_ACTIONS).optional(),
});

export type AiSourceDto = z.infer<typeof aiSource>;
export type AiDraftRefDto = z.infer<typeof aiDraftRef>;
export type AiContextDto = z.infer<typeof aiContext>;
export type AiThreadDto = z.infer<typeof aiThread>;
export type AiThreadDetailDto = z.infer<typeof aiThreadDetail>;
export type AiMessageDto = z.infer<typeof aiMessage>;
export type AiToolCallDto = z.infer<typeof aiToolCall>;
export type AiBudgetDto = z.infer<typeof aiBudget>;
export type AiCommandDto = z.infer<typeof aiCommand>;
export type AiCommandResponseDto = z.infer<typeof aiCommandResponse>;
export type AiAuditRowDto = z.infer<typeof aiAuditRow>;
