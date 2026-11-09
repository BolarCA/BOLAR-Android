import { errors, type RequestContext } from '@bolar/shared';
import type { Prisma } from '@bolar/db';
import { prisma, tenantDb } from '../../../shared/db.js';
import { audit } from '../../../shared/audit.js';
import { toDto } from '../../../shared/route.js';
import { guardImmutable } from '../access.js';

/**
 * Ledger posting engine (Day 37). Double-entry invariants (p20):
 *  - every journal entry balances: sum(debit) == sum(credit) > 0;
 *  - posting is idempotent by `idempotencyKey` (the existing entry is returned);
 *  - posted entries are immutable (DB trigger); corrections are mirrored reversals.
 */
export interface JournalLineInput { accountCode: string; debitCents?: number; creditCents?: number; propertyId?: string | null; memo?: string | null }
export interface PostJournalInput {
  sourceType: 'invoice' | 'payment' | 'adjustment' | 'reversal' | 'opening_balance';
  sourceId: string;
  memo?: string | null;
  idempotencyKey: string;
  lines: JournalLineInput[];
  /** When false the entry is created pending (postedAt null) for a second approver (adjustments). */
  post?: boolean;
  reversalOfId?: string | null;
}

const entryInclude = { lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { id: 'asc' as const } } } satisfies Prisma.JournalEntryInclude;
type EntryRow = Prisma.JournalEntryGetPayload<{ include: typeof entryInclude }>;

export function journalDto(row: EntryRow) {
  const lines = row.lines.map((l) => ({ id: l.id, journalEntryId: l.journalEntryId, accountId: l.accountId, accountCode: l.account.code, accountName: l.account.name, propertyId: l.propertyId, debitCents: l.debitCents, creditCents: l.creditCents, memo: l.memo }));
  return {
    ...toDto({ id: row.id, sourceType: row.sourceType, sourceId: row.sourceId, memo: row.memo, idempotencyKey: row.idempotencyKey, reversalOfId: row.reversalOfId, postedBy: row.postedBy, postedAt: row.postedAt, createdAt: row.createdAt }),
    status: row.postedAt ? ('posted' as const) : ('pending' as const),
    totalDebitCents: lines.reduce((s, l) => s + l.debitCents, 0),
    totalCreditCents: lines.reduce((s, l) => s + l.creditCents, 0),
    lines,
  };
}

export function assertBalanced(lines: JournalLineInput[]): { debit: number; credit: number } {
  if (lines.length < 2) throw errors.validation([{ path: 'body.lines', message: 'A journal entry needs at least two lines' }]);
  let debit = 0, credit = 0;
  lines.forEach((l, i) => {
    const d = l.debitCents ?? 0, c = l.creditCents ?? 0;
    if (!Number.isInteger(d) || !Number.isInteger(c) || d < 0 || c < 0) throw errors.validation([{ path: `body.lines.${i}`, message: 'Amounts must be non-negative integer cents' }]);
    if ((d > 0 && c > 0) || (d === 0 && c === 0)) throw errors.validation([{ path: `body.lines.${i}`, message: 'Each line is either a debit or a credit' }]);
    debit += d; credit += c;
  });
  if (debit !== credit) throw errors.validation([{ path: 'body.lines', message: `Entry is unbalanced: debits ${debit} != credits ${credit}` }]);
  if (debit === 0) throw errors.validation([{ path: 'body.lines', message: 'Entry total must be greater than zero' }]);
  return { debit, credit };
}

async function resolveAccounts(ctx: RequestContext, codes: string[]): Promise<Map<string, { id: string }>> {
  const rows = await tenantDb(ctx).account.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
  const map = new Map(rows.map((r) => [r.code, { id: r.id }]));
  const missing = codes.filter((c) => !map.has(c));
  if (missing.length) throw errors.validation([{ path: 'body.lines', message: `Unknown account code(s): ${missing.join(', ')}. Seed the chart of accounts first.` }]);
  return map;
}

export async function findJournalByKey(ctx: RequestContext, idempotencyKey: string): Promise<EntryRow | null> {
  return tenantDb(ctx).journalEntry.findFirst({ where: { idempotencyKey }, include: entryInclude });
}

