import { errors, systemContext, type RequestContext } from '@bolar/shared';
import { createBankLinkProvider, createPaymentProvider, type BankLinkProvider, type PaymentProvider } from '@bolar/integrations';
import type { Prisma } from '@bolar/db';
import { prisma, tenantDb } from '../../../shared/db.js';
import { audit } from '../../../shared/audit.js';
import { publish } from '../../../shared/events.js';
import { logger } from '../../../logger.js';
import { ACCOUNTS, postJournal, reverseJournal } from '../ledger/service.js';
import { allocationStatus, invoiceInclude, PAYABLE_STATUSES } from '../invoice/service.js';

/**
 * Payments (Day 39). Every payment goes through the PaymentProvider adapter (mock | sandbox | production; never a raw SDK),
 * is persisted with its provider events, and on success allocates to the invoice and posts Cash debit / AR credit.
 * Success/failure application is idempotent so the synchronous result and later webhooks converge on one journal entry.
 */
let paymentProvider: PaymentProvider | null = null;
let bankProvider: BankLinkProvider | null = null;
export function getPaymentProvider(): PaymentProvider { return (paymentProvider ??= createPaymentProvider()); }
export function getBankLinkProvider(): BankLinkProvider { return (bankProvider ??= createBankLinkProvider()); }
/** Tests may swap providers. */
export function setProvidersForTests(p: { payment?: PaymentProvider | null; bank?: BankLinkProvider | null }): void {
  if (p.payment !== undefined) paymentProvider = p.payment;
  if (p.bank !== undefined) bankProvider = p.bank;
}

export const paymentInclude = { invoice: { select: { id: true, number: true, status: true, totalCents: true, paidCents: true, leaseId: true, lease: { select: { propertyId: true } } } }, events: { orderBy: { createdAt: 'asc' as const } } } satisfies Prisma.PaymentInclude;
export type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export async function recordPaymentEvent(tenantOrgId: string, paymentId: string | null, provider: string, externalEventId: string, type: string, payload: unknown): Promise<boolean> {
  try {
    await prisma.paymentEvent.create({ data: { tenantOrgId, paymentId, provider, externalEventId, type, payload: (payload ?? {}) as object, processedAt: new Date() } });
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') return false;
    throw err;
  }
}

export interface CreatePaymentInput { invoiceId: string; amountCents: number; method: string; paymentMethodRef: string; idempotencyKey: string; actorKind: 'tenant' | 'staff' }

export async function createPayment(ctx: RequestContext, input: CreatePaymentInput): Promise<PaymentRow> {
  const tenantOrgId = ctx.tenantOrgId!;
  const db = tenantDb(ctx);
  const inv = await db.invoice.findFirst({ where: { id: input.invoiceId }, include: invoiceInclude });
  if (!inv) throw errors.notFound();
  if (!(PAYABLE_STATUSES as readonly string[]).includes(inv.status)) throw errors.conflict(`Invoice ${inv.number} is ${inv.status} and cannot accept payments`);
  const remaining = inv.totalCents - inv.paidCents;
  if (input.amountCents > remaining) throw errors.validation([{ path: 'body.amountCents', message: `Amount exceeds the remaining balance of ${remaining} cents` }]);
  const scopedKey = `${tenantOrgId}:${input.idempotencyKey}`;
  const existing = await db.payment.findFirst({ where: { idempotencyKey: scopedKey }, include: paymentInclude });
  if (existing) return existing;
  const provider = getPaymentProvider();
  const payment = await db.payment.create({ data: { tenantOrgId, invoiceId: inv.id, provider: provider.name, method: input.method, status: 'pending', amountCents: input.amountCents, idempotencyKey: scopedKey }, include: paymentInclude });
  await audit(ctx, { action: 'payment.create', resourceType: 'payment', resourceId: payment.id, after: { invoiceId: inv.id, amountCents: input.amountCents, method: input.method, provider: provider.name, actorKind: input.actorKind, paymentMethodRef: '[redacted]' } });
  const result = await provider.execute(
    { amountCents: input.amountCents, currency: 'usd', customerRef: inv.tenantProfileId ?? inv.leaseId, paymentMethodRef: input.paymentMethodRef, description: `Invoice ${inv.number}`, metadata: { invoiceId: inv.id, paymentId: payment.id, tenantOrgId } },
    { requestId: ctx.requestId, tenantOrgId, actorId: ctx.actor?.userId ?? null, idempotencyKey: input.idempotencyKey },
  );
  await db.payment.update({ where: { id: payment.id }, data: { externalId: result.externalId } });
  await recordPaymentEvent(tenantOrgId, payment.id, provider.name, `${result.externalId}:${result.status}`, `payment_intent.${result.status === 'failed' ? 'payment_failed' : result.status}`, { object: { id: result.externalId, amount: input.amountCents, status: result.status, failureReason: result.failureReason ?? null }, source: 'sync' });
  if (result.status === 'succeeded') await applyPaymentSuccess(ctx, payment.id);
  else if (result.status === 'failed') await applyPaymentFailure(ctx, payment.id, result.failureReason ?? 'declined');
  return (await db.payment.findFirst({ where: { id: payment.id }, include: paymentInclude }))!;
}

