import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@bolar/db';
import { asUser } from './helpers.js';
import { financeFixture } from './finance.fixture.js';
import { guardImmutable } from '../modules/finance/access.js';

/** Days 36-37: chart of accounts, balanced posting, idempotency, immutability, reversals, approval gate. */
describe('finance: chart of accounts and ledger posting engine', () => {
  let fx: Awaited<ReturnType<typeof financeFixture>>;
  beforeAll(async () => { fx = await financeFixture(); });

  it('seed-default is idempotent and reserves system accounts', async () => {
    const b = await asUser(fx.books.a);
    const first = await b.post('/accounts/seed-default');
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(15);
    const again = await b.post('/accounts/seed-default');
    expect(again.body).toMatchObject({ created: 0, existing: 15 });
    expect(await prisma.account.count({ where: { tenantOrgId: fx.a.id } })).toBe(15);
    const list = await b.get('/accounts?type=income');
    expect(list.status).toBe(200);
    expect(list.body.items.map((a: { code: string }) => a.code)).toEqual(['4000', '4100', '4200']);
    // reserved code, duplicate code, bad code
    expect((await b.post('/accounts').send({ code: '1000', name: 'Dup cash', type: 'asset' })).status).toBe(409);
    expect((await b.post('/accounts').send({ code: '12', name: 'Short', type: 'asset' })).status).toBe(400);
    const created = await b.post('/accounts').send({ code: '5500', name: 'Landscaping', type: 'expense' });
    expect(created.status).toBe(201);
    expect(created.body.isSystem).toBe(false);
    expect((await b.post('/accounts').send({ code: '5500', name: 'Again', type: 'expense' })).status).toBe(409);
    // system account: name only
    const ar = list.body.items.find((a: { code: string }) => a.code === '4000');
    expect((await b.patch(`/accounts/${ar.id}`).send({ type: 'expense' })).status).toBe(400);
    expect((await b.patch(`/accounts/${ar.id}`).send({ name: 'Rent Revenue' })).body.name).toBe('Rent Revenue');
    expect(await prisma.auditLog.count({ where: { tenantOrgId: fx.a.id, action: { in: ['account.seed_default', 'account.create', 'account.update'] } } })).toBe(3);
  });

  it('chart of accounts is tenant-isolated', async () => {
    const bB = await asUser(fx.books.b);
    const list = await bB.get('/accounts');
    expect(list.body.items.every((a: { code: string }) => a.code !== '5500')).toBe(true);
    const aAcct = await prisma.account.findFirstOrThrow({ where: { tenantOrgId: fx.a.id, code: '5500' } });
    expect((await bB.patch(`/accounts/${aAcct.id}`).send({ name: 'pwned' })).status).toBe(404);
  });

  it('posts a balanced opening balance, rejects unbalanced entries, and is idempotent by key', async () => {
    const b = await asUser(fx.books.a);
    const body = { sourceType: 'opening_balance', sourceId: 'open-2026', memo: 'Opening balances', idempotencyKey: 'open-2026-key', lines: [{ accountCode: '1000', debitCents: 500000 }, { accountCode: '3000', creditCents: 500000 }] };
    const first = await b.post('/journal-entries').send(body);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: 'posted', totalDebitCents: 500000, totalCreditCents: 500000 });
    expect(first.body.lines).toHaveLength(2);
    const replay = await b.post('/journal-entries').send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(await prisma.journalEntry.count({ where: { idempotencyKey: 'open-2026-key' } })).toBe(1);
    const unbalanced = await b.post('/journal-entries').send({ ...body, idempotencyKey: 'unbalanced-key', lines: [{ accountCode: '1000', debitCents: 100 }, { accountCode: '3000', creditCents: 90 }] });
    expect(unbalanced.status).toBe(400);
    expect(unbalanced.body.fieldErrors[0].message).toMatch(/unbalanced/);
    const bothSides = await b.post('/journal-entries').send({ ...body, idempotencyKey: 'both-sides-key', lines: [{ accountCode: '1000', debitCents: 100, creditCents: 100 }, { accountCode: '3000', creditCents: 0 }] });
    expect(bothSides.status).toBe(400);
    const unknown = await b.post('/journal-entries').send({ ...body, idempotencyKey: 'unknown-acct-key', lines: [{ accountCode: '9999', debitCents: 100 }, { accountCode: '3000', creditCents: 100 }] });
    expect(unknown.status).toBe(400);
    const tb = await b.get('/ledger/trial-balance');
    expect(tb.body.balanced).toBe(true);
    expect(tb.body.rows.find((r: { code: string }) => r.code === '1000').balanceCents).toBe(500000);
    expect(tb.body.rows.find((r: { code: string }) => r.code === '3000').balanceCents).toBe(500000);
    const proof = await b.get('/ledger/proof');
    expect(proof.body).toMatchObject({ balanced: true, unbalancedEntries: 0, postedEntries: 1 });
  });

  it('posted entries are immutable at the database and surface as 409 conflict', async () => {
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { idempotencyKey: 'open-2026-key' } });
    await expect(prisma.journalEntry.update({ where: { id: entry.id }, data: { memo: 'tampered' } })).rejects.toThrow(/immutable/);
    await expect(prisma.ledgerEntry.deleteMany({ where: { journalEntryId: entry.id } })).rejects.toThrow(/immutable/);
    await expect(prisma.journalEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/immutable/);
    await expect(guardImmutable(() => prisma.journalEntry.update({ where: { id: entry.id }, data: { memo: 'tampered' } }))).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect((await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } })).memo).toBe('Opening balances');
  });

  it('reversal mirrors the entry once; reversals cannot be reversed; ledger stays balanced', async () => {
    const b = await asUser(fx.books.a);
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { idempotencyKey: 'open-2026-key' } });
    const rev = await b.post(`/journal-entries/${entry.id}/reverse`).send({ reason: 'posted to wrong period' });
    expect(rev.status).toBe(201);
    expect(rev.body).toMatchObject({ sourceType: 'reversal', reversalOfId: entry.id, status: 'posted' });
    const cash = rev.body.lines.find((l: { accountCode: string }) => l.accountCode === '1000');
    expect(cash).toMatchObject({ debitCents: 0, creditCents: 500000 });
    expect((await b.post(`/journal-entries/${entry.id}/reverse`).send({ reason: 'again' })).status).toBe(409);
    expect((await b.post(`/journal-entries/${rev.body.id}/reverse`).send({ reason: 'undo undo' })).status).toBe(409);
    const tb = await b.get('/ledger/trial-balance');
    expect(tb.body.balanced).toBe(true);
    expect(tb.body.rows.find((r: { code: string }) => r.code === '1000').balanceCents).toBe(0);
    const list = await b.get('/journal-entries?sourceType=reversal');
    expect(list.body.items).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { action: 'ledger.reverse', resourceId: entry.id } })).toBe(1);
  });

  it('adjustments wait for a different approver with finance:approve_adjustment (p300 gate)', async () => {
    const b = await asUser(fx.books.a);
    const adj = await b.post('/journal-entries').send({ sourceType: 'adjustment', memo: 'Write off disputed late fee', lines: [{ accountCode: '4100', debitCents: 2500 }, { accountCode: '1100', creditCents: 2500 }] });
    expect(adj.status).toBe(201);
    expect(adj.body).toMatchObject({ status: 'pending', postedAt: null });
    // pending entries do not touch the trial balance
    const tbBefore = await b.get('/ledger/trial-balance');
    expect(tbBefore.body.rows.find((r: { code: string }) => r.code === '4100').debitCents).toBe(0);
    expect((await b.get('/ledger/proof')).body.pendingEntries).toBe(1);
    // bookkeeper lacks the approval permission
    expect((await b.post(`/journal-entries/${adj.body.id}/approve`)).status).toBe(403);
    // admin cannot approve their own request
    const admin = await asUser(fx.admins.a);
    const own = await admin.post('/journal-entries').send({ sourceType: 'adjustment', memo: 'Admin adjustment', lines: [{ accountCode: '4200', debitCents: 100 }, { accountCode: '1100', creditCents: 100 }] });
    expect((await admin.post(`/journal-entries/${own.body.id}/approve`)).status).toBe(409);
    // admin approves the bookkeeper's request
    const approved = await admin.post(`/journal-entries/${adj.body.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: 'posted', postedBy: fx.admins.a.id });
    expect((await admin.post(`/journal-entries/${adj.body.id}/approve`)).status).toBe(409);
    const tb = await admin.get('/ledger/trial-balance');
    expect(tb.body.rows.find((r: { code: string }) => r.code === '4100').debitCents).toBe(2500);
    expect(tb.body.balanced).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'ledger.adjustment.approve', resourceId: adj.body.id } })).toBe(1);
    const pending = await admin.get('/journal-entries?status=pending');
    expect(pending.body.items.map((e: { id: string }) => e.id)).toEqual([own.body.id]);
  });

  it('denies ledger views to tenants (finance:read without staff role) and writes an access.denied audit row', async () => {
    const t = await asUser(fx.tenants.a);
    expect((await t.get('/ledger/trial-balance')).status).toBe(403);
    expect((await t.get('/journal-entries')).status).toBe(403);
    expect((await t.get('/accounts')).status).toBe(403);
    const denied = await prisma.auditLog.findMany({ where: { tenantOrgId: fx.a.id, actorId: fx.tenants.a.id, action: 'access.denied', outcome: 'deny' } });
    expect(denied.length).toBeGreaterThanOrEqual(3);
    expect((denied[0]!.metadata as { permission: string }).permission).toBe('finance:read');
    // vendor has no finance permission at all
    const v = await asUser(fx.vendor);
    expect((await v.get('/invoices')).status).toBe(403);
  });

  it('journal entries and account drill-down are tenant-isolated', async () => {
    const bB = await asUser(fx.books.b);
    const entryA = await prisma.journalEntry.findFirstOrThrow({ where: { tenantOrgId: fx.a.id } });
    expect((await bB.get(`/journal-entries/${entryA.id}`)).status).toBe(404);
    expect((await bB.post(`/journal-entries/${entryA.id}/reverse`).send({ reason: 'cross tenant' })).status).toBe(404);
    expect((await bB.get('/journal-entries')).body.items).toHaveLength(0);
    const cashA = await prisma.account.findFirstOrThrow({ where: { tenantOrgId: fx.a.id, code: '1000' } });
    expect((await bB.get(`/ledger/accounts/${cashA.id}/entries`)).status).toBe(404);
    const bA = await asUser(fx.books.a);
    const entries = await bA.get(`/ledger/accounts/${cashA.id}/entries`);
    expect(entries.status).toBe(200);
    expect(entries.body.items).toHaveLength(2);
    expect(entries.body.items[0]).toMatchObject({ accountCode: '1000', sourceType: 'reversal' });
  });
});