/** Create a balanced journal entry (posted or pending) in one statement; idempotent on the key. */
export async function postJournal(ctx: RequestContext, input: PostJournalInput): Promise<{ entry: ReturnType<typeof journalDto>; created: boolean }> {
  if (!ctx.tenantOrgId) throw errors.forbidden('Tenant context required');
  const existing = await findJournalByKey(ctx, input.idempotencyKey);
  if (existing) return { entry: journalDto(existing), created: false };
  assertBalanced(input.lines);
  const accounts = await resolveAccounts(ctx, [...new Set(input.lines.map((l) => l.accountCode))]);
  const post = input.post !== false;
  const tenantOrgId = ctx.tenantOrgId;
  let row: EntryRow;
  try {
    row = await tenantDb(ctx).journalEntry.create({
      data: {
        tenantOrgId, sourceType: input.sourceType, sourceId: input.sourceId, memo: input.memo ?? null, idempotencyKey: input.idempotencyKey, reversalOfId: input.reversalOfId ?? null,
        postedBy: ctx.actor?.userId ?? null, postedAt: post ? new Date() : null,
        lines: { create: input.lines.map((l) => ({ tenantOrgId, accountId: accounts.get(l.accountCode)!.id, propertyId: l.propertyId ?? null, debitCents: l.debitCents ?? 0, creditCents: l.creditCents ?? 0, memo: l.memo ?? null })) },
      },
      include: entryInclude,
    });
  } catch (err) {
    // Concurrent post with the same key: return the winner.
    if ((err as { code?: string }).code === 'P2002') {
      const winner = await findJournalByKey(ctx, input.idempotencyKey);
      if (winner) return { entry: journalDto(winner), created: false };
    }
    throw err;
  }
  await audit(ctx, { action: post ? 'ledger.post' : 'ledger.adjustment.request', resourceType: 'journal_entry', resourceId: row.id, after: { sourceType: row.sourceType, sourceId: row.sourceId, idempotencyKey: row.idempotencyKey, lines: input.lines, posted: post } });
  return { entry: journalDto(row), created: true };
}

/** Approve a pending adjustment: a different user with finance:approve_adjustment posts it (p300 approval gate). */
export async function approveJournal(ctx: RequestContext, id: string) {
  const db = tenantDb(ctx);
  const row = await db.journalEntry.findFirst({ where: { id }, include: entryInclude });
  if (!row) throw errors.notFound();
  if (row.postedAt) throw errors.conflict('Entry is already posted');
  if (row.postedBy && row.postedBy === ctx.actor!.userId) throw errors.conflict('Approver must differ from the requester');
  const posted = await guardImmutable(() => db.journalEntry.update({ where: { id: row.id }, data: { postedAt: new Date(), postedBy: ctx.actor!.userId }, include: entryInclude }));
  await audit(ctx, { action: 'ledger.adjustment.approve', resourceType: 'journal_entry', resourceId: row.id, before: { requestedBy: row.postedBy, status: 'pending' }, after: { approvedBy: ctx.actor!.userId, status: 'posted' } });
  return journalDto(posted);
}

/** Mirrored reversal of a posted entry; an entry can be reversed once and reversals cannot be reversed. */
export async function reverseJournal(ctx: RequestContext, journalEntryId: string, reason: string) {
  const db = tenantDb(ctx);
  const original = await db.journalEntry.findFirst({ where: { id: journalEntryId }, include: entryInclude });
  if (!original) throw errors.notFound();
  if (!original.postedAt) throw errors.conflict('Only posted entries can be reversed');
  if (original.sourceType === 'reversal') throw errors.conflict('A reversal cannot be reversed; post a new entry instead');
  const already = await db.journalEntry.findFirst({ where: { reversalOfId: original.id }, select: { id: true } });
  if (already) throw errors.conflict('Entry has already been reversed');
  const { entry, created } = await postJournal(ctx, {
    sourceType: 'reversal', sourceId: original.id, memo: `Reversal of ${original.sourceType} ${original.sourceId}: ${reason}`, idempotencyKey: `reversal:${original.id}`, reversalOfId: original.id,
    lines: original.lines.map((l) => ({ accountCode: l.account.code, debitCents: l.creditCents, creditCents: l.debitCents, propertyId: l.propertyId, memo: l.memo })),
  });
  if (created) await audit(ctx, { action: 'ledger.reverse', resourceType: 'journal_entry', resourceId: original.id, after: { reversalId: entry.id, reason } });
  return entry;
}

export async function getJournal(ctx: RequestContext, id: string) {
  const row = await tenantDb(ctx).journalEntry.findFirst({ where: { id }, include: entryInclude });
  if (!row) throw errors.notFound();
  return journalDto(row);
}

const DEBIT_NORMAL = new Set(['asset', 'expense']);

/** Trial balance over posted entries: per account debit/credit/balance (normal-balance signed) and the balanced flag. */
export async function trialBalance(ctx: RequestContext) {
  const tenantOrgId = ctx.tenantOrgId!;
  const sums = await prisma.ledgerEntry.groupBy({ by: ['accountId'], where: { tenantOrgId, journalEntry: { postedAt: { not: null } } }, _sum: { debitCents: true, creditCents: true } });
  const accounts = await prisma.account.findMany({ where: { tenantOrgId }, orderBy: { code: 'asc' } });
  const byId = new Map(sums.map((s) => [s.accountId, s._sum]));
  const rows = accounts.map((a) => {
    const s = byId.get(a.id);
    const debit = s?.debitCents ?? 0, credit = s?.creditCents ?? 0;
    return { accountId: a.id, code: a.code, name: a.name, type: a.type as 'asset' | 'liability' | 'equity' | 'income' | 'expense', debitCents: debit, creditCents: credit, balanceCents: DEBIT_NORMAL.has(a.type) ? debit - credit : credit - debit };
  });
  const totalDebitCents = rows.reduce((s, r) => s + r.debitCents, 0);
  const totalCreditCents = rows.reduce((s, r) => s + r.creditCents, 0);
  return { rows, totalDebitCents, totalCreditCents, balanced: totalDebitCents === totalCreditCents, asOf: new Date().toISOString() };
}

