import { errors, type RequestContext } from '@bolar/shared';
import type { Prisma } from '@bolar/db';
import { prisma, tenantDb } from '../../../shared/db.js';
import { audit } from '../../../shared/audit.js';
import { publish } from '../../../shared/events.js';
import { toDto } from '../../../shared/route.js';
import { canSeeBankData } from '../access.js';
import { ACCOUNTS, postJournal, reverseJournal } from '../ledger/service.js';

/**
 * Invoices and rent schedules (Day 38). Status flow: draft -> open -> partially_paid -> paid; open/partially_paid -> overdue (scan);
 * open (no payments) -> void. Issue posts AR debit / income credit; void posts the mirrored reversal.
 */
export const PAYABLE_STATUSES = ['open', 'partially_paid', 'overdue'] as const;
export const OUTSTANDING_STATUSES = ['open', 'partially_paid', 'overdue'] as const;

export const invoiceInclude = {
  lines: { orderBy: { id: 'asc' as const } },
  payments: { orderBy: { createdAt: 'desc' as const } },
  lease: { select: { id: true, status: true, propertyId: true, unitId: true, startDate: true, endDate: true, rentCents: true, unit: { select: { unitNumber: true, property: { select: { name: true } } } } } },
} satisfies Prisma.InvoiceInclude;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

async function tenantNames(ids: (string | null)[]): Promise<Map<string, { displayName: string; status: string }>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const rows = await prisma.tenantProfile.findMany({ where: { id: { in: want } }, select: { id: true, displayName: true, status: true } });
  return new Map(rows.map((r) => [r.id, { displayName: r.displayName, status: r.status }]));
}

export function paymentDto(p: Prisma.PaymentGetPayload<object>, ctx: RequestContext, invoiceNumber: string | null = null) {
  const base = toDto({ id: p.id, invoiceId: p.invoiceId, provider: p.provider, method: p.method, status: p.status, amountCents: p.amountCents, externalId: p.externalId, failureReason: p.failureReason, receivedAt: p.receivedAt, createdAt: p.createdAt, updatedAt: p.updatedAt });
  return { ...base, invoiceNumber, externalId: canSeeBankData(ctx) ? base.externalId : null };
}

export async function invoiceDtos(rows: InvoiceRow[], ctx: RequestContext) {
  const names = await tenantNames(rows.map((r) => r.tenantProfileId));
  return rows.map((r) => invoiceDto(r, ctx, names.get(r.tenantProfileId ?? '') ?? null));
}

export function invoiceDto(r: InvoiceRow, ctx: RequestContext, tenant: { displayName: string; status: string } | null) {
  const base = toDto({ id: r.id, leaseId: r.leaseId, tenantProfileId: r.tenantProfileId, number: r.number, status: r.status, periodStart: r.periodStart, periodEnd: r.periodEnd, dueDate: r.dueDate, totalCents: r.totalCents, paidCents: r.paidCents, issuedAt: r.issuedAt, voidedAt: r.voidedAt, createdAt: r.createdAt, updatedAt: r.updatedAt });
  return { ...base, balanceCents: Math.max(0, r.totalCents - r.paidCents), tenantName: tenant?.displayName ?? null, propertyName: r.lease.unit.property.name, unitNumber: r.lease.unit.unitNumber };
}

