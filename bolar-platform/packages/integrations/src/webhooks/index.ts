import type { WebhookEvent } from '../adapter.js';

/**
 * Webhook processing contract: verify signature -> persist WebhookEvent by (provider, externalId) ->
 * process once. The API module `integrations` implements the route; this helper standardises outcomes.
 */
export type WebhookOutcome = 'processed' | 'duplicate' | 'rejected_signature' | 'ignored';

export interface WebhookStore {
  /** Returns true if the event was newly recorded, false if already seen (idempotent replay). */
  recordOnce(event: WebhookEvent): Promise<boolean>;
  markProcessed(event: WebhookEvent, error?: string): Promise<void>;
}

export async function processWebhook(event: WebhookEvent, store: WebhookStore, handler: (event: WebhookEvent) => Promise<'processed' | 'ignored'>): Promise<WebhookOutcome> {
  if (!event.signatureOk) return 'rejected_signature';
  const fresh = await store.recordOnce(event);
  if (!fresh) return 'duplicate';
  try {
    const result = await handler(event);
    await store.markProcessed(event);
    return result;
  } catch (err) {
    await store.markProcessed(event, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
