import { onEvent } from '../registry.js';

interface AiCommandPayload { threadId: string; messageId: string; toolNames: string[]; toolStatuses: string[]; model: string; costCents: number; drafts: { type: string; id: string }[] }

/**
 * AI reactions (Days 61-74). The API runs tool plans inline and writes the `ai.command` audit row itself; the worker only
 * logs the event so operations dashboards and the cost runbook have a stream to key off. Denied tools and drafts are
 * called out because they are what compliance reviews. A dedicated `ai-commands` queue is not needed for the MVP.
 */
onEvent('ai.command', async (event, ctx) => {
  const p = event.payload as AiCommandPayload;
  const denied = p.toolStatuses.filter((s) => s === 'denied').length;
  const level = denied > 0 ? 'warn' : 'info';
  ctx.logger[level](
    { tenantOrgId: event.tenantOrgId, requestId: event.requestId, threadId: p.threadId, messageId: p.messageId, tools: p.toolNames, statuses: p.toolStatuses, deniedTools: denied, model: p.model, costCents: p.costCents, drafts: p.drafts.length },
    denied > 0 ? 'ai command completed with denied tool calls' : 'ai command completed',
  );
});
