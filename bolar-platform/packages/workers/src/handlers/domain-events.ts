import type { DomainEvent } from '@bolar/shared';
import type { JobContext } from './index.js';
import { reactionsFor } from './registry.js';
// Module reaction files register themselves on import. Add one import line per module below.
import './reactions/index.js';

/** Fan-out for domain events published by the API (side effects that must not run in the request path). */
export async function domainEventsHandler(event: DomainEvent, ctx: JobContext): Promise<void> {
  const list = reactionsFor(event.name);
  ctx.logger.info({ name: event.name, tenantOrgId: event.tenantOrgId, requestId: event.requestId, reactions: list.length }, 'domain event');
  for (const r of list) await r(event, ctx);
}
