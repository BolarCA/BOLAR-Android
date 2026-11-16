import type { WebhookEvent } from '../adapter.js';

/**
 * Webhook processing contract: verify signature -> persist WebhookEvent by (provider, externalId) ->
 * process once. The API module `integrations` implements the route; this helper standardises outcomes.
 */
export type WebhookOutcome = 'processed' | 'duplicate' | 'rejected_signature' | 'ignored';

/**
 * `new`: first delivery. `duplicate`: already processed successfully. `retry`: a previous delivery was recorded but
 * its handler failed, so this delivery runs the handler again (providers retry on non-2xx; without this the first
 * failure would make every retry a no-op and the event would be lost).
 */
export type RecordOutcome = 'new' | 'duplicate' | 'retry';

export interface WebhookStore {
  recordOnce(event: WebhookEvent): Promise<RecordOutcome | boolean>;
  markProcessed(event: WebhookEvent, error?: string): Promise<void>;
}

export async function processWebhook(event: WebhookEvent, store: WebhookStore, handler: (event: WebhookEvent) => Promise<'processed' | 'ignored'>): Promise<WebhookOutcome> {
  if (!event.signatureOk) return 'rejected_signature';
  const recorded = await store.recordOnce(event);
  const state: RecordOutcome = recorded === true ? 'new' : recorded === false ? 'duplicate' : recorded;
  if (state === 'duplicate') return 'duplicate';
  try {
    const result = await handler(event);
    await store.markProcessed(event);
    return result;
  } catch (err) {
    await store.markProcessed(event, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
