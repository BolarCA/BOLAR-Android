import { idParams, paymentDetail, paymentPage, paymentQuery, createPayment as createPaymentSchema, refundPayment as refundPaymentSchema, bankLinkTokenRequest, bankLinkToken, bankLinkExchangeRequest, bankLinkExchangeResult, financeSummary } from '@bolar/contracts';
import { toPage, decodeCursor } from '@bolar/shared';
import type { Prisma } from '@bolar/db';
import { defineRoute, type RouteDef } from '../../../shared/route.js';
import { prisma, tenantDb } from '../../../shared/db.js';
import { audit } from '../../../shared/audit.js';
import { canSeeBankData, denyFinance, financeScope, invoiceScopeWhere, leaseInScope, requireFinanceStaff } from '../access.js';
import { invoiceInclude, OUTSTANDING_STATUSES, paymentDto, startOfToday } from '../invoice/service.js';
import { ledgerProof } from '../ledger/service.js';
import { createPayment, getBankLinkProvider, getPaymentProvider, paymentInclude, refundPayment, type PaymentRow } from './service.js';

function detailDto(p: PaymentRow, ctx: Parameters<typeof paymentDto>[1]) {
  const bank = canSeeBankData(ctx);
  return {
    ...paymentDto(p, ctx, p.invoice.number),
    events: p.events.map((e) => ({ id: e.id, type: e.type, externalEventId: bank ? e.externalEventId : '[redacted]', processedAt: e.processedAt?.toISOString() ?? null, createdAt: e.createdAt.toISOString(), ...(bank ? { payload: e.payload } : {}) })),
    invoice: { id: p.invoice.id, number: p.invoice.number, status: p.invoice.status as 'draft' | 'open' | 'partially_paid' | 'paid' | 'void' | 'overdue', totalCents: p.invoice.totalCents, paidCents: p.invoice.paidCents },
  };
}

