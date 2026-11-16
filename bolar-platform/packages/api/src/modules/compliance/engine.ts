/**
 * Deterministic compliance rule engine (blueprint Day 41).
 * Pure: `evaluate(rules, facts)` never touches the database or the clock, so fixtures replay identically.
 * Condition DSL: group `{ all?: Cond[], any?: Cond[], not?: Cond }` or leaf `{ field, op, value? }`.
 * Result is the most severe action among the rules that hit: block > review > warn > allow.
 */
import { CONDITION_OPS, type ConditionOp, type RuleAction, type RuleSeverity, type RuleHitDto } from '@bolar/contracts';
import type { FieldError } from '@bolar/shared';

export type Facts = Record<string, unknown>;
export interface ConditionLeaf { field: string; op: ConditionOp; value?: unknown }
export interface ConditionGroup { all?: ConditionNode[]; any?: ConditionNode[]; not?: ConditionNode }
export type ConditionNode = ConditionLeaf | ConditionGroup;

/** Minimal rule shape the engine needs; Prisma rows satisfy it. */
export interface EngineRule {
  id?: string;
  key: string;
  version: number;
  jurisdiction: string;
  domain: string;
  title: string;
  description: string;
  severity: string;
  action: string;
  conditions: unknown;
  sourceUrl?: string | null;
}

export const ACTION_RANK: Record<RuleAction, number> = { allow: 0, warn: 1, review: 2, block: 3 };

export function mostSevere(actions: readonly string[]): RuleAction {
  let best: RuleAction = 'allow';
  for (const a of actions) if (isAction(a) && ACTION_RANK[a] > ACTION_RANK[best]) best = a;
  return best;
}
function isAction(a: string): a is RuleAction { return a in ACTION_RANK; }
function isSeverity(s: string): s is RuleSeverity { return ['low', 'medium', 'high', 'critical'].includes(s); }

export function isLeaf(node: ConditionNode): node is ConditionLeaf {
  return typeof (node as ConditionLeaf).field === 'string' && typeof (node as ConditionLeaf).op === 'string';
}

