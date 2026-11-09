import type { WebhookEvent } from '@bolar/integrations';
import { processWebhook, type WebhookOutcome } from '@bolar/integrations';
import { prisma } from '../../shared/db.js';
import { logger } from '../../logger.js';

export type WebhookVerifier = (headers: Record<string, string | string[] | undefined>, rawBody: string) => Promise<WebhookEvent>;
export type WebhookHandler = (event: WebhookEvent) => Promise<'processed' | 'ignored'>;

const verifiers = new Map<string, WebhookVerifier>();
const handlers = new Map<string, WebhookHandler[]>();

/**
 * Provider modules register a verifier (signature check) and one or more handlers.
 * Example (finance): registerWebhookProvider('stripe', (h, b) => provider.verifyWebhook(h, b)); onWebhook('stripe', handlePaymentEvent)
 */
export function registerWebhookProvider(provider: string, verifier: WebhookVerifier): void {
  verifiers.set(provider, verifier);
}
export function onWebhook(provider: string, handler: WebhookHandler): void {
  handlers.set(provider, [...(handlers.get(provider) ?? []), handler]);
}
export function hasWebhookProvider(provider: string): boolean {
  return verifiers.has(provider);
}

/** Persists each (provider, externalId) once; duplicates are acknowledged but not re-processed. */
const store = {
  async recordOnce(event: WebhookEvent) {
    try {
      await prisma.webhookEvent.create({ data: { provider: event.provider, externalId: event.externalId, signatureOk: event.signatureOk, payload: (event.payload ?? {}) as object } });
      return true;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return false;
      throw err;
    }
  },
  async markProcessed(event: WebhookEvent, error?: string) {
    await prisma.webhookEvent.updateMany({ where: { provider: event.provider, externalId: event.externalId }, data: { processedAt: new Date(), error: error ?? null } });
  },
};

export async function dispatchWebhook(provider: string, headers: Record<string, string | string[] | undefined>, rawBody: string): Promise<WebhookOutcome> {
  const verify = verifiers.get(provider);
  if (!verify) return 'ignored';
  const event = await verify(headers, rawBody);
  const outcome = await processWebhook(event, store, async (ev) => {
    const list = handlers.get(provider) ?? [];
    let processed = false;
    for (const h of list) if ((await h(ev)) === 'processed') processed = true;
    return processed ? 'processed' : 'ignored';
  });
  logger.info({ provider, externalId: event.externalId, outcome }, 'webhook');
  return outcome;
}
