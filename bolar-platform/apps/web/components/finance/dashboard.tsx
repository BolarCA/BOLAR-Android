'use client';
import Link from 'next/link';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { fmtCents, fmtDate, useApproveJournal, useFinanceSummary, useInvoiceAging, useJournalEntries, useLedgerProof, useMarkOverdue, usePayments, type JournalEntryDto, type PaymentDto } from '@/lib/hooks/finance';
import { Alert, Badge, Button, Card, KpiCard, PageHeader, Table } from '@/components/ui';
import { financeTone as statusTone } from '@/lib/hooks/finance';
import { StateView } from '@/components/ui/state-view';

/** Bookkeeper ledger dashboard (blueprint p53): KPIs, aging, recent payments, exceptions, double-entry proof, adjustment approvals. */
export function FinanceDashboard() {
  const { me } = useAuth();
  const canWrite = useCan('finance:write');
  const canApprove = useCan('finance:approve_adjustment');
  const summary = useFinanceSummary();
  const proof = useLedgerProof();
  const aging = useInvoiceAging();
  const recent = usePayments();
  const failed = usePayments({ status: 'failed' });
  const pending = useJournalEntries({ status: 'pending' });
  const approve = useApproveJournal();
  const markOverdue = useMarkOverdue();

  return (
    <>
      <PageHeader title="Ledger dashboard" description="Open receivables, collections, exceptions and the double-entry proof for this organization. Every figure comes from posted journal entries and issued invoices."
        actions={canWrite && <Button variant="secondary" onClick={() => markOverdue.mutate()} loading={markOverdue.isPending}>Scan for overdue</Button>} />
      {markOverdue.isSuccess && <div className="mb-4"><Alert tone="info" title={`${markOverdue.data.updated} invoice(s) marked overdue`} /></div>}
      {summary.data?.paymentsMode === 'mock' && <div className="mb-4"><Alert tone="warning" title="Payments run in mock mode">No real money moves. Real payments stay disabled until the blocker list in docs/qa/finance-qa.md is cleared.</Alert></div>}

      <StateView isLoading={summary.isLoading} error={summary.error} data={summary.data} skeleton="cards" onRetry={() => void summary.refetch()}>
        {(s) => (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="finance-kpis">
            <KpiCard label="Open receivables" value={fmtCents(s.openArCents)} hint={`${s.openInvoices} open invoice${s.openInvoices === 1 ? '' : 's'}`} tone="info" />
            <KpiCard label="Overdue" value={fmtCents(s.overdueCents)} hint={`${s.overdueInvoices} overdue`} tone={s.overdueInvoices ? 'danger' : 'success'} />
            <KpiCard label="Collected this month" value={fmtCents(s.collectedThisMonthCents)} hint="succeeded payments" tone="success" />
            <KpiCard label="Trial balance" value={s.trialBalanced ? 'Balanced' : 'Unbalanced'} hint={s.trialBalanced ? 'debits = credits' : `${s.unbalancedEntries} unbalanced`} tone={s.trialBalanced ? 'success' : 'danger'} />
          </div>
        )}
      </StateView>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Double-entry proof" className="lg:col-span-1">
          <StateView isLoading={proof.isLoading} error={proof.error} data={proof.data} skeleton="detail" onRetry={() => void proof.refetch()}>
            {(p) => (
              <div data-testid="ledger-proof" data-state={p.balanced ? 'balanced' : 'unbalanced'} className={`rounded-lg border p-4 ${p.balanced ? 'border-success-100 bg-success-100/50' : 'border-danger-100 bg-danger-100/50'}`}>
                <p className="text-sm font-semibold text-navy-900">{p.balanced ? 'Ledger balances' : 'Ledger does not balance'}</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted">Total debits</dt><dd className="text-right font-medium">{fmtCents(p.totalDebitCents)}</dd>
                  <dt className="text-muted">Total credits</dt><dd className="text-right font-medium">{fmtCents(p.totalCreditCents)}</dd>
                  <dt className="text-muted">Posted entries</dt><dd className="text-right">{p.postedEntries}</dd>
                  <dt className="text-muted">Unbalanced entries</dt><dd className="text-right">{p.unbalancedEntries}</dd>
                  <dt className="text-muted">Pending approval</dt><dd className="text-right">{p.pendingEntries}</dd>
                </dl>
                <p className="mt-3 text-xs text-muted">Checked {new Date(p.checkedAt).toLocaleTimeString()}. <Link className="underline" href="/finance/ledger">Open trial balance</Link></p>
              </div>
            )}
          </StateView>
        </Card>

        <Card title="Receivables aging by tenant" className="lg:col-span-2">
          <StateView isLoading={aging.isLoading} error={aging.error} data={aging.data} isEmpty={(d) => d.byTenant.length === 0} empty={{ title: 'Nothing outstanding', description: 'All issued invoices are paid.' }} onRetry={() => void aging.refetch()}>
            {(a) => (
              <Table caption="Receivables aging by tenant" rows={a.byTenant.map((t) => ({ ...t, id: t.tenantProfileId ?? 'none' }))} columns={[
                { key: 'tenant', header: 'Tenant', render: (t) => <div><p className="font-medium">{t.displayName}</p><p className="text-xs text-muted">{t.invoiceCount} invoice{t.invoiceCount === 1 ? '' : 's'}</p></div> },
                { key: 'current', header: 'Current', className: 'text-right', render: (t) => fmtCents(t.currentCents) },
                { key: 'd1', header: '1-30', className: 'text-right', render: (t) => fmtCents(t.d1to30Cents) },
                { key: 'd31', header: '31-60', className: 'text-right', render: (t) => fmtCents(t.d31to60Cents) },
                { key: 'd61', header: '61-90', className: 'text-right', render: (t) => fmtCents(t.d61to90Cents) },
                { key: 'd90', header: '90+', className: 'text-right', render: (t) => fmtCents(t.d90PlusCents) },
                { key: 'total', header: 'Total', className: 'text-right font-semibold', render: (t) => fmtCents(t.totalCents) },
              ]} />
            )}
          </StateView>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Recent payments" actions={<Link className="text-sm text-cobalt-600 underline" href="/finance/payments">All payments</Link>}>
          <StateView isLoading={recent.isLoading} error={recent.error} data={recent.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No payments yet' }} onRetry={() => void recent.refetch()}>
            {(d) => (
              <Table<PaymentDto> caption="Recent payments" rows={d.pages.flatMap((p) => p.items).slice(0, 8)} columns={[
                { key: 'inv', header: 'Invoice', render: (p) => <span className="font-medium">{p.invoiceNumber ?? p.invoiceId}</span> },
                { key: 'amt', header: 'Amount', className: 'text-right', render: (p) => fmtCents(p.amountCents) },
                { key: 'status', header: 'Status', render: (p) => <Badge tone={statusTone(p.status)}>{p.status}</Badge> },
                { key: 'when', header: 'Received', render: (p) => fmtDate(p.receivedAt ?? p.createdAt) },
              ]} />
            )}
          </StateView>
        </Card>

        <Card title="Exceptions">
          <StateView isLoading={failed.isLoading || summary.isLoading} error={failed.error ?? summary.error} data={failed.data && summary.data ? { failed: failed.data.pages.flatMap((p) => p.items), s: summary.data } : undefined} onRetry={() => void failed.refetch()}>
            {({ failed: rows, s }) => (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={s.unbalancedEntries ? 'danger' : 'success'}>{s.unbalancedEntries} unbalanced entries</Badge>
                  <Badge tone={rows.length ? 'danger' : 'success'}>{rows.length} failed payments</Badge>
                  <Badge tone={s.pendingAdjustments ? 'info' : 'neutral'}>{s.pendingAdjustments} adjustments awaiting approval</Badge>
                </div>
                {rows.length === 0 ? <p className="text-sm text-muted">No failed payments in the queue.</p> : (
                  <Table<PaymentDto> caption="Failed payments" rows={rows.slice(0, 8)} columns={[
                    { key: 'inv', header: 'Invoice', render: (p) => p.invoiceNumber ?? p.invoiceId },
                    { key: 'amt', header: 'Amount', className: 'text-right', render: (p) => fmtCents(p.amountCents) },
                    { key: 'reason', header: 'Reason', render: (p) => <span className="text-danger-600">{p.failureReason ?? 'unknown'}</span> },
                    { key: 'when', header: 'Attempted', render: (p) => fmtDate(p.createdAt) },
                  ]} />
                )}
              </div>
            )}
          </StateView>
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Adjustment approval queue">
          <p className="mb-3 text-sm text-muted">Manual adjustments and write-offs post only after a second person with approval rights signs off. Requesters cannot approve their own entries.</p>
          <StateView isLoading={pending.isLoading} error={pending.error} data={pending.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'Queue is clear', description: 'Pending adjustments appear here for approval.' }} onRetry={() => void pending.refetch()}>
            {(d) => (
              <Table<JournalEntryDto> caption="Pending adjustments" rows={d.pages.flatMap((p) => p.items)} columns={[
                { key: 'memo', header: 'Memo', render: (e) => <div><p className="font-medium">{e.memo}</p><p className="text-xs text-muted">{e.lines.map((l) => `${l.accountCode} ${l.debitCents ? 'Dr' : 'Cr'} ${fmtCents(l.debitCents || l.creditCents)}`).join(' · ')}</p></div> },
                { key: 'amt', header: 'Amount', className: 'text-right', render: (e) => fmtCents(e.totalDebitCents) },
                { key: 'requested', header: 'Requested', render: (e) => fmtDate(e.createdAt) },
                { key: 'actions', header: '', className: 'text-right', render: (e) => (canApprove && e.postedBy !== me?.actor.id ? <Button onClick={() => approve.mutate(e.id)} loading={approve.isPending} aria-label={`Approve adjustment ${e.memo ?? e.id}`}>Approve</Button> : <span className="text-xs text-muted">{e.postedBy === me?.actor.id ? 'Your request' : 'Approver required'}</span>) },
              ]} />
            )}
          </StateView>
          {approve.isError && <div className="mt-3"><Alert tone="danger" title={approve.error instanceof ApiError ? approve.error.message : 'Approval failed'} /></div>}
        </Card>
      </div>
    </>
  );
}