/** Structural validation for a condition tree; returns field errors (empty = valid). Used by rule create/new-version. */
export function validateConditions(input: unknown, path = 'conditions'): FieldError[] {
  const errs: FieldError[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [{ path, message: 'must be an object' }];
  const node = input as Record<string, unknown>;
  const isLeafLike = 'field' in node || 'op' in node;
  if (isLeafLike) {
    if (typeof node.field !== 'string' || !node.field) errs.push({ path: `${path}.field`, message: 'field is required' });
    if (typeof node.op !== 'string' || !(CONDITION_OPS as readonly string[]).includes(node.op)) errs.push({ path: `${path}.op`, message: `op must be one of ${CONDITION_OPS.join(', ')}` });
    const op = node.op as ConditionOp;
    if (['gt_field', 'lt_field'].includes(op) && typeof node.value !== 'string') errs.push({ path: `${path}.value`, message: 'value must name another fact' });
    if (['in', 'matches_any'].includes(op) && !Array.isArray(node.value)) errs.push({ path: `${path}.value`, message: 'value must be an array' });
    if (['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'].includes(op) && node.value === undefined) errs.push({ path: `${path}.value`, message: 'value is required' });
    return errs;
  }
  const keys = Object.keys(node).filter((k) => ['all', 'any', 'not'].includes(k));
  if (keys.length === 0) return [{ path, message: 'group needs all, any or not' }];
  for (const k of ['all', 'any'] as const) {
    if (node[k] === undefined) continue;
    if (!Array.isArray(node[k]) || (node[k] as unknown[]).length === 0) { errs.push({ path: `${path}.${k}`, message: 'must be a non-empty array' }); continue; }
    (node[k] as unknown[]).forEach((c, i) => errs.push(...validateConditions(c, `${path}.${k}[${i}]`)));
  }
  if (node.not !== undefined) errs.push(...validateConditions(node.not, `${path}.not`));
  return errs;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  if (v instanceof Date) return v.getTime();
  return null;
}
function compareNumbers(a: unknown, b: unknown, cmp: (x: number, y: number) => boolean): boolean {
  const x = toNumber(a), y = toNumber(b);
  if (x === null || y === null) return false;
  return cmp(x, y);
}
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const x = toNumber(a), y = toNumber(b);
  if (x !== null && y !== null) return x === y;
  return String(a).toLowerCase() === String(b).toLowerCase();
}
function escapeRegex(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** `matches_any`: each entry is a case-insensitive substring or, when written as /re/flags, a regular expression. */
export function matchTerms(text: unknown, terms: unknown): string[] {
  if (typeof text !== 'string' || !Array.isArray(terms)) return [];
  const haystack = text.toLowerCase();
  const matched: string[] = [];
  for (const t of terms) {
    if (typeof t !== 'string' || !t) continue;
    const re = /^\/(.+)\/([a-z]*)$/.exec(t);
    if (re) {
      try { if (new RegExp(re[1]!, re[2]!.includes('i') ? re[2]! : `${re[2]}i`).test(text)) matched.push(t); } catch { /* invalid regex in rule: ignore term */ }
      continue;
    }
    // word-ish boundary so "asian" does not match "caucasian"; fall back to substring for multi-word phrases.
    const needle = t.toLowerCase();
    const boundary = new RegExp(`(^|[^a-z0-9])${escapeRegex(needle)}([^a-z0-9]|$)`, 'i');
    if (boundary.test(haystack)) matched.push(t);
  }
  return matched;
}

export interface LeafOutcome { matched: boolean; description: string; factsUsed: string[]; matchedTerms?: string[] }

export function evaluateLeaf(leaf: ConditionLeaf, facts: Facts): LeafOutcome {
  const v = facts[leaf.field];
  const used = [leaf.field];
  const desc = (verdict: string) => `${leaf.field} ${leaf.op}${leaf.value !== undefined ? ` ${JSON.stringify(leaf.value)}` : ''} (${verdict})`;
  switch (leaf.op) {
    case 'is_null': { const m = v === null || v === undefined; return { matched: m, description: desc(`${leaf.field}=${JSON.stringify(v ?? null)}`), factsUsed: used }; }
    case 'not_null': { const m = v !== null && v !== undefined; return { matched: m, description: desc(`${leaf.field}=${JSON.stringify(v ?? null)}`), factsUsed: used }; }
    case 'eq': return { matched: looseEq(v, leaf.value), description: desc(`${leaf.field}=${JSON.stringify(v ?? null)}`), factsUsed: used };
    case 'neq': return { matched: v !== undefined && !looseEq(v, leaf.value), description: desc(`${leaf.field}=${JSON.stringify(v ?? null)}`), factsUsed: used };
    case 'gt': return { matched: compareNumbers(v, leaf.value, (x, y) => x > y), description: desc(`${leaf.field}=${JSON.stringify(v ?? null)}`), factsUsed: used };
    case 'gte': return { matched: compareNumbers(v, leaf.value, (x, y) => x >= y), description: desc(`${leaf.field}=${JSON.stringify(v ?? null)}`), factsUsed: used };
    case 'lt': return { matched: compareNumbers(v, leaf.value, (x, y) => x < y), description: desc(`${leaf.field}=${JSON.stringify(v ?? null)}`), factsUsed: used };
    case 'lte': return { matched: compareNumbers(v, leaf.value, (x, y) => x <= y), description: desc(`${leaf.field}=${JSON.stringify(v ?? null)}`), factsUsed: used };
    case 'in': return { matched: Array.isArray(leaf.value) && leaf.value.some((x) => looseEq(v, x)), description: desc(`${leaf.field}=${JSON.stringify(v ?? null)}`), factsUsed: used };
    case 'contains': {
      const m = typeof v === 'string' ? v.toLowerCase().includes(String(leaf.value).toLowerCase()) : Array.isArray(v) ? v.some((x) => looseEq(x, leaf.value)) : false;
      return { matched: m, description: desc(`${leaf.field}=${JSON.stringify(v ?? null)}`), factsUsed: used };
    }
    case 'gt_field':
    case 'lt_field': {
      const otherField = String(leaf.value);
      const other = facts[otherField];
      const m = leaf.op === 'gt_field' ? compareNumbers(v, other, (x, y) => x > y) : compareNumbers(v, other, (x, y) => x < y);
      return { matched: m, description: desc(`${leaf.field}=${JSON.stringify(v ?? null)}, ${otherField}=${JSON.stringify(other ?? null)}`), factsUsed: [leaf.field, otherField] };
    }
    case 'matches_any': {
      const terms = matchTerms(v, leaf.value);
      return { matched: terms.length > 0, description: `${leaf.field} matches_any (${terms.length ? `matched: ${terms.join(', ')}` : 'no match'})`, factsUsed: used, matchedTerms: terms };
    }
    default: return { matched: false, description: desc('unknown op'), factsUsed: used };
  }
}

export interface NodeOutcome { matched: boolean; matchedLeaves: LeafOutcome[]; factsUsed: Set<string> }

export function evaluateNode(node: ConditionNode, facts: Facts): NodeOutcome {
  if (isLeaf(node)) {
    const o = evaluateLeaf(node, facts);
    return { matched: o.matched, matchedLeaves: o.matched ? [o] : [], factsUsed: new Set(o.factsUsed) };
  }
  const leaves: LeafOutcome[] = [];
  const used = new Set<string>();
  const merge = (o: NodeOutcome) => { for (const l of o.matchedLeaves) leaves.push(l); for (const f of o.factsUsed) used.add(f); };
  let matched = true;
  let evaluatedSomething = false;
  if (node.all) {
    evaluatedSomething = true;
    const outs = node.all.map((c) => evaluateNode(c, facts));
    outs.forEach(merge);
    matched = matched && outs.every((o) => o.matched);
  }
  if (node.any) {
    evaluatedSomething = true;
    const outs = node.any.map((c) => evaluateNode(c, facts));
    outs.forEach(merge);
    matched = matched && outs.some((o) => o.matched);
  }
  if (node.not) {
    evaluatedSomething = true;
    const o = evaluateNode(node.not, facts);
    for (const f of o.factsUsed) used.add(f);
    matched = matched && !o.matched;
  }
  if (!evaluatedSomething) matched = false;
  return { matched, matchedLeaves: matched ? leaves : [], factsUsed: used };
}

export interface EvaluationOutput { result: RuleAction; hits: RuleHitDto[]; rulesConsidered: number }

/** Evaluate rules against facts. Rules with malformed conditions never hit (they are rejected at authoring time). */
export function evaluate(rules: readonly EngineRule[], facts: Facts): EvaluationOutput {
  const hits: RuleHitDto[] = [];
  for (const rule of rules) {
    if (validateConditions(rule.conditions).length) continue;
    const out = evaluateNode(rule.conditions as ConditionNode, facts);
    if (!out.matched) continue;
    const factsUsed: Facts = {};
    for (const f of out.factsUsed) factsUsed[f] = facts[f] === undefined ? null : facts[f];
    const matchedTerms = out.matchedLeaves.flatMap((l) => l.matchedTerms ?? []);
    hits.push({
      ruleId: rule.id,
      ruleKey: rule.key,
      ruleVersion: rule.version,
      severity: isSeverity(rule.severity) ? rule.severity : 'medium',
      action: isAction(rule.action) ? rule.action : 'warn',
      evidence: {
        conditionsMatched: out.matchedLeaves.map((l) => l.description),
        facts: factsUsed,
        ...(matchedTerms.length ? { matchedTerms } : {}),
        sourceUrl: rule.sourceUrl ?? null,
        title: rule.title,
        description: rule.description,
        jurisdiction: rule.jurisdiction,
        domain: rule.domain,
      },
    });
  }
  hits.sort((a, b) => ACTION_RANK[b.action] - ACTION_RANK[a.action] || a.ruleKey.localeCompare(b.ruleKey));
  return { result: mostSevere(hits.map((h) => h.action)), hits, rulesConsidered: rules.length };
}