/** Idempotent: a payment already `succeeded` is left alone (one allocation, one journal entry). */
export async function applyPaymentSuccess(ctx: RequestContext, paymentId: string): Promise<'applied' | 'skipped'> {
  const db = tenantDb(ctx);
  const p = await db.payment.findFirst({ where: { id: paymentId }, include: paymentInclude });
  if (!p) throw errors.notFound();
  if (p.status === 'succeeded' || p.status === 'refunded') return 'skipped';
  const inv = await db.invoice.findFirst({ where: { id: p.invoiceId }, include: invoiceInclude });
  if (!inv) throw errors.notFound();
  const paidCents = inv.paidCents + p.amountCents;
  const status = allocationStatus(inv.totalCents, paidCents, inv.dueDate);
  await db.invoice.update({ where: { id: inv.id }, data: { paidCents, status: status === 'overdue' ? inv.status : status } });
  await db.payment.update({ where: { id: p.id }, data: { status: 'succeeded', receivedAt: new Date(), failureReason: null } });
  await postJournal(ctx, {
    sourceType: 'payment', sourceId: p.id, memo: `Payment ${p.id} on ${inv.number}`, idempotencyKey: `payment:${p.id}:succeeded`,
    lines: [{ accountCode: ACCOUNTS.CASH, debitCents: p.amountCents, propertyId: inv.lease.propertyId, memo: inv.number }, { accountCode: ACCOUNTS.AR, creditCents: p.amountCents, propertyId: inv.lease.propertyId, memo: inv.number }],
  });
  await audit(ctx, { action: 'payment.succeeded', resourceType: 'payment', resourceId: p.id, before: { invoiceStatus: inv.status, paidCents: inv.paidCents }, after: { invoiceStatus: status, paidCents, amountCents: p.amountCents } });
  await publish(ctx, 'payment.succeeded', { paymentId: p.id, invoiceId: inv.id, invoiceNumber: inv.number, leaseId: inv.leaseId, tenantProfileId: inv.tenantProfileId, amountCents: p.amountCents, invoiceStatus: status });
  return 'applied';
}

export async function applyPaymentFailure(ctx: RequestContext, paymentId: string, reason: string): Promise<'applied' | 'skipped'> {
  const db = tenantDb(ctx);
  const p = await db.payment.findFirst({ where: { id: paymentId }, include: paymentInclude });
  if (!p) throw errors.notFound();
  if (p.status !== 'pending') return 'skipped';
  await db.payment.update({ where: { id: p.id }, data: { status: 'failed', failureReason: reason } });
  await audit(ctx, { action: 'payment.failed', resourceType: 'payment', resourceId: p.id, outcome: 'error', after: { reason, amountCents: p.amountCents } });
  await publish(ctx, 'payment.failed', { paymentId: p.id, invoiceId: p.invoiceId, invoiceNumber: p.invoice.number, leaseId: p.invoice.leaseId, amountCents: p.amountCents, reason });
  return 'applied';
}

