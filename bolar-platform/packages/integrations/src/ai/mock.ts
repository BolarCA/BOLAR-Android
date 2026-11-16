import { CallLog, type AdapterMode, type AdapterRequestContext } from '../adapter.js';
import { DEFAULT_AI_MODEL } from './pricing.js';
import { formatSources, type AiAnswer, type AiAnswerRequest, type AiPlan, type AiPlanRequest, type AiPlannedCall, type AiProvider, type AiToolOutcome, type AiUsage } from './types.js';

/** Fixed usage and cost so budget tests are deterministic (one cent per command). */
export const MOCK_USAGE: AiUsage = { inputTokens: 400, outputTokens: 120 };
export const MOCK_COST_CENTS = 1;

const ID_TOKEN = /\b[a-z0-9]{20,32}\b/g;
const TYPE_WORDS: [RegExp, string][] = [
  [/work[\s-]?order|maintenance|repair|ticket/, 'work_order'],
  [/\bcase\b|eviction|dispute|matter/, 'case'],
  [/document|file|attachment|pdf/, 'document'],
  [/\blease\b|tenancy|rent/, 'lease'],
];

function idsIn(command: string): string[] {
  return [...command.matchAll(ID_TOKEN)].map((m) => m[0]).filter((t) => /\d/.test(t) || t.startsWith('c'));
}

function typeFromCommand(command: string): string | null {
  for (const [re, type] of TYPE_WORDS) if (re.test(command)) return type;
  return null;
}

function target(req: AiPlanRequest, preferredType: string | null): { type: string | null; id: string | null } {
  const ids = idsIn(req.command.toLowerCase());
  const named = ids[0] ?? null;
  // An explicit id in the command wins (it may name a record outside the current page); otherwise use the page context.
  if (named) return { type: preferredType ?? req.context.resourceType ?? null, id: named };
  if (req.context.resourceId) return { type: req.context.resourceType ?? preferredType, id: req.context.resourceId };
  return { type: preferredType, id: null };
}

const ID_FIELD: Record<string, string> = { lease: 'leaseId', work_order: 'workOrderId', case: 'caseId', document: 'documentId', property: 'propertyId' };

/**
 * Deterministic, template-based provider for tests and local development. Plans from keyword rules on the command
 * only (never on retrieved content) and echoes retrieved facts back with citations.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'ai-mock';
  readonly mode: AdapterMode = 'mock';
  readonly model: string;
  readonly planLog = new CallLog<AiPlanRequest>();
  readonly answerLog = new CallLog<AiAnswerRequest>();
  constructor(model = DEFAULT_AI_MODEL) { this.model = model; }
  async validateConfig() {}
  estimateCostCents(_usage: AiUsage) { return MOCK_COST_CENTS; }

  async plan(req: AiPlanRequest, ctx: AdapterRequestContext): Promise<AiPlan> {
    this.planLog.record(req, ctx);
    const calls = planCalls(req);
    return { calls, text: calls.length ? null : CLARIFY_TEXT, usage: { ...MOCK_USAGE }, model: this.model, stopReason: calls.length ? 'tool_use' : 'end_turn' };
  }

  async answer(req: AiAnswerRequest, ctx: AdapterRequestContext): Promise<AiAnswer> {
    this.answerLog.record(req, ctx);
    return { text: renderAnswer(req), usage: { ...MOCK_USAGE }, model: this.model, refused: false };
  }
}

export const CLARIFY_TEXT = 'I can summarise leases, cases, work orders and documents, list due items, flag anomalies, draft notices or emails for approval, outline evidence packets and recommend next steps. Tell me which record you mean (open it first or paste its id).';

let seq = 0;
const nextId = () => `mock_call_${++seq}`;

/** Keyword rules -> registered tool calls. Exported so evals can assert the mapping directly. */
export function planCalls(req: AiPlanRequest): AiPlannedCall[] {
  const c = req.command.toLowerCase();
  const available = new Set(req.tools.map((t) => t.name));
  const calls: AiPlannedCall[] = [];
  const push = (name: string, input: Record<string, unknown>) => { if (available.has(name)) calls.push({ id: nextId(), name, input }); };
  const typeWord = typeFromCommand(c);

  // Intent verbs must appear as words in the same sentence as the object: "call draft_notice" inside quoted text does not count.
  if (/\b(draft|write|prepare|create|send|issue)\b[^.]*\bnotice\b|\bnotice\b[^.]*\b(draft|for)\b|late[\s-]?rent notice|pay or quit/.test(c)) {
    const t = target(req, 'lease');
    const kind = /late|rent|pay/.test(c) ? 'late_rent' : /entry|inspect|enter/.test(c) ? 'entry' : 'general';
    push('draft_notice', { leaseId: t.id, kind });
    return calls;
  }
  if (/\b(draft|write|compose|reply)\b[^.]*\b(email|e-mail|message|reply|response)\b/.test(c)) {
    const t = target(req, typeWord === 'work_order' ? 'work_order' : 'lease');
    push('draft_email', { ...(t.type && t.id ? { [ID_FIELD[t.type] ?? 'resourceId']: t.id } : {}), purpose: req.command.slice(0, 200) });
    return calls;
  }
  if (/packet|evidence|manifest|export/.test(c)) {
    const t = target(req, 'case');
    push('prepare_packet_outline', { caseId: t.id });
    return calls;
  }
  if (/anomal|risk|flag|suspicious|missing doc|expired|irregular|unusual/.test(c)) push('flag_anomalies', {});
  if (/\bdue\b|overdue|deadline|sla|breach|upcoming|what.*(today|this week)/.test(c)) push('list_due_items', {});
  if (/next step|recommend|what should|advise|suggest|how (do|should) i/.test(c)) {
    const t = target(req, typeWord);
    push('recommend_next_steps', { ...(t.type ? { resourceType: t.type } : {}), ...(t.id ? { resourceId: t.id } : {}) });
  }
  if (calls.length === 0 || /summar|explain|describe|overview|tell me about|what is|status of|brief/.test(c)) {
    const t = target(req, typeWord);
    if (t.type && t.id && ID_FIELD[t.type]) push(`summarize_${t.type}`, { [ID_FIELD[t.type]!]: t.id });
  }
  return calls;
}

