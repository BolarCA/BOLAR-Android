import { createAiProvider, type AiProvider } from '@bolar/integrations';

let current: AiProvider | null = null;

/** Process-wide provider resolved from ANTHROPIC_MODE (mock by default). Tests inject spies with setAiProviderForTests. */
export function aiProvider(): AiProvider {
  current ??= createAiProvider(process.env);
  return current;
}

export function setAiProviderForTests(provider: AiProvider | null): void {
  current = provider;
}
