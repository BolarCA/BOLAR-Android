import { AnthropicAiProvider } from './anthropic.js';
import { MockAiProvider } from './mock.js';
import { modeFromEnv } from '../adapter.js';
import type { AiProvider } from './types.js';

export * from './types.js';
export * from './pricing.js';
export { MockAiProvider, MOCK_COST_CENTS, MOCK_USAGE, CLARIFY_TEXT, planCalls, renderAnswer, renderFacts } from './mock.js';
export { AnthropicAiProvider, AI_SYSTEM_PROMPT, buildPlanParams, buildAnswerParams, renderOutcomeForModel, toAnthropicTools } from './anthropic.js';

/** ANTHROPIC_MODE=mock (default) -> deterministic mock; sandbox|production -> official SDK (production only under NODE_ENV=production). */
export function createAiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider {
  const mode = modeFromEnv('ANTHROPIC_MODE', env);
  if (mode === 'mock') return new MockAiProvider(env.AI_MODEL || undefined);
  return new AnthropicAiProvider(env);
}
