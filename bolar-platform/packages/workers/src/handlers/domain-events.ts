import type { DomainEvent } from '@bolar/shared';
import type { JobContext } from './index.js';

/**
 * Fan-out for domain events published by the API. Side effects that must not run in the request
 * path (notifications, document processing, report refreshes) are dispatched from here.
 */
export async function domainEventsHandler(event: DomainEvent, ctx: JobContext): Promise<void> {
  ctx.logger.info({ name: event.name, tenantOrgId: event.tenantOrgId, requestId: event.requestId }, 'domain event');
  // Module-specific reactions register here as domains are implemented (Days 28+).
}
