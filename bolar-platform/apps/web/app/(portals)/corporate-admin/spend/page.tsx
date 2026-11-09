'use client';
import { formatCents } from '@bolar/shared';
import { useInvoices, type InvoiceDto } from '@/lib/hooks/finance';
import { Badge, KpiCard, PageHeader, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/** Corporate tenant spend tracking (blueprint p42): invoices for the company's leases with totals. */
export default function CorporateSpendPage() {
  const q = useInvoices({});
  return (
    <>
      <PageHeader title="Spend" description="Housing invoices for your organisation's leases. Amounts are what the property manager has billed; payments post as they settle." />
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No invoices yet', description: 'Invoices appear once leases for your employees are active and billed.' }} onRetry={() => void q.refetch()}>
        {(d) => {
          const rows = d.pages.flatMap((p) => p.items);
          const billed = rows.reduce((n, r) => n + r.totalCents, 0);
          const paid = rows.reduce((n, r) => n + r.paidCents, 0);
          const overdue = rows.filter((r) => r.status === 'overdue').reduce((n, r) => n + (r.totalCents - r.paidCents), 0);
          return (
            <>
              <div className="mb-6 grid gap-4 sm:grid-cols-3">
                <KpiCard label="Billed" value={formatCents(billed)} hint={`${rows.length} invoices`} />
                <KpiCard label="Paid" value={formatCents(paid)} tone="success" hint="settled" />
                <KpiCard label="Overdue" value={formatCents(overdue)} tone={overdue > 0 ? 'danger' : 'neutral'} hint={overdue > 0 ? 'action needed' : 'none'} />
              </div>
              <Table<InvoiceDto> caption="Invoices" rows={rows} columns={[
                { key: 'number', header: 'Invoice', render: (r) => r.number },
                { key: 'property', header: 'Property', render: (r) => `${r.propertyName ?? ''}${r.unitNumber ? ` · Unit ${r.unitNumber}` : ''}` },
                { key: 'due', header: 'Due', render: (r) => new Date(r.dueDate).toLocaleDateString() },
                { key: 'total', header: 'Total', className: 'text-right', render: (r) => formatCents(r.totalCents) },
                { key: 'balance', header: 'Balance', className: 'text-right', render: (r) => formatCents(r.balanceCents) },
                { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status.replace(/_/g, ' ')}</Badge> },
              ]} />
            </>
          );
        }}
      </StateView>
    </>
  );
}