/** Double-entry proof: total debits == total credits and no posted entry is individually unbalanced. */
export async function ledgerProof(ctx: RequestContext) {
  const tenantOrgId = ctx.tenantOrgId!;
  const totals = await prisma.ledgerEntry.aggregate({ where: { tenantOrgId, journalEntry: { postedAt: { not: null } } }, _sum: { debitCents: true, creditCents: true } });
  const perEntry = await prisma.ledgerEntry.groupBy({ by: ['journalEntryId'], where: { tenantOrgId, journalEntry: { postedAt: { not: null } } }, _sum: { debitCents: true, creditCents: true } });
  const unbalancedEntries = perEntry.filter((e) => (e._sum.debitCents ?? 0) !== (e._sum.creditCents ?? 0)).length;
  const [postedEntries, pendingEntries] = await Promise.all([
    prisma.journalEntry.count({ where: { tenantOrgId, postedAt: { not: null } } }),
    prisma.journalEntry.count({ where: { tenantOrgId, postedAt: null } }),
  ]);
  const totalDebitCents = totals._sum.debitCents ?? 0, totalCreditCents = totals._sum.creditCents ?? 0;
  return { totalDebitCents, totalCreditCents, balanced: totalDebitCents === totalCreditCents && unbalancedEntries === 0, postedEntries, unbalancedEntries, pendingEntries, checkedAt: new Date().toISOString() };
}

/** Idempotent default chart (Day 36). System accounts are reserved: code/type immutable, name editable. */
export const DEFAULT_CHART: { code: string; name: string; type: string; isSystem: boolean }[] = [
  { code: '1000', name: 'Operating Cash', type: 'asset', isSystem: true },
  { code: '1100', name: 'Accounts Receivable', type: 'asset', isSystem: true },
  { code: '1200', name: 'Security Deposits Held (Trust)', type: 'asset', isSystem: true },
  { code: '2000', name: 'Accounts Payable', type: 'liability', isSystem: true },
  { code: '2100', name: 'Tenant Deposits Liability', type: 'liability', isSystem: true },
  { code: '2200', name: 'Prepaid Rent', type: 'liability', isSystem: true },
  { code: '3000', name: 'Owner Equity', type: 'equity', isSystem: true },
  { code: '4000', name: 'Rental Income', type: 'income', isSystem: true },
  { code: '4100', name: 'Late Fee Income', type: 'income', isSystem: false },
  { code: '4200', name: 'Other Income', type: 'income', isSystem: false },
  { code: '5000', name: 'Repairs and Maintenance', type: 'expense', isSystem: false },
  { code: '5100', name: 'Utilities', type: 'expense', isSystem: false },
  { code: '5200', name: 'Management Fees', type: 'expense', isSystem: false },
  { code: '5300', name: 'Insurance', type: 'expense', isSystem: false },
  { code: '5400', name: 'Property Taxes', type: 'expense', isSystem: false },
];
export const SYSTEM_ACCOUNT_CODES = new Set(DEFAULT_CHART.filter((a) => a.isSystem).map((a) => a.code));
export const ACCOUNTS = { CASH: '1000', AR: '1100', DEPOSITS_HELD: '1200', AP: '2000', DEPOSIT_LIABILITY: '2100', PREPAID_RENT: '2200', EQUITY: '3000', RENT_INCOME: '4000', LATE_FEE: '4100', OTHER_INCOME: '4200' } as const;

export async function seedDefaultChart(ctx: RequestContext) {
  const db = tenantDb(ctx);
  const existing = await db.account.findMany({ where: { code: { in: DEFAULT_CHART.map((a) => a.code) } }, select: { code: true } });
  const have = new Set(existing.map((e) => e.code));
  const toCreate = DEFAULT_CHART.filter((a) => !have.has(a.code));
  if (toCreate.length) await db.account.createMany({ data: toCreate.map((a) => ({ ...a, tenantOrgId: ctx.tenantOrgId! })) });
  const accounts = await db.account.findMany({ where: { code: { in: DEFAULT_CHART.map((a) => a.code) } }, orderBy: { code: 'asc' } });
  if (toCreate.length) await audit(ctx, { action: 'account.seed_default', resourceType: 'account', after: { created: toCreate.map((a) => a.code) } });
  return { created: toCreate.length, existing: have.size, accounts: toDto(accounts) };
}
