import type { DomainEvent } from '@bolar/shared';
import { onEvent } from '../registry.js';

interface LeaseTransitioned { leaseId: string; from: string; to: string; propertyId?: string; unitId?: string; note?: string | null }

/**
 * Lease reactions (Day 23/57). Notifications are owned by the notification module (it maps events to
 * templates), so this reaction only records the lifecycle movement for operators and future hooks.
 */
onEvent('lease.transitioned', async (event: DomainEvent, ctx) => {
  const p = event.payload as LeaseTransitioned;
  ctx.logger.info({ leaseId: p.leaseId, from: p.from, to: p.to, tenantOrgId: event.tenantOrgId, requestId: event.requestId }, p.to === 'sent' ? 'lease sent for signature' : 'lease transitioned');
});

onEvent('lease.signed', async (event: DomainEvent, ctx) => {
  const p = event.payload as { leaseId: string };
  ctx.logger.info({ leaseId: p.leaseId, tenantOrgId: event.tenantOrgId }, 'lease signed');
});