export const paymentRoutes: RouteDef[] = [
  defineRoute({ method: 'get', path: '/payments', operationId: 'listPayments', summary: 'List payments (scoped like invoices)', tags: ['finance'], auth: 'session', permission: 'payment:read',
    request: { query: paymentQuery }, responses: { 200: paymentPage },
    handler: async ({ query, ctx }) => {
      const scopeWhere = invoiceScopeWhere(await financeScope(ctx));
      if (!scopeWhere) return { body: { items: [], nextCursor: null } };
      const c = decodeCursor<{ id: string }>(query.cursor);
      const where: Prisma.PaymentWhereInput = { invoice: scopeWhere, ...(query.status ? { status: query.status } : {}), ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}), ...(query.method ? { method: query.method } : {}) };
      const rows = await tenantDb(ctx).payment.findMany({ where, include: paymentInclude, take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map((p) => paymentDto(p, ctx, p.invoice.number)) } };
    } }),
  defineRoute({ method: 'get', path: '/payments/:id', operationId: 'getPayment', summary: 'Payment with provider events (bank data only with bank:read)', tags: ['finance'], auth: 'session', permission: 'payment:read',
    request: { params: idParams }, responses: { 200: paymentDetail },
    handler: async ({ params, ctx }) => {
      const scope = await financeScope(ctx);
      const p = await tenantDb(ctx).payment.findFirst({ where: { id: params.id }, include: paymentInclude });
      if (!p || !leaseInScope(scope, { id: p.invoice.leaseId, propertyId: p.invoice.lease.propertyId })) await denyFinance(ctx, 'payment:read', { type: 'payment', id: params.id });
      return { body: detailDto(p!, ctx) };
    } }),
  defineRoute({ method: 'post', path: '/payments', operationId: 'createPayment', summary: 'Collect a payment on an invoice through the payment adapter (Idempotency-Key required)', tags: ['finance'], auth: 'mfa', permission: 'payment:read', idempotent: true,
    request: { body: createPaymentSchema }, responses: { 201: paymentDetail },
    handler: async ({ body, ctx, req }) => {
      const scope = await financeScope(ctx);
      const inv = await tenantDb(ctx).invoice.findFirst({ where: { id: body.invoiceId }, include: invoiceInclude });
      if (!inv) await denyFinance(ctx, 'payment:collect', { type: 'invoice', id: body.invoiceId }, 'unknown invoice');
      const isStaff = scope.kind === 'org' && ctx.permissions.has('finance:write');
      const isPayer = scope.kind === 'scoped' && ctx.permissions.has('payment:collect') && scope.leaseIds.includes(inv!.leaseId);
      if (!isStaff && !isPayer) await denyFinance(ctx, isStaff ? 'finance:write' : 'payment:collect', { type: 'invoice', id: body.invoiceId }, 'not a payer on this lease');
      const row = await createPayment(ctx, { ...body, idempotencyKey: req.header('idempotency-key')!, actorKind: isStaff ? 'staff' : 'tenant' });
      return { status: 201, body: detailDto(row, ctx) };
    } }),
  defineRoute({ method: 'post', path: '/payments/:id/refund', operationId: 'refundPayment', summary: 'Refund a succeeded payment (approval-gated; approver differs from recorder)', tags: ['finance'], auth: 'mfa', permission: 'finance:approve_adjustment',
    request: { params: idParams, body: refundPaymentSchema }, responses: { 200: paymentDetail },
    handler: async ({ params, body, ctx }) => {
      await requireFinanceStaff(ctx, 'finance:approve_adjustment');
      return { status: 200, body: detailDto(await refundPayment(ctx, params.id, body.amountCents, body.reason), ctx) };
    } }),

  // ---- Bank link (Plaid boundary). Tokens are never persisted in this phase; see docs/qa/finance-qa.md blockers. ----
  defineRoute({ method: 'post', path: '/bank-links/link-token', operationId: 'createBankLinkToken', summary: 'Create a bank-link token through the bank adapter', tags: ['finance'], auth: 'mfa', permission: 'bank:read',
    request: { body: bankLinkTokenRequest }, responses: { 201: bankLinkToken },
    handler: async ({ body, ctx }) => {
      await requireFinanceStaff(ctx, 'bank:read');
      const provider = getBankLinkProvider();
      const r = await provider.execute({ userRef: ctx.actor!.userId, products: body.products }, { requestId: ctx.requestId, tenantOrgId: ctx.tenantOrgId, actorId: ctx.actor!.userId });
      await audit(ctx, { action: 'bank_link.token', resourceType: 'bank_link', metadata: { provider: provider.name, mode: provider.mode, products: body.products } });
      return { status: 201, body: { linkToken: r.linkToken, expiresAt: r.expiresAt, mode: provider.mode } };
    } }),
  defineRoute({ method: 'post', path: '/bank-links/exchange', operationId: 'exchangeBankLink', summary: 'Exchange a public token; returns an opaque reference and mask only (no token persisted in MVP)', tags: ['finance'], auth: 'mfa', permission: 'bank:read',
    request: { body: bankLinkExchangeRequest }, responses: { 200: bankLinkExchangeResult },
    handler: async ({ body, ctx }) => {
      await requireFinanceStaff(ctx, 'bank:read');
      const provider = getBankLinkProvider();
      const r = await provider.exchange({ publicToken: body.publicToken }, { requestId: ctx.requestId, tenantOrgId: ctx.tenantOrgId, actorId: ctx.actor!.userId });
      await audit(ctx, { action: 'bank_link.exchange', resourceType: 'bank_link', metadata: { provider: provider.name, mode: provider.mode, accountMask: r.accountMask, institution: r.institution } });
      return { status: 200, body: { accessTokenRef: r.accessTokenRef, accountMask: r.accountMask, institution: r.institution, persisted: false as const, note: 'Bank tokens are not stored in this phase; persistence lands with the Plaid sandbox phase behind a vaulted reference.' } };
    } }),

  // ---- Dashboard summary (UI p53) ----
  defineRoute({ method: 'get', path: '/finance/summary', operationId: 'getFinanceSummary', summary: 'Bookkeeper dashboard KPIs: open AR, overdue, collected this month, exceptions, trial balance status', tags: ['finance'], auth: 'session', permission: 'finance:read',
    responses: { 200: financeSummary },
    handler: async ({ ctx }) => {
      await requireFinanceStaff(ctx);
      const tenantOrgId = ctx.tenantOrgId!;
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const [outstanding, collected, failed, pendingAdjustments, proof] = await Promise.all([
        prisma.invoice.findMany({ where: { tenantOrgId, status: { in: [...OUTSTANDING_STATUSES] } }, select: { totalCents: true, paidCents: true, dueDate: true, status: true } }),
        prisma.payment.aggregate({ where: { tenantOrgId, status: { in: ['succeeded', 'refunded'] }, receivedAt: { gte: monthStart } }, _sum: { amountCents: true } }),
        prisma.payment.count({ where: { tenantOrgId, status: 'failed', createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } } }),
        prisma.journalEntry.count({ where: { tenantOrgId, postedAt: null } }),
        ledgerProof(ctx),
      ]);
      const today = startOfToday(now);
      const overdue = outstanding.filter((i) => i.status === 'overdue' || i.dueDate < today);
      const sum = (rows: { totalCents: number; paidCents: number }[]) => rows.reduce((s, r) => s + Math.max(0, r.totalCents - r.paidCents), 0);
      return {
        body: {
          asOf: now.toISOString(), openArCents: sum(outstanding), openInvoices: outstanding.length, overdueCents: sum(overdue), overdueInvoices: overdue.length,
          collectedThisMonthCents: collected._sum.amountCents ?? 0, failedPayments30d: failed, pendingAdjustments, trialBalanced: proof.balanced, unbalancedEntries: proof.unbalancedEntries, paymentsMode: getPaymentProvider().mode,
        },
      };
    } }),
];