/** Refund (approval-gated): approver must differ from whoever recorded the payment; provider refund, reversal entry, invoice reopened. */
export async function refundPayment(ctx: RequestContext, paymentId: string, amountCents: number, reason: string): Promise<PaymentRow> {
  const db = tenantDb(ctx);
  const p = await db.payment.findFirst({ where: { id: paymentId }, include: paymentInclude });
  if (!p) throw errors.notFound();
  if (p.status !== 'succeeded') throw errors.invalidTransition(p.status, 'refunded');
  if (amountCents > p.amountCents) throw errors.validation([{ path: 'body.amountCents', message: 'Refund exceeds the payment amount' }]);
  const creator = await prisma.auditLog.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, action: 'payment.create', resourceId: p.id }, select: { actorId: true } });
  if (creator?.actorId && creator.actorId === ctx.actor!.userId) throw errors.conflict('Refund approver must differ from the user who recorded the payment');
  const provider = getPaymentProvider();
  const result = await provider.refund({ externalId: p.externalId ?? p.id, amountCents, reason }, { requestId: ctx.requestId, tenantOrgId: ctx.tenantOrgId, actorId: ctx.actor?.userId ?? null, idempotencyKey: `refund:${p.id}:${amountCents}` });
  await recordPaymentEvent(ctx.tenantOrgId!, p.id, provider.name, `${result.externalId}:${result.status}`, 'charge.refunded', { object: { id: result.externalId, payment_intent: p.externalId, amount: amountCents, status: result.status }, reason, source: 'sync' });
  if (result.status === 'failed') throw errors.conflict('Provider rejected the refund');
  const original = await prisma.journalEntry.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, idempotencyKey: `payment:${p.id}:succeeded` }, select: { id: true } });
  if (amountCents === p.amountCents && original) {
    await reverseJournal(ctx, original.id, `refund: ${reason}`);
  } else {
    await postJournal(ctx, {
      sourceType: 'reversal', sourceId: p.id, memo: `Partial refund of payment ${p.id}: ${reason}`, idempotencyKey: `payment:${p.id}:refund:${amountCents}:${result.externalId}`, reversalOfId: original?.id ?? null,
      lines: [{ accountCode: ACCOUNTS.AR, debitCents: amountCents, propertyId: p.invoice.lease.propertyId, memo: p.invoice.number }, { accountCode: ACCOUNTS.CASH, creditCents: amountCents, propertyId: p.invoice.lease.propertyId, memo: p.invoice.number }],
    });
  }
  const inv = await db.invoice.findFirst({ where: { id: p.invoiceId } });
  if (inv) {
    const paidCents = Math.max(0, inv.paidCents - amountCents);
    await db.invoice.update({ where: { id: inv.id }, data: { paidCents, status: inv.status === 'void' ? 'void' : allocationStatus(inv.totalCents, paidCents, inv.dueDate) } });
  }
  const row = await db.payment.update({ where: { id: p.id }, data: { status: 'refunded', failureReason: null }, include: paymentInclude });
  await audit(ctx, { action: 'payment.refund', resourceType: 'payment', resourceId: p.id, before: { status: 'succeeded' }, after: { status: 'refunded', amountCents, reason, approvedBy: ctx.actor!.userId } });
  return row;
}

/** Stripe-shaped webhook mapping. Finds the Payment by provider externalId and converges it; idempotent by status. */
export async function handlePaymentWebhook(event: { externalId: string; type: string; payload: unknown }): Promise<'processed' | 'ignored'> {
  const obj = (event.payload as { object?: { id?: string; payment_intent?: string; amount?: number; amount_refunded?: number; last_payment_error?: { message?: string } } } | null)?.object;
  const intentId = event.type === 'charge.refunded' ? obj?.payment_intent ?? obj?.id : obj?.id;
  if (!intentId) return 'ignored';
  const payment = await prisma.payment.findFirst({ where: { externalId: intentId }, include: paymentInclude });
  if (!payment) { logger.warn({ externalId: intentId, type: event.type }, 'webhook for unknown payment'); return 'ignored'; }
  const ctx = systemContext(payment.tenantOrgId, `wh_${event.externalId}`);
  await recordPaymentEvent(payment.tenantOrgId, payment.id, payment.provider, event.externalId, event.type, { ...(event.payload as object), source: 'webhook' });
  switch (event.type) {
    case 'payment_intent.succeeded': return (await applyPaymentSuccess(ctx, payment.id)) === 'applied' ? 'processed' : 'ignored';
    case 'payment_intent.payment_failed': return (await applyPaymentFailure(ctx, payment.id, obj?.last_payment_error?.message ?? 'payment_failed')) === 'applied' ? 'processed' : 'ignored';
    case 'charge.refunded': {
      // Provider-initiated refund (e.g. dispute): mirror it when we have not already refunded locally.
      if (payment.status !== 'succeeded') return 'ignored';
      const amount = obj?.amount_refunded ?? obj?.amount ?? payment.amountCents;
      const original = await prisma.journalEntry.findFirst({ where: { tenantOrgId: payment.tenantOrgId, idempotencyKey: `payment:${payment.id}:succeeded` }, select: { id: true } });
      if (amount >= payment.amountCents && original) await reverseJournal(ctx, original.id, `provider refund ${event.externalId}`);
      else await postJournal(ctx, { sourceType: 'reversal', sourceId: payment.id, memo: `Provider partial refund ${event.externalId}`, idempotencyKey: `payment:${payment.id}:refund:${event.externalId}`, reversalOfId: original?.id ?? null, lines: [{ accountCode: ACCOUNTS.AR, debitCents: amount, propertyId: payment.invoice.lease.propertyId }, { accountCode: ACCOUNTS.CASH, creditCents: amount, propertyId: payment.invoice.lease.propertyId }] });
      const inv = await prisma.invoice.findFirst({ where: { id: payment.invoiceId } });
      if (inv) { const paidCents = Math.max(0, inv.paidCents - amount); await prisma.invoice.update({ where: { id: inv.id }, data: { paidCents, status: inv.status === 'void' ? 'void' : allocationStatus(inv.totalCents, paidCents, inv.dueDate) } }); }
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'refunded' } });
      await audit(ctx, { action: 'payment.refund', resourceType: 'payment', resourceId: payment.id, after: { amountCents: amount, via: 'webhook', eventId: event.externalId } });
      return 'processed';
    }
    default: return 'ignored';
  }
}
