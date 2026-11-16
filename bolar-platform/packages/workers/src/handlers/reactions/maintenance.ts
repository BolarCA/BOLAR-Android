import { onEvent } from '../registry.js';

interface SlaBreachedPayload { workOrderId: string; propertyId: string; priority: string; status: string; slaDueAt?: string; assignedVendorId: string | null }
interface TransitionedPayload { workOrderId: string; from: string; to: string; propertyId: string; requesterId: string; assignedVendorId: string | null }

/**
 * Maintenance reactions (Day 35). Notifications are owned by the docs-comms module and map events to
 * templates; here we only record the escalation so the runbook (docs/runbooks/maintenance-escalation.md)
 * has a log line to key off and nothing user-facing happens in the request path.
 */
onEvent('work_order.sla_breached', async (event, ctx) => {
  const p = event.payload as SlaBreachedPayload;
  const level = p.priority === 'emergency' ? 'error' : 'warn';
  ctx.logger[level](
    { workOrderId: p.workOrderId, tenantOrgId: event.tenantOrgId, propertyId: p.propertyId, priority: p.priority, status: p.status, slaDueAt: p.slaDueAt, assignedVendorId: p.assignedVendorId, requestId: event.requestId, escalation: p.priority === 'emergency' ? 'page_on_call_manager' : 'notify_property_manager' },
    'work order SLA breached: escalation required',
  );
});

onEvent('work_order.transitioned', async (event, ctx) => {
  const p = event.payload as TransitionedPayload;
  if (p.to === 'blocked' || p.to === 'reopened') {
    ctx.logger.warn({ workOrderId: p.workOrderId, tenantOrgId: event.tenantOrgId, from: p.from, to: p.to, requestId: event.requestId }, `work order ${p.to}: manager follow-up required`);
  }
});
