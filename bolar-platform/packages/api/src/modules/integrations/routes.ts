import { Router, text } from 'express';
import { z } from '@bolar/contracts';
import { defineRoute, mount, type RouteDef } from '../../shared/route.js';
import { dispatchWebhook, hasWebhookProvider } from './webhooks.js';
import { errors } from '@bolar/shared';

export { registerWebhookProvider, onWebhook, dispatchWebhook } from './webhooks.js';

/**
 * Generic inbound webhook endpoint (blueprint p299): raw body is kept for signature verification,
 * events are persisted once by (provider, externalId), bad signatures are rejected with 400.
 */
export const integrationsRoutes: RouteDef[] = [
  defineRoute({ method: 'post', path: '/webhooks/:provider', operationId: 'receiveWebhook', summary: 'Receive and idempotently process a provider webhook', tags: ['integrations'], auth: 'public',
    request: { params: z.object({ provider: z.string().min(1).max(32) }) },
    responses: { 200: z.object({ outcome: z.enum(['processed', 'duplicate', 'ignored']) }).openapi('WebhookOutcome') },
    handler: async ({ params, req }) => {
      if (!hasWebhookProvider(params.provider)) throw errors.notFound();
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
      const outcome = await dispatchWebhook(params.provider, req.headers as Record<string, string | string[] | undefined>, raw);
      if (outcome === 'rejected_signature') throw errors.validation([{ path: 'headers.signature', message: 'Invalid webhook signature' }]);
      return { status: 200, body: { outcome } };
    } }),
];

export const integrationsRouter: Router = Router();
// Raw body for signature verification: webhooks arrive before express.json() in app.ts (see rawWebhookBody).
integrationsRouter.use('/webhooks', text({ type: '*/*', limit: '1mb' }));
mount(integrationsRouter, integrationsRoutes);
