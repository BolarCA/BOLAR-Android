import { onEvent } from '../registry.js';

/**
 * Finance reactions (Day 39). Payment events are persisted by the API; here we only log the outcome for
 * reconciliation dashboards. Notifications are handled by the docs-comms module from the same events.
 */
onEvent('payment.succeeded', async (event, ctx) => {
  const p = event.payload as { paymentId: string; invoiceId: string; invoiceNumber?: string; amountCents: number; invoiceStatus?: string };
  ctx.logger.info({ tenantOrgId: event.tenantOrgId, paymentId: p.paymentId, invoiceId: p.invoiceId, invoiceNumber: p.invoiceNumber, amountCents: p.amountCents, invoiceStatus: p.invoiceStatus, requestId: event.requestId }, 'finance: payment succeeded and allocated');
});

onEvent('payment.failed', async (event, ctx) => {
  const p = event.payload as { paymentId: string; invoiceId: string; amountCents: number; reason: string };
  ctx.logger.warn({ tenantOrgId: event.tenantOrgId, paymentId: p.paymentId, invoiceId: p.invoiceId, amountCents: p.amountCents, reason: p.reason, requestId: event.requestId }, 'finance: payment failed (exception queue)');
});

onEvent('invoice.issued', async (event, ctx) => {
  const p = event.payload as { invoiceId: string; number: string; totalCents: number; dueDate: string };
  ctx.logger.info({ tenantOrgId: event.tenantOrgId, invoiceId: p.invoiceId, number: p.number, totalCents: p.totalCents, dueDate: p.dueDate, requestId: event.requestId }, 'finance: invoice issued');
});
