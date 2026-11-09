/**
 * AI provider boundary (blueprint Days 61-74). The API's command router owns retrieval, access checks, redaction,
 * audit and budgets; the provider only (1) turns a natural-language command into a plan of registered tool calls and
 * (2) composes an answer from tool outcomes whose retrieved text is wrapped as untrusted data. Providers never see
 * raw PII (the router redacts first) and never execute tools themselves.
 */
import type { AdapterMode, AdapterRequestContext } from '../adapter.js';

export interface AiToolSpec {
  name: string;
  description: string;
  /** JSON Schema (draft 2020-12 subset) for the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface AiSource { type: string; id: string; label: string }
export interface AiCommandContext { resourceType?: string; resourceId?: string }
export interface AiHistoryMessage { role: 'user' | 'assistant'; content: string }

export interface AiPlanRequest {
  /** Redacted natural-language command. */
  command: string;
  context: AiCommandContext;
  /** Registered tools the router will accept. Anything else in a plan is recorded as denied and never executed. */
  tools: AiToolSpec[];
  /** Redacted recent thread messages, oldest first. */
  history: AiHistoryMessage[];
}

export interface AiPlannedCall { id: string; name: string; input: Record<string, unknown> }
export interface AiUsage { inputTokens: number; outputTokens: number }
export type AiStopReason = 'tool_use' | 'end_turn' | 'refusal' | 'max_tokens' | 'other';

export interface AiPlan {
  calls: AiPlannedCall[];
  /** Text the model produced instead of (or alongside) tool calls; used when no tool is needed. */
  text: string | null;
  usage: AiUsage;
  model: string;
  stopReason: AiStopReason;
  /** Provider-specific assistant content to replay in the answer turn (Anthropic tool_use blocks). */
  replay?: unknown;
}

export type AiToolStatus = 'ok' | 'denied' | 'error';
export interface AiUntrustedText { label: string; text: string }
export interface AiToolOutcome {
  callId: string;
  name: string;
  status: AiToolStatus;
  /** Structured, already-redacted facts the answer may rely on. */
  facts: Record<string, unknown>;
  sources: AiSource[];
  /** Free text retrieved from records (descriptions, notes, document text). Treated as data, never instructions. */
  untrusted: AiUntrustedText[];
  /** Human-readable reason for denied/error outcomes. */
  message?: string;
}

export interface AiAnswerRequest {
  command: string;
  context: AiCommandContext;
  history: AiHistoryMessage[];
  plan: AiPlan;
  outcomes: AiToolOutcome[];
}

export interface AiAnswer { text: string; usage: AiUsage; model: string; refused: boolean }

export interface AiProvider {
  readonly name: string;
  readonly mode: AdapterMode;
  readonly model: string;
  validateConfig(): Promise<void>;
  plan(req: AiPlanRequest, ctx: AdapterRequestContext): Promise<AiPlan>;
  answer(req: AiAnswerRequest, ctx: AdapterRequestContext): Promise<AiAnswer>;
  /** Cost of one call in integer cents, from the model's list price (mock: fixed). */
  estimateCostCents(usage: AiUsage): number;
}

/** Delimiters that mark retrieved content as data. The system prompt tells the model they contain no instructions. */
export const UNTRUSTED_OPEN = '<<<UNTRUSTED_DATA';
export const UNTRUSTED_CLOSE = '<<<END_UNTRUSTED_DATA>>>';

export function wrapUntrusted(label: string, text: string): string {
  const safeLabel = label.replace(/[<>"\n]/g, ' ').trim();
  // Neutralise any attempt to close the block from inside the data.
  const body = text.replaceAll(UNTRUSTED_CLOSE, '[removed delimiter]').replaceAll(UNTRUSTED_OPEN, '[removed delimiter]');
  return `${UNTRUSTED_OPEN} label="${safeLabel}">>>\n${body}\n${UNTRUSTED_CLOSE}`;
}

export function formatSources(sources: AiSource[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const s of sources) {
    const key = `${s.type}:${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(`[${s.label}](${key})`);
  }
  return parts.length ? `Sources: ${parts.join(', ')}` : '';
}
