import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@bolar/db';
import { drainMemoryQueue } from '../shared/queue.js';
import { asUser } from './helpers.js';
import { financeFixture, monthStart, periodOf, activeLease } from './finance.fixture.js';
import { createUser } from '@bolar/testing';

/** Day 38: rent invoice generation from leases, lease dependencies, manual invoices, void, aging, scoped visibility. */
describe('finance: invoices and rent schedules', () => {
  let fx: Awaited<ReturnType<typeof financeFixture>>;
  const period = periodOf(monthStart(1));
  beforeAll(async () => {
    fx = await financeFixture();
    const b = await asUser(fx.books.a);
    await b.post('/accounts/seed-default');
    drainMemoryQueue();
  });

  it('generates one issued invoice per active lease for the period and is idempotent per lease+period', async () => {
    const b = await asUser(fx.books.a);
    // lease dependencies: a terminated lease and a lease without charges are skipped / excluded
    const otherTenant = await createUser(fx.a, 'tenant', 'other@alpha.test');
    await activeLease(fx.a, fx.propA.id, otherTenant.id, '102', 99000, 'terminated');
    const noCharges = await activeLease(fx.a, fx.propA.id, otherTenant.id, '103', 88000);
    await prisma.recurringCharge.deleteMany({ where: { leaseId: noCharges.lease.id } });

    const first = await b.post('/invoices/generate').send({ period });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ period, created: 1, skipped: 1 });
    const invId = first.body.invoiceIds[0];
    const inv = await b.get(`/invoices/${invId}`);
    expect(inv.status).toBe(200);
    expect(inv.body).toMatchObject({ status: 'open', totalCents: 150000, paidCents: 0, balanceCents: 150000, leaseId: fx.leaseA.lease.id, tenantProfileId: fx.leaseA.profile.id, number: 'INV-000000' });
    expect(inv.body.lines[0]).toMatchObject({ accountCode: '4000', amountCents: 150000, chargeId: expect.any(String) });
    expect(inv.body.lease).toMatchObject({ propertyName: 'Shared Name Tower', unitNumber: '101' });
    expect(inv.body.tenant.displayName).toMatch(/Tenant 101/);
    expect(inv.body.journalEntryIds).toHaveLength(1);
    expect(new Date(inv.body.dueDate).toISOString()).toBe(monthStart(1).toISOString());
    // journal: AR debit / rental income credit
    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { idempotencyKey: `invoice:${invId}:issue` }, include: { lines: { include: { account: true } } } });
    expect(je.lines.find((l) => l.account.code === '1100')?.debitCents).toBe(150000);
    expect(je.lines.find((l) => l.account.code === '4000')?.creditCents).toBe(150000);
    expect(drainMemoryQueue('domain-events').some((j) => j.data.name === 'invoice.issued')).toBe(true);

    const again = await b.post('/invoices/generate').send({ period });
    expect(again.body).toMatchObject({ created: 0, skipped: 2 });
    expect(await prisma.invoice.count({ where: { tenantOrgId: fx.a.id } })).toBe(1);
    expect((await b.post('/invoices/generate').send({ period: '2026-13' })).status).toBe(400);
    // the period after the lease ends produces nothing
    expect((await b.post('/invoices/generate').send({ period: periodOf(monthStart(8)) })).body.created).toBe(0);
  });

  it('generation is tenant-isolated and numbers are per org', async () => {
    const bB = await asUser(fx.books.b);
    const res = await bB.post('/invoices/generate').send({ period });
    expect(res.body).toMatchObject({ created: 1, skipped: 0 });
    const invB = await prisma.invoice.findFirstOrThrow({ where: { tenantOrgId: fx.b.id } });
    expect(invB.number).toBe('INV-000000');
    expect(invB.totalCents).toBe(120000);
    const bA = await asUser(fx.books.a);
    expect((await bA.get(`/invoices/${invB.id}`)).status).toBe(404);
    expect((await bA.get('/invoices')).body.items.every((i: { leaseId: string }) => i.leaseId === fx.leaseA.lease.id)).toBe(true);
  });

  it('manual invoice: draft -> issue -> void reverses the journal; invalid transitions are 409', async () => {
    const b = await asUser(fx.books.a);
    const due = new Date(Date.now() - 45 * 86_400_000).toISOString();
    const draft = await b.post('/invoices').send({ leaseId: fx.leaseA.lease.id, dueDate: due, lines: [{ description: 'Late fee', accountCode: '4100', amountCents: 5000 }, { description: 'Parking', amountCents: 7500 }] });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ status: 'draft', totalCents: 12500, number: 'INV-000001' });
    expect(draft.body.lines[1].accountCode).toBe('4000');
    expect((await b.post(`/invoices/${draft.body.id}/void`).send({ reason: 'never mind' })).status).toBe(200);
    expect(await prisma.journalEntry.count({ where: { sourceId: draft.body.id } })).toBe(0);

    const d2 = await b.post('/invoices').send({ leaseId: fx.leaseA.lease.id, dueDate: due, lines: [{ description: 'Late fee', accountCode: '4100', amountCents: 5000 }] });
    expect((await b.post(`/invoices/${d2.body.id}/void`).send({ reason: 'x' })).status).toBe(400);
    expect((await b.post(`/invoices/${d2.body.id}/void`).send({ reason: 'duplicate draft' })).status).toBe(200);
    const d3 = await b.post('/invoices').send({ leaseId: fx.leaseA.lease.id, dueDate: due, lines: [{ description: 'Late fee', accountCode: '4100', amountCents: 5000 }] });
    const issued = await b.post(`/invoices/${d3.body.id}/issue`);
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe('open');
    expect((await b.post(`/invoices/${d3.body.id}/issue`)).status).toBe(409);
    expect((await b.post(`/invoices/${d3.body.id}/issue`)).body.code).toBe('invalid_transition');
    const overdue = await b.post('/invoices/mark-overdue');
    expect(overdue.body.updated).toBe(1);
    expect((await b.get(`/invoices/${d3.body.id}`)).body.status).toBe('overdue');
    const aging = await b.get('/invoices/aging');
    expect(aging.status).toBe(200);
    expect(aging.body.totals).toMatchObject({ currentCents: 150000, d31to60Cents: 5000, totalCents: 155000 });
    expect(aging.body.byTenant[0]).toMatchObject({ tenantProfileId: fx.leaseA.profile.id, invoiceCount: 2 });
    const list = await b.get('/invoices?overdue=true');
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([d3.body.id]);

    const voided = await b.post(`/invoices/${d3.body.id}/void`).send({ reason: 'fee waived by manager' });
    expect(voided.status).toBe(200);
    expect(voided.body.status).toBe('void');
    const rev = await prisma.journalEntry.findFirst({ where: { tenantOrgId: fx.a.id, sourceType: 'reversal', sourceId: { not: '' }, reversalOfId: { not: null } }, include: { lines: { include: { account: true } } } });
    expect(rev).not.toBeNull();
    expect(rev!.lines.find((l) => l.account.code === '1100')?.creditCents).toBe(5000);
    expect((await b.get('/ledger/proof')).body).toMatchObject({ balanced: true, unbalancedEntries: 0 });
    expect((await b.post(`/invoices/${d3.body.id}/void`).send({ reason: 'again' })).status).toBe(409);
    expect((await b.post('/invoices').send({ leaseId: 'nope', dueDate: due, lines: [{ description: 'x', amountCents: 1 }] })).status).toBe(400);
    expect(await prisma.auditLog.count({ where: { tenantOrgId: fx.a.id, action: { in: ['invoice.create', 'invoice.issue', 'invoice.void', 'invoice.generate', 'invoice.mark_overdue'] } } })).toBeGreaterThanOrEqual(9);
  });

  it('tenants see only invoices of their leases; landlords see their properties; strangers see nothing', async () => {
    const t = await asUser(fx.tenants.a);
    const mine = await t.get('/invoices');
    expect(mine.status).toBe(200);
    expect(mine.body.items.length).toBeGreaterThanOrEqual(1);
    expect(mine.body.items.every((i: { leaseId: string }) => i.leaseId === fx.leaseA.lease.id)).toBe(true);
    const detail = await t.get(`/invoices/${mine.body.items[0].id}`);
    expect(detail.status).toBe(200);
    const invB = await prisma.invoice.findFirstOrThrow({ where: { tenantOrgId: fx.b.id } });
    expect((await t.get(`/invoices/${invB.id}`)).status).toBe(404);
    expect((await t.get('/invoices/aging')).status).toBe(403);
    expect((await t.post('/invoices/generate').send({ period })).status).toBe(403);
    const s = await asUser(fx.strangerTenant);
    expect((await s.get('/invoices')).body.items).toHaveLength(0);
    expect((await s.get(`/invoices/${mine.body.items[0].id}`)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { actorId: fx.strangerTenant.id, action: 'access.denied', resourceType: 'invoice' } })).toBe(1);
    const l = await asUser(fx.landlord);
    const owned = await l.get('/invoices');
    expect(owned.body.items.length).toBe(mine.body.items.length);
    expect(owned.body.items.every((i: { propertyName: string }) => i.propertyName === 'Shared Name Tower')).toBe(true);
  });
});
