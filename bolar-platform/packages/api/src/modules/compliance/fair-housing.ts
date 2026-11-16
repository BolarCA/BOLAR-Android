/**
 * Fair housing and source-of-income guard (blueprint Day 44).
 * Flags protected-class language and voucher refusals by evaluating the two seeded guard rules against `{ text }`.
 * The guard never decides: hits route the text to human review with source-linked evidence.
 */
import type { ScreenTextResponseDto } from '@bolar/contracts';
import { evaluate, type EngineRule } from './engine.js';
import { GUARD_RULE_KEYS } from './starter-rules.js';
import { loadRulesByKeys } from './jurisdiction.js';

export type GuardResult = Omit<ScreenTextResponseDto, 'evaluationIds'> & { ruleHits: ReturnType<typeof evaluate>['hits'] };

/** Pure variant used by fixtures: pass the guard rules explicitly. */
export function screenTextWithRules(text: string, rules: readonly EngineRule[]): GuardResult {
  const { hits } = evaluate(rules, { text });
  return {
    flagged: hits.length > 0,
    hits: hits.flatMap((h) => (h.evidence.matchedTerms ?? ['(pattern)']).map((term) => ({ ruleKey: h.ruleKey, ruleVersion: h.ruleVersion, term, severity: h.severity, action: h.action, sourceUrl: h.evidence.sourceUrl }))),
    ruleHits: hits,
  };
}

/** Loads the active guard rules (highest version) and screens the text. */
export async function screenText(text: string): Promise<GuardResult> {
  const rules = await loadRulesByKeys(GUARD_RULE_KEYS);
  return screenTextWithRules(text, rules);
}
