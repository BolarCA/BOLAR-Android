import { z, idParams, invoiceDetail, invoicePage, invoiceQuery, createInvoice as createInvoiceSchema, generateInvoices as generateInvoicesSchema, generateInvoicesResponse, invoiceAging, markOverdueResponse } from '@bolar/contracts';
import { errors, toPage, decodeCursor } from '@bolar/shared';
import type { Prisma } from '@bolar/db';
import { defineRoute, type RouteDef } from '../../../shared/route.js';
import { tenantDb } from '../../../shared/db.js';
import { denyFinance, financeScope, invoiceScopeWhere, leaseInScope, requireFinanceStaff } from '../access.js';
import { aging, createInvoice, generateInvoices, invoiceDetailDto, invoiceDtos, invoiceInclude, issueInvoice, markOverdue, startOfToday, voidInvoice, type InvoiceRow } from './service.js';

/** Load an invoice the actor may see (staff: org; tenant/landlord: via lease/property scope). 404 otherwise. */
export async function loadInvoiceForActor(ctx: Parameters<typeof financeScope>[0], id: string): Promise<InvoiceRow> {
  const scope = await financeScope(ctx);
  const row = await tenantDb(ctx).invoice.findFirst({ where: { id }, include: invoiceInclude });
  if (!row || !leaseInScope(scope, { id: row.leaseId, propertyId: row.lease.propertyId })) await denyFinance(ctx, 'finance:read', { type: 'invoice', id });
  return row!;
}

export const invoiceRoutes: RouteDef[] = [
  defineRoute({ method: 'get', path: '/invoices', operationId: 'listInvoices', summary: 'List invoices (tenants/landlords see only their leases/properties)', tags: ['finance'], auth: 'session', permission: 'finance:read',
    request: { query: invoiceQuery }, responses: { 200: invoicePage },
    handler: async ({ query, ctx }) => {
      const scopeWhere = invoiceScopeWhere(await financeScope(ctx));
      if (!scopeWhere) return { body: { items: [], nextCursor: null } };
      const c = decodeCursor<{ id: string }>(query.cursor);
      const where: Prisma.InvoiceWhereInput = {
        ...scopeWhere,
        ...(query.status ? { status: query.status } : {}),
        ...(query.leaseId ? { leaseId: query.leaseId } : {}),
        ...(query.tenantProfileId ? { tenantProfileId: query.tenantProfileId } : {}),
        ...(query.q ? { number: { contains: query.q, mode: 'insensitive' } } : {}),
        ...(query.dueBefore || query.dueAfter ? { dueDate: { ...(query.dueAfter ? { gte: new Date(query.dueAfter) } : {}), ...(query.dueBefore ? { lte: new Date(query.dueBefore) } : {}) } } : {}),
        ...(query.overdue === 'true' ? { OR: [{ status: 'overdue' }, { status: { in: ['open', 'partially_paid'] }, dueDate: { lt: startOfToday() } }] } : {}),
      };
      const rows = await tenantDb(ctx).invoice.findMany({ where, include: invoiceInclude, take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: await invoiceDtos(page.items, ctx) } };
    } }),
  // Static paths before `/invoices/:id`.
  defineRoute({ method: 'get', path: '/invoices/aging', operationId: 'getInvoiceAging', summary: 'AR aging buckets by tenant', tags: ['finance'], auth: 'session', permission: 'finance:read',
    responses: { 200: invoiceAging },
    handler: async ({ ctx }) => {
      const scope = await financeScope(ctx);
      if (scope.kind !== 'org') await denyFinance(ctx, 'finance:read', null, 'aging is staff-only');
      return { body: await aging(ctx) };
    } }),
  defineRoute({ method: 'post', path: '/invoices/generate', operationId: 'generateInvoices', summary: 'Generate and issue rent invoices for a period from active leases (idempotent per lease+period)', tags: ['finance'], auth: 'mfa', permission: 'finance:write',
    request: { body: generateInvoicesSchema }, responses: { 200: generateInvoicesResponse },
    handler: async ({ body, ctx }) => {
      await requireFinanceStaff(ctx, 'finance:write');
      return { status: 200, body: await generateInvoices(ctx, body.period) };
    } }),
  defineRoute({ method: 'post', path: '/invoices/mark-overdue', operationId: 'markInvoicesOverdue', summary: 'Scan open invoices past due and mark them overdue', tags: ['finance'], auth: 'mfa', permission: 'finance:write',
    responses: { 200: markOverdueResponse },
    handler: async ({ ctx }) => {
      await requireFinanceStaff(ctx, 'finance:write');
      return { status: 200, body: await markOverdue(ctx) };
    } }),
  defineRoute({ method: 'get', path: '/invoices/:id', operationId: 'getInvoice', summary: 'Invoice with lines, payments, lease and tenant context', tags: ['finance'], auth: 'session', permission: 'finance:read',
    request: { params: idParams }, responses: { 200: invoiceDetail },
    handler: async ({ params, ctx }) => ({ body: await invoiceDetailDto(await loadInvoiceForActor(ctx, params.id), ctx) }) }),
  defineRoute({ method: 'post', path: '/invoices', operationId: 'createInvoice', summary: 'Create a manual draft invoice for a lease', tags: ['finance'], auth: 'mfa', permission: 'finance:write',
    request: { body: createInvoiceSchema }, responses: { 201: invoiceDetail },
    handler: async ({ body, ctx }) => {
      await requireFinanceStaff(ctx, 'finance:write');
      const row = await createInvoice(ctx, { leaseId: body.leaseId, dueDate: new Date(body.dueDate), periodStart: body.periodStart ? new Date(body.periodStart) : null, periodEnd: body.periodEnd ? new Date(body.periodEnd) : null, lines: body.lines });
      return { status: 201, body: await invoiceDetailDto(row, ctx) };
    } }),
  defineRoute({ method: 'post', path: '/invoices/:id/issue', operationId: 'issueInvoice', summary: 'Issue a draft invoice (posts AR / income)', tags: ['finance'], auth: 'mfa', permission: 'finance:write',
    request: { params: idParams }, responses: { 200: invoiceDetail },
    handler: async ({ params, ctx }) => {
      await requireFinanceStaff(ctx, 'finance:write');
      const inv = await tenantDb(ctx).invoice.findFirst({ where: { id: params.id }, include: invoiceInclude });
      if (!inv) throw errors.notFound();
      return { status: 200, body: await invoiceDetailDto(await issueInvoice(ctx, inv), ctx) };
    } }),
  defineRoute({ method: 'post', path: '/invoices/:id/void', operationId: 'voidInvoice', summary: 'Void an unpaid invoice (reverses the issue entry)', tags: ['finance'], auth: 'mfa', permission: 'finance:write',
    request: { params: idParams, body: z.object({ reason: z.string().trim().min(3).max(500) }).openapi('VoidInvoice') }, responses: { 200: invoiceDetail },
    handler: async ({ params, body, ctx }) => {
      await requireFinanceStaff(ctx, 'finance:write');
      const inv = await tenantDb(ctx).invoice.findFirst({ where: { id: params.id }, include: invoiceInclude });
      if (!inv) throw errors.notFound();
      return { status: 200, body: await invoiceDetailDto(await voidInvoice(ctx, inv, body.reason), ctx) };
    } }),
];
