/**
 * Finance demo seed (Days 36-40). Posts the journal entries behind the invoices and payment created by
 * `seedDemo` so the demo ledger balances, and adds one failed mock payment for the exceptions lane.
 * Idempotent: journal entries are keyed by the same idempotency keys the API uses
 * (`invoice:<id>:issue`, `payment:<id>:succeeded`), so re-running the seed or later API calls never double-post.
 * Synthetic data only. Wired by the integrator after seedDemo(): `await seedFinanceDemo(org.id)`.
 */
import { prisma } from '../../src/client.js';

interface SeedLine { accountCode: string; debitCents?: number; creditCents?: number; propertyId?: string | null; memo?: string | null }

async function postSeedJournal(orgId: string, input: { idempotencyKey: string; sourceType: string; sourceId: string; memo: string; lines: SeedLine[]; postedAt?: Date }): Promise<boolean> {
  const existing = await prisma.journalEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true } });
  if (existing) return false;
  const debit = input.lines.reduce((s, l) => s + (l.debitCents ?? 0), 0);
  const credit = input.lines.reduce((s, l) => s + (l.creditCents ?? 0), 0);
  if (debit !== credit || debit === 0) throw new Error(`[seed:finance] unbalanced entry ${input.idempotencyKey}: ${debit} != ${credit}`);
  const accounts = await prisma.account.findMany({ where: { tenantOrgId: orgId, code: { in: input.lines.map((l) => l.accountCode) } }, select: { id: true, code: true } });
  const byCode = new Map(accounts.map((a) => [a.code, a.id]));
  for (const l of input.lines) if (!byCode.has(l.accountCode)) throw new Error(`[seed:finance] missing account ${l.accountCode}; run seedDemo first`);
  await prisma.journalEntry.create({
    data: {
      tenantOrgId: orgId, sourceType: input.sourceType, sourceId: input.sourceId, memo: input.memo, idempotencyKey: input.idempotencyKey, postedAt: input.postedAt ?? new Date(),
      lines: { create: input.lines.map((l) => ({ tenantOrgId: orgId, accountId: byCode.get(l.accountCode)!, propertyId: l.propertyId ?? null, debitCents: l.debitCents ?? 0, creditCents: l.creditCents ?? 0, memo: l.memo ?? null })) },
    },
  });
  return true;
}

export async function seedFinanceDemo(orgId: string): Promise<void> {
  const invoices = await prisma.invoice.findMany({ where: { tenantOrgId: orgId, status: { not: 'draft' } }, include: { lines: true, lease: { select: { propertyId: true } } } });
  let posted = 0;
  for (const inv of invoices) {
    if (inv.status === 'void') continue;
    const created = await postSeedJournal(orgId, {
      idempotencyKey: `invoice:${inv.id}:issue`, sourceType: 'invoice', sourceId: inv.id, memo: `Invoice ${inv.number} issued`, postedAt: inv.issuedAt ?? inv.createdAt,
      lines: [
        { accountCode: '1100', debitCents: inv.totalCents, propertyId: inv.lease.propertyId, memo: inv.number },
        ...inv.lines.map((l) => ({ accountCode: l.accountCode, creditCents: l.amountCents, propertyId: inv.lease.propertyId, memo: l.description })),
      ],
    });
    if (created) posted++;
  }
  const payments = await prisma.payment.findMany({ where: { tenantOrgId: orgId, status: 'succeeded' }, include: { invoice: { select: { number: true, lease: { select: { propertyId: true } } } } } });
  for (const p of payments) {
    const created = await postSeedJournal(orgId, {
      idempotencyKey: `payment:${p.id}:succeeded`, sourceType: 'payment', sourceId: p.id, memo: `Payment ${p.id} on ${p.invoice.number}`, postedAt: p.receivedAt ?? p.createdAt,
      lines: [
        { accountCode: '1000', debitCents: p.amountCents, propertyId: p.invoice.lease.propertyId, memo: p.invoice.number },
        { accountCode: '1100', creditCents: p.amountCents, propertyId: p.invoice.lease.propertyId, memo: p.invoice.number },
      ],
    });
    if (created) posted++;
    if (!(await prisma.paymentEvent.findUnique({ where: { provider_externalEventId: { provider: p.provider, externalEventId: `${p.externalId ?? p.id}:succeeded` } } }))) {
      await prisma.paymentEvent.create({ data: { tenantOrgId: orgId, paymentId: p.id, provider: p.provider, externalEventId: `${p.externalId ?? p.id}:succeeded`, type: 'payment_intent.succeeded', payload: { object: { id: p.externalId, amount: p.amountCents, status: 'succeeded' }, source: 'seed' }, processedAt: p.receivedAt ?? p.createdAt } });
    }
  }

  // One failed mock payment on the open invoice (card declined) so the exceptions lane has data. No allocation, no journal.
  const open = await prisma.invoice.findFirst({ where: { tenantOrgId: orgId, status: { in: ['open', 'overdue', 'partially_paid'] } }, orderBy: { dueDate: 'asc' } });
  if (open && !(await prisma.payment.findFirst({ where: { tenantOrgId: orgId, externalId: 'pi_mock_declined_000' } }))) {
    const failed = await prisma.payment.create({ data: { tenantOrgId: orgId, invoiceId: open.id, provider: 'mock', method: 'card', status: 'failed', amountCents: open.totalCents, externalId: 'pi_mock_declined_000', idempotencyKey: `${orgId}:seed-declined-000`, failureReason: 'card_declined' } });
    await prisma.paymentEvent.create({ data: { tenantOrgId: orgId, paymentId: failed.id, provider: 'mock', externalEventId: 'evt_mock_declined_000', type: 'payment_intent.payment_failed', payload: { object: { id: 'pi_mock_declined_000', amount: open.totalCents, status: 'failed', last_payment_error: { message: 'card_declined' } }, source: 'seed' }, processedAt: new Date() } });
  }
  console.info(`[seed:finance] org ${orgId}: ${posted} journal entries posted, ${invoices.length} invoices covered, ${payments.length} payments covered`);
}
