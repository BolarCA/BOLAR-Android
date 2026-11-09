import type { AiUsage } from './types.js';

/** List prices in USD per million tokens (Anthropic first-party API, cached 2026-10). Unknown models fall back to the default tier. */
export const MODEL_PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export const DEFAULT_AI_MODEL = 'claude-fable-5-1';
export const CHEAPER_AI_MODEL = 'claude-sonnet-5-5';

/** Integer cents, rounded up so the budget is never under-charged. */
export function estimateCostCents(model: string, usage: AiUsage): number {
  const price = MODEL_PRICING_USD_PER_MTOK[model] ?? MODEL_PRICING_USD_PER_MTOK[DEFAULT_AI_MODEL]!;
  const usd = (usage.inputTokens / 1_000_000) * price.input + (usage.outputTokens / 1_000_000) * price.output;
  return Math.ceil(usd * 100);
}