export async function invoiceDetailDto(r: InvoiceRow, ctx: RequestContext) {
  const names = await tenantNames([r.tenantProfileId]);
  const tenant = names.get(r.tenantProfileId ?? '') ?? null;
  const journals = await prisma.journalEntry.findMany({ where: { tenantOrgId: r.tenantOrgId, OR: [{ sourceType: 'invoice', sourceId: r.id }, { sourceType: 'payment', sourceId: { in: r.payments.map((p) => p.id) } }] }, select: { id: true } });
  return {
    ...invoiceDto(r, ctx, tenant),
    lines: r.lines.map((l) => ({ id: l.id, description: l.description, accountCode: l.accountCode, amountCents: l.amountCents, chargeId: l.chargeId })),
    payments: r.payments.map((p) => paymentDto(p, ctx, r.number)),
    lease: { id: r.lease.id, status: r.lease.status, propertyId: r.lease.propertyId, unitId: r.lease.unitId, propertyName: r.lease.unit.property.name, unitNumber: r.lease.unit.unitNumber, startDate: r.lease.startDate.toISOString(), endDate: r.lease.endDate.toISOString(), rentCents: r.lease.rentCents },
    tenant: r.tenantProfileId && tenant ? { id: r.tenantProfileId, displayName: tenant.displayName, status: tenant.status } : null,
    journalEntryIds: journals.map((j) => j.id),
  };
}

/** `INV-<seq>` per org from a count-based sequence inside a transaction; the unique (org, number) index guards races. */
export async function nextInvoiceNumber(tx: Prisma.TransactionClient, tenantOrgId: string): Promise<string> {
  const count = await tx.invoice.count({ where: { tenantOrgId } });
  return `INV-${String(count).padStart(6, '0')}`;
}

async function primaryTenantProfileId(leaseId: string, tenantOrgId: string): Promise<string | null> {
  const parties = await prisma.leaseParty.findMany({ where: { tenantOrgId, leaseId }, orderBy: { id: 'asc' } });
  return (parties.find((p) => p.role === 'primary') ?? parties[0])?.tenantProfileId ?? null;
}

export interface CreateInvoiceInput { leaseId: string; dueDate: Date; periodStart?: Date | null; periodEnd?: Date | null; lines: { description: string; accountCode: string; amountCents: number; chargeId?: string | null }[] }

