'use client';
import { useState } from 'react';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { fmtCents, fmtDate, periodFromOffset, useGenerateInvoices, useInvoice, useInvoices, useIssueInvoice, useVoidInvoice, type InvoiceDto } from '@/lib/hooks/finance';
import { Alert, Badge, Button, Drawer, Input, Modal, PageHeader, Select, Table } from '@/components/ui';
import { financeTone as statusTone } from '@/lib/hooks/finance';
import { StateView } from '@/components/ui/state-view';

const STATUSES = ['draft', 'open', 'partially_paid', 'overdue', 'paid', 'void'];

/** Invoices (Day 38): filters, generate-for-period, detail drawer with lines, payments, lease/tenant context, issue and void. */
export function InvoicesScreen() {
  const canWrite = useCan('finance:write');
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const list = useInvoices({ status: status || undefined, overdue: overdue ? 'true' : undefined, q: q || undefined });
  return (
    <>
      <PageHeader title="Invoices" description="Rent and charge invoices per lease. Issuing posts receivables to the ledger; voiding reverses them." actions={canWrite && <Button onClick={() => setGenOpen(true)}>Generate invoices</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select>
        <Input label="Search number" placeholder="INV-" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex min-h-11 items-end gap-2 pb-3 text-sm"><input type="checkbox" className="h-4 w-4" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} /> Past due only</label>
      </div>
      <StateView isLoading={list.isLoading} error={list.error} data={list.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No invoices match', description: 'Generate rent invoices for a period or adjust the filters.', action: canWrite && <Button onClick={() => setGenOpen(true)}>Generate invoices</Button> }} onRetry={() => void list.refetch()}>
        {(d) => (
          <>
            <Table<InvoiceDto> caption="Invoices" rows={d.pages.flatMap((p) => p.items)} onRowClick={(r) => setSelected(r.id)} columns={[
              { key: 'number', header: 'Invoice', render: (i) => <button className="font-medium text-cobalt-600 underline" onClick={() => setSelected(i.id)}>{i.number}</button> },
              { key: 'tenant', header: 'Tenant / unit', render: (i) => <div><p>{i.tenantName ?? '—'}</p><p className="text-xs text-muted">{i.propertyName} · {i.unitNumber}</p></div> },
              { key: 'due', header: 'Due', render: (i) => fmtDate(i.dueDate) },
              { key: 'total', header: 'Total', className: 'text-right', render: (i) => fmtCents(i.totalCents) },
              { key: 'balance', header: 'Balance', className: 'text-right', render: (i) => fmtCents(i.balanceCents) },
              { key: 'status', header: 'Status', render: (i) => <Badge tone={statusTone(i.status)}>{i.status.replace('_', ' ')}</Badge> },
            ]} />
            {list.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      <InvoiceDrawer id={selected} onClose={() => setSelected(null)} />
      <GenerateModal open={genOpen} onClose={() => setGenOpen(false)} />
    </>
  );
}

export function InvoiceDrawer({ id, onClose, readOnly = false }: { id: string | null; onClose: () => void; readOnly?: boolean }) {
  const canWrite = useCan('finance:write') && !readOnly;
  const q = useInvoice(id);
  const issue = useIssueInvoice();
  const voidInv = useVoidInvoice();
  const [reason, setReason] = useState('');
  return (
    <Drawer open={!!id} onClose={onClose} title={q.data ? `Invoice ${q.data.number}` : 'Invoice'}>
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} skeleton="detail" onRetry={() => void q.refetch()}>
        {(inv) => (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(inv.status)}>{inv.status.replace('_', ' ')}</Badge><span className="text-muted">Due {fmtDate(inv.dueDate)}</span>{inv.periodStart && <span className="text-muted">· Period {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}</span>}</div>
            <dl className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3">
              <dt className="text-muted">Tenant</dt><dd className="text-right">{inv.tenant?.displayName ?? '—'}</dd>
              <dt className="text-muted">Property / unit</dt><dd className="text-right">{inv.lease.propertyName} · {inv.lease.unitNumber}</dd>
              <dt className="text-muted">Lease</dt><dd className="text-right">{inv.lease.status} · {fmtDate(inv.lease.startDate)} – {fmtDate(inv.lease.endDate)}</dd>
              <dt className="text-muted">Total</dt><dd className="text-right font-semibold">{fmtCents(inv.totalCents)}</dd>
              <dt className="text-muted">Paid</dt><dd className="text-right">{fmtCents(inv.paidCents)}</dd>
              <dt className="text-muted">Balance</dt><dd className="text-right font-semibold">{fmtCents(inv.balanceCents)}</dd>
            </dl>
            <section><h3 className="mb-2 font-semibold text-navy-900">Lines</h3>
              <Table caption="Invoice lines" rows={inv.lines} columns={[{ key: 'desc', header: 'Description', render: (l) => l.description }, { key: 'acct', header: 'Account', render: (l) => l.accountCode }, { key: 'amt', header: 'Amount', className: 'text-right', render: (l) => fmtCents(l.amountCents) }]} />
            </section>
            <section><h3 className="mb-2 font-semibold text-navy-900">Payments</h3>
              <Table caption="Invoice payments" rows={inv.payments} emptyLabel="No payments yet." columns={[{ key: 'when', header: 'Date', render: (p) => fmtDate(p.receivedAt ?? p.createdAt) }, { key: 'method', header: 'Method', render: (p) => p.method }, { key: 'amt', header: 'Amount', className: 'text-right', render: (p) => fmtCents(p.amountCents) }, { key: 'status', header: 'Status', render: (p) => <Badge tone={statusTone(p.status)}>{p.status}</Badge> }]} />
            </section>
            {inv.journalEntryIds.length > 0 && <p className="text-xs text-muted">Ledger entries: {inv.journalEntryIds.length}</p>}
            {canWrite && inv.status === 'draft' && <Button onClick={() => issue.mutate(inv.id)} loading={issue.isPending}>Issue invoice</Button>}
            {canWrite && ['open', 'overdue', 'draft'].includes(inv.status) && inv.paidCents === 0 && (
              <form className="space-y-2 rounded-lg border border-line p-3" onSubmit={(e) => { e.preventDefault(); voidInv.mutate({ id: inv.id, reason }); }}>
                <Input label="Void reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required />
                <Button type="submit" variant="danger" loading={voidInv.isPending}>Void invoice</Button>
              </form>
            )}
            {(issue.isError || voidInv.isError) && <Alert tone="danger" title={((issue.error ?? voidInv.error) instanceof ApiError ? (issue.error ?? voidInv.error) as ApiError : null)?.message ?? 'Action failed'} />}
          </div>
        )}
      </StateView>
    </Drawer>
  );
}

function GenerateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const gen = useGenerateInvoices();
  const [period, setPeriod] = useState(periodFromOffset(1));
  return (
    <Modal open={open} onClose={() => { gen.reset(); onClose(); }} title="Generate rent invoices"
      footer={<><Button variant="secondary" onClick={() => { gen.reset(); onClose(); }}>Close</Button><Button onClick={() => gen.mutate(period)} loading={gen.isPending}>Generate</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); gen.mutate(period); }}>
        <Input label="Period (YYYY-MM)" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} hint="One invoice per active lease with monthly charges. Re-running a period is safe: existing invoices are skipped." />
        {gen.isSuccess && <Alert tone="success" title={`Created ${gen.data.created} invoice${gen.data.created === 1 ? '' : 's'}, skipped ${gen.data.skipped}`}><span data-testid="generate-result" data-created={gen.data.created} data-skipped={gen.data.skipped}>Period {gen.data.period}</span></Alert>}
        {gen.isError && <Alert tone="danger" title={gen.error instanceof ApiError ? gen.error.message : 'Generation failed'} />}
      </form>
    </Modal>
  );
}