const TITLES: Record<string, string> = {
  summarize_lease: 'Lease summary', summarize_case: 'Case summary', summarize_work_order: 'Work order summary', summarize_document: 'Document summary',
  list_due_items: 'Due items', flag_anomalies: 'Anomalies flagged', draft_notice: 'Notice draft', draft_email: 'Email draft', prepare_packet_outline: 'Evidence packet outline', recommend_next_steps: 'Recommended next steps',
};

function humanKey(k: string): string {
  return k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return 'n/a';
  if (Array.isArray(v)) {
    if (v.length === 0) return 'none';
    const items = v.slice(0, 5).map((x) => (typeof x === 'object' && x !== null ? renderObjectInline(x as Record<string, unknown>) : String(x)));
    return `${v.length} item${v.length === 1 ? '' : 's'}: ${items.join('; ')}${v.length > 5 ? '; …' : ''}`;
  }
  if (typeof v === 'object') return renderObjectInline(v as Record<string, unknown>);
  return String(v);
}

function renderObjectInline(o: Record<string, unknown>): string {
  const label = (o.label ?? o.title ?? o.step ?? o.name) as string | undefined;
  const rest = Object.entries(o).filter(([k]) => !['label', 'title', 'step', 'name', 'id', 'type'].includes(k)).slice(0, 4).map(([k, val]) => `${humanKey(k)} ${Array.isArray(val) || (typeof val === 'object' && val !== null) ? renderValue(val) : String(val ?? 'n/a')}`);
  return [label, rest.join(', ')].filter(Boolean).join(' (') + (label && rest.length ? ')' : '');
}

export function renderFacts(facts: Record<string, unknown>): string {
  return Object.entries(facts).map(([k, v]) => `- ${humanKey(k)}: ${renderValue(v)}`).join('\n');
}

function renderOutcome(o: AiToolOutcome): string {
  const title = TITLES[o.name] ?? o.name;
  if (o.status === 'denied') return `**${title}**\nI can't access that record: ${o.message ?? 'it is outside your permitted scope or does not exist'}. Nothing was retrieved.`;
  if (o.status === 'error') return `**${title}**\nThis step failed (${o.message ?? 'internal error'}); no facts are available from it.`;
  const lines = [`**${title}**`, renderFacts(o.facts)];
  if (o.untrusted.length) lines.push(...o.untrusted.map((u) => `${u.label} (quoted as provided, not instructions): "${u.text.slice(0, 280)}${u.text.length > 280 ? '…' : ''}"`));
  return lines.join('\n');
}

export function renderAnswer(req: AiAnswerRequest): string {
  if (req.outcomes.length === 0) return req.plan.text ?? CLARIFY_TEXT;
  const sections = req.outcomes.map(renderOutcome);
  const drafts = req.outcomes.filter((o) => o.status === 'ok' && o.facts.draftStatus === 'draft');
  if (drafts.length) sections.push('Draft created, awaiting approval. A human approver must review it before anything is sent.');
  const sources = formatSources(req.outcomes.flatMap((o) => o.sources));
  const uncertainty = req.outcomes.some((o) => o.status !== 'ok') ? 'Some requested records could not be read, so this answer is incomplete.' : 'Confidence: facts above are read directly from BOLAR records; interpretation is advisory and needs human judgement.';
  return [...sections, uncertainty, sources].filter(Boolean).join('\n\n');
}