/** Create an invoice (draft unless `issue`), retrying the sequence on a numbering race. */
export async function createInvoice(ctx: RequestContext, input: CreateInvoiceInput, opts: { issue?: boolean; source?: 'manual' | 'generated' } = {}): Promise<InvoiceRow> {
  const tenantOrgId = ctx.tenantOrgId!;
  const lease = await tenantDb(ctx).lease.findFirst({ where: { id: input.leaseId }, select: { id: true, status: true } });
  if (!lease) throw errors.validation([{ path: 'body.leaseId', message: 'Unknown lease' }]);
  if (['canceled', 'draft'].includes(lease.status)) throw errors.conflict(`Cannot invoice a ${lease.status} lease`);
  if (!input.lines.length) throw errors.validation([{ path: 'body.lines', message: 'At least one line is required' }]);
  const codes = [...new Set(input.lines.map((l) => l.accountCode))];
  const known = await tenantDb(ctx).account.findMany({ where: { code: { in: codes } }, select: { code: true } });
  const missing = codes.filter((c) => !known.some((k) => k.code === c));
  if (missing.length) throw errors.validation([{ path: 'body.lines', message: `Unknown account code(s): ${missing.join(', ')}` }]);
  const totalCents = input.lines.reduce((s, l) => s + l.amountCents, 0);
  const tenantProfileId = await primaryTenantProfileId(lease.id, tenantOrgId);
  let row: InvoiceRow | null = null;
  for (let attempt = 0; attempt < 3 && !row; attempt++) {
    try {
      row = await prisma.$transaction(async (tx) => {
        const number = await nextInvoiceNumber(tx, tenantOrgId);
        return tx.invoice.create({
          data: {
            tenantOrgId, leaseId: lease.id, tenantProfileId, number, status: 'draft', periodStart: input.periodStart ?? null, periodEnd: input.periodEnd ?? null, dueDate: input.dueDate, totalCents,
            lines: { create: input.lines.map((l) => ({ tenantOrgId, description: l.description, accountCode: l.accountCode, amountCents: l.amountCents, chargeId: l.chargeId ?? null })) },
          },
          include: invoiceInclude,
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002' || attempt === 2) throw err;
    }
  }
  await audit(ctx, { action: 'invoice.create', resourceType: 'invoice', resourceId: row!.id, after: { number: row!.number, leaseId: lease.id, totalCents, source: opts.source ?? 'manual' } });
  return opts.issue ? issueInvoice(ctx, row!) : row!;
}

/** draft -> open: post AR debit / income credits (one credit per line) and publish invoice.issued. */
export async function issueInvoice(ctx: RequestContext, inv: InvoiceRow): Promise<InvoiceRow> {
  if (inv.status !== 'draft') throw errors.invalidTransition(inv.status, 'open');
  await postJournal(ctx, {
    sourceType: 'invoice', sourceId: inv.id, memo: `Invoice ${inv.number} issued`, idempotencyKey: `invoice:${inv.id}:issue`,
    lines: [
      { accountCode: ACCOUNTS.AR, debitCents: inv.totalCents, propertyId: inv.lease.propertyId, memo: inv.number },
      ...inv.lines.map((l) => ({ accountCode: l.accountCode, creditCents: l.amountCents, propertyId: inv.lease.propertyId, memo: l.description })),
    ],
  });
  const row = await tenantDb(ctx).invoice.update({ where: { id: inv.id }, data: { status: 'open', issuedAt: new Date() }, include: invoiceInclude });
  await audit(ctx, { action: 'invoice.issue', resourceType: 'invoice', resourceId: inv.id, before: { status: 'draft' }, after: { status: 'open', totalCents: inv.totalCents } });
  await publish(ctx, 'invoice.issued', { invoiceId: inv.id, number: inv.number, leaseId: inv.leaseId, tenantProfileId: inv.tenantProfileId, totalCents: inv.totalCents, dueDate: inv.dueDate.toISOString() });
  return row;
}

/** open/overdue with no payments -> void, reversing the issue entry. */
export async function voidInvoice(ctx: RequestContext, inv: InvoiceRow, reason: string): Promise<InvoiceRow> {
  if (!['open', 'overdue', 'draft'].includes(inv.status)) throw errors.invalidTransition(inv.status, 'void');
  if (inv.paidCents > 0 || inv.payments.some((p) => p.status === 'succeeded' || p.status === 'pending')) throw errors.conflict('Invoices with payments cannot be voided; refund first');
  if (inv.status !== 'draft') {
    const issue = await prisma.journalEntry.findFirst({ where: { tenantOrgId: inv.tenantOrgId, idempotencyKey: `invoice:${inv.id}:issue` }, select: { id: true } });
    if (issue) await reverseJournal(ctx, issue.id, `void ${inv.number}: ${reason}`);
  }
  const row = await tenantDb(ctx).invoice.update({ where: { id: inv.id }, data: { status: 'void', voidedAt: new Date() }, include: invoiceInclude });
  await audit(ctx, { action: 'invoice.void', resourceType: 'invoice', resourceId: inv.id, before: { status: inv.status }, after: { status: 'void', reason } });
  return row;
}

export function periodRange(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
  return { start, end };
}

/** Generate and issue one rent invoice per active/renewal lease with monthly charges for the period; idempotent per lease+period. */
export async function generateInvoices(ctx: RequestContext, period: string): Promise<{ period: string; created: number; skipped: number; invoiceIds: string[] }> {
  const { start, end } = periodRange(period);
  const db = tenantDb(ctx);
  const leases = await db.lease.findMany({ where: { status: { in: ['active', 'renewal'] }, startDate: { lte: end }, endDate: { gte: start } }, include: { charges: true }, orderBy: { id: 'asc' } });
  let created = 0, skipped = 0;
  const invoiceIds: string[] = [];
  for (const lease of leases) {
    const charges = lease.charges.filter((c) => c.cadence === 'monthly' && (!c.startsOn || c.startsOn <= end) && (!c.endsOn || c.endsOn >= start) && c.amountCents > 0);
    if (!charges.length) { skipped++; continue; }
    const existing = await db.invoice.findFirst({ where: { leaseId: lease.id, periodStart: start, status: { not: 'void' } }, select: { id: true } });
    if (existing) { skipped++; continue; }
    const label = start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const row = await createInvoice(ctx, {
      leaseId: lease.id, dueDate: start, periodStart: start, periodEnd: end,
      lines: charges.map((c) => ({ description: `${c.type === 'rent' ? 'Monthly rent' : c.type.charAt(0).toUpperCase() + c.type.slice(1)} - ${label}`, accountCode: c.accountCode ?? ACCOUNTS.RENT_INCOME, amountCents: c.amountCents, chargeId: c.id })),
    }, { issue: true, source: 'generated' });
    created++;
    invoiceIds.push(row.id);
  }
  await audit(ctx, { action: 'invoice.generate', resourceType: 'invoice', metadata: { period, created, skipped } });
  return { period, created, skipped, invoiceIds };
}

export function allocationStatus(totalCents: number, paidCents: number, dueDate: Date, now = new Date()): 'open' | 'partially_paid' | 'paid' | 'overdue' {
  if (paidCents >= totalCents) return 'paid';
  if (paidCents > 0) return 'partially_paid';
  return dueDate < startOfToday(now) ? 'overdue' : 'open';
}

export function startOfToday(now = new Date()): Date {
  const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d;
}

/** open & dueDate < today -> overdue (partially paid invoices stay partially_paid; the aging report shows them). */
export async function markOverdue(ctx: RequestContext): Promise<{ updated: number; asOf: string }> {
  const r = await tenantDb(ctx).invoice.updateMany({ where: { status: 'open', dueDate: { lt: startOfToday() } }, data: { status: 'overdue' } });
  if (r.count) await audit(ctx, { action: 'invoice.mark_overdue', resourceType: 'invoice', metadata: { updated: r.count } });
  return { updated: r.count, asOf: new Date().toISOString() };
}

type Buckets = { currentCents: number; d1to30Cents: number; d31to60Cents: number; d61to90Cents: number; d90PlusCents: number; totalCents: number };
const emptyBuckets = (): Buckets => ({ currentCents: 0, d1to30Cents: 0, d31to60Cents: 0, d61to90Cents: 0, d90PlusCents: 0, totalCents: 0 });

/** AR aging by tenant (current / 1-30 / 31-60 / 61-90 / 90+ days past due). */
export async function aging(ctx: RequestContext, where: Prisma.InvoiceWhereInput = {}) {
  const now = new Date();
  const rows = await tenantDb(ctx).invoice.findMany({ where: { ...where, status: { in: [...OUTSTANDING_STATUSES] } }, select: { tenantProfileId: true, totalCents: true, paidCents: true, dueDate: true } });
  const names = await tenantNames(rows.map((r) => r.tenantProfileId));
  const totals = emptyBuckets();
  const byTenant = new Map<string, Buckets & { tenantProfileId: string | null; displayName: string; invoiceCount: number }>();
  for (const r of rows) {
    const outstanding = Math.max(0, r.totalCents - r.paidCents);
    if (!outstanding) continue;
    const days = Math.floor((startOfToday(now).getTime() - startOfToday(r.dueDate).getTime()) / 86_400_000);
    const key = days <= 0 ? 'currentCents' : days <= 30 ? 'd1to30Cents' : days <= 60 ? 'd31to60Cents' : days <= 90 ? 'd61to90Cents' : 'd90PlusCents';
    const tKey = r.tenantProfileId ?? 'none';
    const t = byTenant.get(tKey) ?? { ...emptyBuckets(), tenantProfileId: r.tenantProfileId, displayName: names.get(r.tenantProfileId ?? '')?.displayName ?? 'Unassigned', invoiceCount: 0 };
    t[key] += outstanding; t.totalCents += outstanding; t.invoiceCount++;
    totals[key] += outstanding; totals.totalCents += outstanding;
    byTenant.set(tKey, t);
  }
  return { asOf: now.toISOString(), totals, byTenant: [...byTenant.values()].sort((a, b) => b.totalCents - a.totalCents) };
}
