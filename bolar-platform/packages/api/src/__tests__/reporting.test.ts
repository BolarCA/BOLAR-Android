import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@bolar/db';
import { createStorageAdapter } from '@bolar/integrations';
import { createProperty, createUnit, createUser } from '@bolar/testing';
import { drainMemoryQueue } from '../shared/queue.js';
import { asUser } from './helpers.js';
import { financeFixture, monthStart, periodOf, activeLease } from './finance.fixture.js';
import { cronMatchesDay, runDueScheduledReports } from '../modules/reporting/service.js';

const DAY = 86_400_000;

/**
 * Reporting (blueprint Days 75-90): governed materialized views, reconciliation to source tables, tenant and landlord
 * filters, scheduled definitions and audited exports. Two orgs with overlapping names; org B must never leak into org A.
 */
describe('reporting: KPI views, reconciliation, scope and exports', () => {
  let fx: Awaited<ReturnType<typeof financeFixture>>;
  let otherProp: { id: string };
  let otherLease: Awaited<ReturnType<typeof activeLease>>;
  const period = periodOf(monthStart(1));
  const timings: Record<string, number> = {};

  beforeAll(async () => {
    fx = await financeFixture();
    const bA = await asUser(fx.books.a);
    const bB = await asUser(fx.books.b);
    await bA.post('/accounts/seed-default');
    // Org A: second property the landlord does not own, with its own active lease; unit statuses for occupancy.
    otherProp = await createProperty(fx.a, { name: 'Other Place' });
    const otherTenant = await createUser(fx.a, 'tenant', 'other@alpha.test');
    otherLease = await activeLease(fx.a, otherProp.id, otherTenant.id, '201', 99000);
    await prisma.unit.update({ where: { id: fx.leaseA.unit.id }, data: { status: 'occupied' } });
    await prisma.unit.update({ where: { id: otherLease.unit.id }, data: { status: 'occupied' } });
    await createUnit(fx.a, fx.propA.id, '102', 140000); // vacant
    // Invoices: generated rent invoice (current) + a manual overdue invoice (31-60 bucket) in org A; org B generates too.
    const gen = await bA.post('/invoices/generate').send({ period });
    expect(gen.body.created).toBe(2);
    const draft = await bA.post('/invoices').send({ leaseId: fx.leaseA.lease.id, dueDate: new Date(Date.now() - 45 * DAY).toISOString(), lines: [{ description: 'Late fee', accountCode: '4100', amountCents: 5000 }] });
    expect((await bA.post(`/invoices/${draft.body.id}/issue`)).status).toBe(200);
    const genB = await bB.post('/invoices/generate').send({ period });
    expect(genB.body.created).toBe(1);
    // Payments: tenant A pays half of the rent invoice; tenant B pays in full.
    const invA = await prisma.invoice.findFirstOrThrow({ where: { tenantOrgId: fx.a.id, leaseId: fx.leaseA.lease.id, totalCents: 150000 } });
    const tA = await asUser(fx.tenants.a);
    expect((await tA.post('/payments').set('Idempotency-Key', 'rpt-pay-a-0001').send({ invoiceId: invA.id, amountCents: 50000, method: 'card', paymentMethodRef: 'pm_mock_visa' })).status).toBe(201);
    const invB = await prisma.invoice.findFirstOrThrow({ where: { tenantOrgId: fx.b.id } });
    const tB = await asUser(fx.tenants.b);
    expect((await tB.post('/payments').set('Idempotency-Key', 'rpt-pay-b-0001').send({ invoiceId: invB.id, amountCents: 120000, method: 'card', paymentMethodRef: 'pm_mock_visa' })).status).toBe(201);
    // Work orders in org A: within SLA, late, open+breached, complete without SLA (propA); one late in the other property.
    const wo = (propertyId: string, data: Record<string, unknown>) => prisma.workOrder.create({ data: { tenantOrgId: fx.a.id, propertyId, requesterId: fx.tenants.a.id, title: 't', description: 'd', category: 'plumbing', ...data } as never });
    const t0 = new Date(Date.now() - 5 * DAY);
    await wo(fx.propA.id, { priority: 'high', status: 'complete', createdAt: t0, slaDueAt: new Date(t0.getTime() + 2 * DAY), completedAt: new Date(t0.getTime() + DAY) });
    await wo(fx.propA.id, { priority: 'high', status: 'complete', createdAt: t0, slaDueAt: new Date(t0.getTime() + DAY), completedAt: new Date(t0.getTime() + 3 * DAY) });
    await wo(fx.propA.id, { priority: 'normal', status: 'assigned', createdAt: t0, slaDueAt: new Date(t0.getTime() + DAY) });
    await wo(fx.propA.id, { priority: 'normal', status: 'complete', createdAt: t0, completedAt: new Date(t0.getTime() + DAY) });
    await wo(otherProp.id, { priority: 'normal', status: 'complete', createdAt: t0, slaDueAt: new Date(t0.getTime() + DAY), completedAt: new Date(t0.getTime() + 2 * DAY) });
    await prisma.workOrder.create({ data: { tenantOrgId: fx.b.id, propertyId: fx.propB.id, requesterId: fx.tenants.b.id, title: 't', description: 'd', category: 'hvac', priority: 'emergency', status: 'complete', slaDueAt: new Date(), completedAt: new Date() } });
    // Compliance: one rule, evaluations in both orgs (allow rows are not hits).
    const rule = await prisma.complianceRule.create({ data: { key: 'rpt.test.rule', version: 1, jurisdiction: 'US', domain: 'deposit', title: 'Deposit cap', description: 'test', severity: 'critical', action: 'block', conditions: {}, effectiveFrom: new Date('2020-01-01') } });
    const ev = (tenantOrgId: string, result: string, resolution: string | null) => prisma.ruleEvaluation.create({ data: { tenantOrgId, ruleId: rule.id, ruleKey: rule.key, ruleVersion: 1, resourceType: 'lease', resourceId: 'x', result, evidenceJson: {}, resolution } });
    await ev(fx.a.id, 'block', null);
    await ev(fx.a.id, 'warn', 'remediated');
    await ev(fx.a.id, 'allow', null);
    await ev(fx.b.id, 'review', null);
    drainMemoryQueue();
    const refreshed = await bA.post('/reports/refresh');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshedAt).toBeTruthy();
  });

  async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const started = performance.now();
    const r = await fn();
    timings[name] = Math.round(performance.now() - started);
    return r;
  }

  it('headline KPIs carry freshness and reconcile to the source tables', async () => {
    const b = await asUser(fx.books.a);
    const res = await timed('kpis', () => b.get('/reports/kpis'));
    expect(res.status).toBe(200);
    const k = res.body;
    expect(new Date(k.refreshedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(k.staleSeconds).toBeLessThan(60);
    expect(k.scope).toBe('org');
    expect(k.propertyCount).toBe(2);
    const leases = await prisma.lease.aggregate({ where: { tenantOrgId: fx.a.id, status: 'active' }, _count: true, _sum: { rentCents: true } });
    expect(k.rentRoll).toEqual({ activeLeases: leases._count, monthlyRentCents: leases._sum.rentCents });
    expect(k.rentRoll.monthlyRentCents).toBe(249000);
    const open = await prisma.invoice.findMany({ where: { tenantOrgId: fx.a.id, status: { in: ['open', 'partially_paid', 'overdue'] } } });
    expect(k.arAging.balanceCents).toBe(open.reduce((s, i) => s + i.totalCents - i.paidCents, 0));
    expect(k.arAging).toMatchObject({ openInvoices: 3, balanceCents: 204000, overdueCents: 5000 });
    expect(k.occupancy).toEqual({ totalUnits: 3, occupiedUnits: 2, occupancyPct: 66.67 });
    const paid = await prisma.payment.aggregate({ where: { tenantOrgId: fx.a.id, status: 'succeeded' }, _sum: { amountCents: true } });
    expect(k.collections.thisMonthCents).toBe(paid._sum.amountCents);
    expect(k.collections.trailing12Cents).toBe(50000);
    expect(k.collections.ledgerCashTrailing12Cents).toBe(50000);
    const summary = await b.get('/finance/summary');
    expect(k.collections.thisMonthCents).toBe(summary.body.collectedThisMonthCents);
    expect(k.maintenanceSla).toEqual({ completedOrders: 4, completedWithinSla: 2, slaCompliancePct: 50, breachedOpen: 1 });
    expect(k.complianceHits).toEqual({ total: 2, open: 1, critical: 2 });
  });

  it('rent roll reconciles to active leases and paginates with a cursor', async () => {
    const b = await asUser(fx.books.a);
    const res = await timed('rent-roll', () => b.get('/reports/rent-roll'));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.totals).toEqual({ leases: 2, rentCents: 249000 });
    expect(res.body.items.map((r: { leaseId: string }) => r.leaseId).sort()).toEqual([fx.leaseA.lease.id, otherLease.lease.id].sort());
    const a = res.body.items.find((r: { leaseId: string }) => r.leaseId === fx.leaseA.lease.id);
    expect(a).toMatchObject({ propertyName: 'Shared Name Tower', unitNumber: '101', rentCents: 150000, tenantProfileId: fx.leaseA.profile.id, status: 'active' });
    expect(a.tenantName).toMatch(/Tenant 101/);
    expect(a.sortKey).toBeUndefined();
    // keyset pagination: limit=1 -> cursor -> second row -> end
    const p1 = await b.get('/reports/rent-roll?limit=1');
    expect(p1.body.items).toHaveLength(1);
    expect(p1.body.nextCursor).toBeTruthy();
    const p2 = await b.get(`/reports/rent-roll?limit=1&cursor=${encodeURIComponent(p1.body.nextCursor)}`);
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
    expect(p2.body.nextCursor).toBeNull();
    // property filter
    const only = await b.get(`/reports/rent-roll?propertyId=${otherProp.id}`);
    expect(only.body.items.map((r: { leaseId: string }) => r.leaseId)).toEqual([otherLease.lease.id]);
    expect(only.body.totals.rentCents).toBe(99000);
  });

  it('AR aging reconciles to open invoices and to the finance aging report', async () => {
    const b = await asUser(fx.books.a);
    const res = await timed('ar-aging', () => b.get('/reports/ar-aging'));
    expect(res.status).toBe(200);
    const fin = await b.get('/invoices/aging');
    expect(res.body.totals.totalCents).toBe(fin.body.totals.totalCents);
    expect(res.body.totals).toMatchObject({ currentCents: 199000, d31to60Cents: 5000, totalCents: 204000, invoices: 3 });
    const sumRows = res.body.items.reduce((s: number, r: { balanceCents: number }) => s + r.balanceCents, 0);
    expect(sumRows).toBe(204000);
    const late = res.body.items.find((r: { bucket: string }) => r.bucket === '31_60');
    expect(late).toMatchObject({ balanceCents: 5000, status: 'open', propertyName: 'Shared Name Tower' });
    expect(late.daysPastDue).toBeGreaterThanOrEqual(44);
    const filtered = await b.get('/reports/ar-aging?bucket=current');
    expect(filtered.body.items).toHaveLength(2);
    expect(filtered.body.totals.totalCents).toBe(199000);
  });

  it('occupancy reconciles to unit statuses and active leases', async () => {
    const b = await asUser(fx.books.a);
    const res = await timed('occupancy', () => b.get('/reports/occupancy'));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    const units = await prisma.unit.groupBy({ by: ['status'], where: { tenantOrgId: fx.a.id }, _count: true });
    const total = units.reduce((s, u) => s + u._count, 0);
    const occupied = units.find((u) => u.status === 'occupied')?._count ?? 0;
    expect(res.body.totals).toEqual({ properties: 2, totalUnits: total, occupiedUnits: occupied, occupancyPct: 66.67, scheduledRentCents: 249000 });
    const propA = res.body.items.find((r: { propertyId: string }) => r.propertyId === fx.propA.id);
    expect(propA).toMatchObject({ totalUnits: 2, occupiedUnits: 1, vacantUnits: 1, occupancyPct: 50, activeLeases: 1, scheduledRentCents: 150000 });
  });

  it('maintenance SLA reconciles to work orders by property and priority', async () => {
    const b = await asUser(fx.books.a);
    const res = await timed('maintenance-sla', () => b.get('/reports/maintenance-sla'));
    expect(res.status).toBe(200);
    const completed = await prisma.workOrder.findMany({ where: { tenantOrgId: fx.a.id, status: 'complete', completedAt: { not: null } } });
    const within = completed.filter((w) => !w.slaDueAt || (w.completedAt && w.completedAt <= w.slaDueAt)).length;
    expect(res.body.totals).toMatchObject({ completedOrders: completed.length, completedWithinSla: within, breachedOpen: 1, slaCompliancePct: 50 });
    const high = res.body.items.find((r: { propertyId: string; priority: string }) => r.propertyId === fx.propA.id && r.priority === 'high');
    expect(high).toMatchObject({ totalOrders: 2, completedOrders: 2, measuredOrders: 2, completedWithinSla: 1, completedLate: 1, slaCompliancePct: 50 });
    expect(high.avgHoursToComplete).toBe(48);
    const normalOnly = await b.get('/reports/maintenance-sla?priority=normal');
    expect(normalOnly.body.items.every((r: { priority: string }) => r.priority === 'normal')).toBe(true);
    expect(normalOnly.body.totals.breachedOpen).toBe(1);
  });

  it('collections reconcile to succeeded payments and to cash debits in the ledger', async () => {
    const b = await asUser(fx.books.a);
    const res = await timed('collections', () => b.get('/reports/collections?months=12'));
    expect(res.status).toBe(200);
    const payments = await prisma.payment.aggregate({ where: { tenantOrgId: fx.a.id, status: 'succeeded' }, _sum: { amountCents: true } });
    const cash = await prisma.ledgerEntry.aggregate({ where: { tenantOrgId: fx.a.id, account: { code: '1000' }, journalEntry: { sourceType: 'payment', postedAt: { not: null } } }, _sum: { debitCents: true } });
    expect(res.body.totals).toEqual({ collectedCents: payments._sum.amountCents, invoicedCents: 254000, ledgerCashCents: cash._sum.debitCents, reconciled: true });
    expect(res.body.months).toBe(12);
    expect(res.body.byMonth).toHaveLength(1);
    expect(res.body.byMonth[0]).toMatchObject({ collectedCents: 50000, ledgerCashCents: 50000, invoicedCents: 254000, paymentsCount: 1 });
    expect(res.body.byMonth[0].month).toMatch(/^\d{4}-\d{2}-01$/);
    expect(res.body.items.every((r: { propertyId: string }) => [fx.propA.id, otherProp.id].includes(r.propertyId))).toBe(true);
  });

  it('compliance hits reconcile to non-allow rule evaluations', async () => {
    const b = await asUser(fx.books.a);
    const res = await timed('compliance-hits', () => b.get('/reports/compliance-hits'));
    expect(res.status).toBe(200);
    const hits = await prisma.ruleEvaluation.count({ where: { tenantOrgId: fx.a.id, result: { not: 'allow' } } });
    const open = await prisma.ruleEvaluation.count({ where: { tenantOrgId: fx.a.id, result: { not: 'allow' }, resolution: null } });
    expect(res.body.totals).toEqual({ hits, open, bySeverity: { critical: 2 }, byResolution: { open: 1, remediated: 1 } });
    expect(res.body.items.reduce((s: number, r: { hits: number }) => s + r.hits, 0)).toBe(hits);
    expect(res.body.items[0]).toMatchObject({ severity: 'critical', domain: 'deposit' });
  });

  it('tenant isolation: org B sees only its own rows and totals on every endpoint', async () => {
    const bB = await asUser(fx.books.b);
    const idsA = [fx.propA.id, otherProp.id, fx.leaseA.lease.id, otherLease.lease.id];
    for (const path of ['/reports/rent-roll', '/reports/ar-aging', '/reports/occupancy', '/reports/maintenance-sla', '/reports/collections', '/reports/compliance-hits']) {
      const res = await bB.get(path);
      expect(res.status, path).toBe(200);
      const text = JSON.stringify(res.body.items);
      for (const id of idsA) expect(text, `${path} leaks ${id}`).not.toContain(id);
      for (const r of res.body.items as { propertyId?: string }[]) if (r.propertyId) expect(r.propertyId).toBe(fx.propB.id);
    }
    const k = (await bB.get('/reports/kpis')).body;
    expect(k.rentRoll).toEqual({ activeLeases: 1, monthlyRentCents: 120000 });
    expect(k.arAging).toEqual({ openInvoices: 0, balanceCents: 0, overdueCents: 0 });
    expect(k.collections.thisMonthCents).toBe(120000);
    expect(k.occupancy).toEqual({ totalUnits: 1, occupiedUnits: 0, occupancyPct: 0 });
    expect(k.maintenanceSla).toMatchObject({ completedOrders: 1, completedWithinSla: 1, slaCompliancePct: 100, breachedOpen: 0 });
    expect(k.complianceHits).toEqual({ total: 1, open: 1, critical: 1 });
    const rr = await bB.get('/reports/rent-roll');
    expect(rr.body.totals).toEqual({ leases: 1, rentCents: 120000 });
    expect(rr.body.items[0].leaseId).toBe(fx.leaseB.lease.id);
    // cross-tenant definitions/runs are invisible
    const bA = await asUser(fx.books.a);
    const def = await bA.post('/reports/definitions').send({ name: 'A only', kind: 'occupancy' });
    expect((await bB.post(`/reports/definitions/${def.body.id}/run`)).status).toBe(404);
    expect((await bB.get('/reports/definitions')).body.items.map((d: { id: string }) => d.id)).not.toContain(def.body.id);
  });

  it('landlord scope: only owned properties, property filters outside scope match nothing, staff-only reports are 403 + audited', async () => {
    const o = await asUser(fx.landlord);
    const k = await o.get('/reports/kpis');
    expect(k.status).toBe(200);
    expect(k.body).toMatchObject({ scope: 'properties', propertyCount: 1, complianceHits: null });
    expect(k.body.rentRoll).toEqual({ activeLeases: 1, monthlyRentCents: 150000 });
    expect(k.body.occupancy).toEqual({ totalUnits: 2, occupiedUnits: 1, occupancyPct: 50 });
    expect(k.body.maintenanceSla).toEqual({ completedOrders: 3, completedWithinSla: 2, slaCompliancePct: 66.67, breachedOpen: 1 });
    const rr = await o.get('/reports/rent-roll');
    expect(rr.body.items.map((r: { propertyId: string }) => r.propertyId)).toEqual([fx.propA.id]);
    const occ = await o.get('/reports/occupancy');
    expect(occ.body.items).toHaveLength(1);
    expect(occ.body.totals.properties).toBe(1);
    const col = await o.get('/reports/collections');
    expect(col.body.items.every((r: { propertyId: string }) => r.propertyId === fx.propA.id)).toBe(true);
    const sla = await o.get('/reports/maintenance-sla');
    expect(sla.body.items.every((r: { propertyId: string }) => r.propertyId === fx.propA.id)).toBe(true);
    const outside = await o.get(`/reports/rent-roll?propertyId=${otherProp.id}`);
    expect(outside.status).toBe(200);
    expect(outside.body.items).toHaveLength(0);
    expect(outside.body.totals).toEqual({ leases: 0, rentCents: 0 });
    expect((await o.get('/reports/ar-aging')).status).toBe(403);
    expect((await o.get('/reports/compliance-hits')).status).toBe(403);
    expect((await o.post('/reports/refresh')).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { actorId: fx.landlord.id, action: 'access.denied', resourceType: 'report' } })).toBeGreaterThanOrEqual(3);
  });

  it('tenants and vendors are denied with an access.denied audit row', async () => {
    const t = await asUser(fx.tenants.a);
    expect((await t.get('/reports/kpis')).status).toBe(403);
    expect((await t.get('/reports/rent-roll')).status).toBe(403);
    expect((await t.post('/reports/definitions').send({ name: 'Nope', kind: 'rent_roll' })).status).toBe(403);
    const row = await prisma.auditLog.findFirst({ where: { actorId: fx.tenants.a.id, action: 'access.denied', resourceType: 'report', outcome: 'deny' } });
    expect(row).not.toBeNull();
    expect((row!.metadata as { permission: string }).permission).toBe('finance:read');
    const v = await asUser(fx.vendor);
    expect((await v.get('/reports/kpis')).status).toBe(403); // no finance:read at all
  });

  it('scheduled definitions run to an audited, downloadable export that respects the creator scope', async () => {
    const b = await asUser(fx.books.a);
    expect((await b.post('/reports/definitions').send({ name: 'Bad cron', kind: 'rent_roll', scheduleCron: 'every day' })).status).toBe(400);
    expect((await b.post('/reports/definitions').send({ name: 'Bad kind', kind: 'profit' })).status).toBe(400);
    const def = await b.post('/reports/definitions').send({ name: 'Monthly rent roll', kind: 'rent_roll', scheduleCron: '0 6 1 * *', recipients: ['books@alpha.test'], format: 'csv' });
    expect(def.status).toBe(201);
    expect(def.body).toMatchObject({ kind: 'rent_roll', scheduleCron: '0 6 1 * *', recipients: ['books@alpha.test'], format: 'csv', status: 'active', scopeJson: null, filtersJson: {} });
    expect((await b.get('/reports/definitions')).body.items.map((d: { id: string }) => d.id)).toContain(def.body.id);

    const run = await b.post(`/reports/definitions/${def.body.id}/run`);
    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({ status: 'complete', rowCount: 2, format: 'csv', trigger: 'manual', definitionName: 'Monthly rent roll', kind: 'rent_roll', requestedBy: fx.books.a.id });
    expect(run.body.storageKey).toBe(`org/${fx.a.id}/reports/${run.body.id}.csv`);
    expect(drainMemoryQueue('reports').some((j) => j.data.reportRunId === run.body.id)).toBe(true);
    const obj = await createStorageAdapter().getObject(run.body.storageKey);
    expect(obj?.contentType).toBe('text/csv');
    const lines = obj!.body.toString('utf8').trim().split('\r\n');
    expect(lines[0]).toBe('leaseId,propertyName,unitNumber,tenantName,status,startDate,endDate,rentCents,depositCents,targetRentCents,propertyId,unitId,tenantProfileId');
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.includes(fx.leaseA.lease.id) && l.includes('150000'))).toBe(true);
    const exportAudit = await prisma.auditLog.findFirst({ where: { tenantOrgId: fx.a.id, action: 'report.export', resourceId: run.body.id } });
    expect(exportAudit).not.toBeNull();
    expect(exportAudit!.metadata).toMatchObject({ rowCount: 2, kind: 'rent_roll', format: 'csv', sha256: run.body.sha256, requestedBy: fx.books.a.id });
    expect(await prisma.auditLog.count({ where: { action: 'report.run_requested', resourceId: run.body.id, actorId: fx.books.a.id } })).toBe(1);

    const detail = await b.get(`/reports/runs/${run.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.download.url).toContain(encodeURIComponent(run.body.storageKey));
    expect(await prisma.auditLog.count({ where: { action: 'report.downloaded', resourceId: run.body.id } })).toBe(1);
    const runs = await b.get(`/reports/runs?definitionId=${def.body.id}`);
    expect(runs.body.items.map((r: { id: string }) => r.id)).toEqual([run.body.id]);
    expect((await prisma.reportDefinition.findUniqueOrThrow({ where: { id: def.body.id } })).lastRunAt).not.toBeNull();

    // Landlord definitions are pinned to the owner's properties and only visible to the owner.
    const o = await asUser(fx.landlord);
    const own = await o.post('/reports/definitions').send({ name: 'My occupancy', kind: 'occupancy', format: 'json' });
    expect(own.status).toBe(201);
    expect(own.body.scopeJson).toEqual({ propertyIds: [fx.propA.id] });
    const ownRun = await o.post(`/reports/definitions/${own.body.id}/run`);
    expect(ownRun.body).toMatchObject({ status: 'complete', rowCount: 1, format: 'json' });
    const json = JSON.parse((await createStorageAdapter().getObject(ownRun.body.storageKey))!.body.toString('utf8'));
    expect(json.rows.map((r: { propertyId: string }) => r.propertyId)).toEqual([fx.propA.id]);
    expect(json).toMatchObject({ kind: 'occupancy', rowCount: 1, tenantOrgId: fx.a.id });
    expect((await o.post(`/reports/definitions/${def.body.id}/run`)).status).toBe(404);
    expect((await o.get(`/reports/runs/${run.body.id}`)).status).toBe(404);
    expect((await o.get('/reports/runs')).body.items.map((r: { id: string }) => r.id)).toEqual([ownRun.body.id]);
    expect((await b.get('/reports/definitions')).body.items.map((d: { id: string }) => d.id)).toEqual(expect.arrayContaining([def.body.id, own.body.id]));
  });

  it('daily scheduler runs definitions whose cron matches today exactly once per day', async () => {
    expect(cronMatchesDay('0 6 1 * *', new Date(Date.UTC(2026, 2, 1)))).toBe(true);
    expect(cronMatchesDay('0 6 1 * *', new Date(Date.UTC(2026, 2, 2)))).toBe(false);
    expect(cronMatchesDay('0 9 * * 1-5', new Date(Date.UTC(2026, 2, 2)))).toBe(true); // Monday
    expect(cronMatchesDay('0 9 * * 1-5', new Date(Date.UTC(2026, 2, 1)))).toBe(false); // Sunday
    expect(cronMatchesDay('0 0 */10 * *', new Date(Date.UTC(2026, 2, 11)))).toBe(true);
    expect(cronMatchesDay('0 0 1 6 *', new Date(Date.UTC(2026, 5, 1)))).toBe(true);
    expect(cronMatchesDay('0 0 1 6 *', new Date(Date.UTC(2026, 6, 1)))).toBe(false);
    const b = await asUser(fx.books.a);
    const daily = await b.post('/reports/definitions').send({ name: 'Daily AR', kind: 'ar_aging', scheduleCron: '30 5 * * *' });
    const paused = await b.post('/reports/definitions').send({ name: 'Paused', kind: 'ar_aging', scheduleCron: '30 5 * * *' });
    await prisma.reportDefinition.update({ where: { id: paused.body.id }, data: { status: 'paused' } });
    const created = await runDueScheduledReports();
    expect(created).toHaveLength(1);
    const run = await prisma.reportRun.findUniqueOrThrow({ where: { id: created[0]! } });
    expect(run).toMatchObject({ definitionId: daily.body.id, status: 'complete', trigger: 'schedule', rowCount: 3 });
    expect(await runDueScheduledReports()).toHaveLength(0);
    expect((await b.post(`/reports/definitions/${paused.body.id}/run`)).status).toBe(409);
  });

  it('every report endpoint answers within the performance budget on the fixture', () => {
    for (const [name, ms] of Object.entries(timings)) expect(ms, `${name} took ${ms}ms`).toBeLessThan(1500);
    console.info('[reporting] endpoint timings ms', timings);
  });
});
