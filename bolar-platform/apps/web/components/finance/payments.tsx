'use client';
import { useMemo, useState } from 'react';
import { useCan } from '@/lib/auth';
import { ApiError, newIdempotencyKey } from '@/lib/api-client';
import { fmtCents, fmtDate, isOutstanding, useCreatePayment, useInvoices, usePayment, usePayments, useRefundPayment, type PaymentDto } from '@/lib/hooks/finance';
import { Alert, Badge, Button, Drawer, Input, PageHeader, Select, Table } from '@/components/ui';
import { financeTone as statusTone } from '@/lib/hooks/finance';
import { StateView } from '@/components/ui/state-view';

const STATUSES = ['pending', 'succeeded', 'failed', 'refunded'];

/** Payments (Day 39): list, record manual payment through the adapter, detail with provider events, approval-gated refund. */
export function PaymentsScreen() {
  const canWrite = useCan('finance:write');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const list = usePayments({ status: status || undefined });
  return (
    <>
      <PageHeader title="Payments" description="Every payment runs through the payment adapter (mock until sandbox keys land), is persisted with its provider events, and posts Cash against Receivables when it succeeds." actions={canWrite && <Button onClick={() => setRecordOpen(true)}>Record payment</Button>} />
      <div className="mb-4 max-w-xs"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
      <StateView isLoading={list.isLoading} error={list.error} data={list.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No payments', description: 'Payments appear here as tenants pay or staff record checks and cash.' }} onRetry={() => void list.refetch()}>
        {(d) => (
          <>
            <Table<PaymentDto> caption="Payments" rows={d.pages.flatMap((p) => p.items)} onRowClick={(r) => setSelected(r.id)} columns={[
              { key: 'inv', header: 'Invoice', render: (p) => <button className="font-medium text-cobalt-600 underline" onClick={() => setSelected(p.id)}>{p.invoiceNumber ?? p.invoiceId}</button> },
              { key: 'amt', header: 'Amount', className: 'text-right', render: (p) => fmtCents(p.amountCents) },
              { key: 'method', header: 'Method', render: (p) => `${p.method} · ${p.provider}` },
              { key: 'status', header: 'Status', render: (p) => <div><Badge tone={statusTone(p.status)}>{p.status}</Badge>{p.failureReason && <p className="mt-1 text-xs text-danger-600">{p.failureReason}</p>}</div> },
              { key: 'when', header: 'Received', render: (p) => fmtDate(p.receivedAt ?? p.createdAt) },
            ]} />
            {list.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      <PaymentDrawer id={selected} onClose={() => setSelected(null)} />
      <RecordPaymentDrawer open={recordOpen} onClose={() => setRecordOpen(false)} />
    </>
  );
}

function PaymentDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const canRefund = useCan('finance:approve_adjustment');
  const canBank = useCan('bank:read');
  const q = usePayment(id);
  const refund = useRefundPayment();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Drawer open={!!id} onClose={onClose} title="Payment">
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} skeleton="detail" onRetry={() => void q.refetch()}>
        {(p) => (
          <div className="space-y-5 text-sm">
            <div className="flex items-center gap-2"><Badge tone={statusTone(p.status)}>{p.status}</Badge><span className="text-muted">{p.method} via {p.provider}</span></div>
            <dl className="grid grid-cols-2 gap-2 rounded-lg border border-line p-3">
              <dt className="text-muted">Invoice</dt><dd className="text-right">{p.invoice.number} ({p.invoice.status.replace('_', ' ')})</dd>
              <dt className="text-muted">Amount</dt><dd className="text-right font-semibold">{fmtCents(p.amountCents)}</dd>
              <dt className="text-muted">Invoice paid</dt><dd className="text-right">{fmtCents(p.invoice.paidCents)} of {fmtCents(p.invoice.totalCents)}</dd>
              <dt className="text-muted">Received</dt><dd className="text-right">{fmtDate(p.receivedAt)}</dd>
              <dt className="text-muted">Provider reference</dt><dd className="text-right">{canBank ? p.externalId ?? '—' : <span className="text-muted">restricted (bank:read)</span>}</dd>
              {p.failureReason && <><dt className="text-muted">Failure</dt><dd className="text-right text-danger-600">{p.failureReason}</dd></>}
            </dl>
            <section><h3 className="mb-2 font-semibold text-navy-900">Provider events</h3>
              <Table caption="Payment events" rows={p.events} emptyLabel="No events recorded." columns={[{ key: 'type', header: 'Type', render: (e) => e.type }, { key: 'id', header: 'Event id', render: (e) => <span className="break-all text-xs">{e.externalEventId}</span> }, { key: 'when', header: 'At', render: (e) => new Date(e.createdAt).toLocaleString() }]} />
            </section>
            {canRefund && p.status === 'succeeded' && (
              <form className="space-y-2 rounded-lg border border-line p-3" onSubmit={(e) => { e.preventDefault(); refund.mutate({ id: p.id, amountCents: Math.round(Number(amount) * 100), reason }); }}>
                <p className="font-semibold text-navy-900">Refund (approval-gated)</p>
                <Input label="Refund amount (USD)" type="number" step="0.01" min="0.01" max={(p.amountCents / 100).toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} required />
                <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required />
                <Button type="submit" variant="danger" loading={refund.isPending}>Refund</Button>
                {refund.isError && <Alert tone="danger" title={refund.error instanceof ApiError ? refund.error.message : 'Refund failed'} />}
                {refund.isSuccess && <Alert tone="success" title="Refund recorded and reversed in the ledger" />}
              </form>
            )}
          </div>
        )}
      </StateView>
    </Drawer>
  );
}

function RecordPaymentDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const invoices = useInvoices({}, open);
  const create = useCreatePayment();
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('check');
  const [ref, setRef] = useState('');
  const [key, setKey] = useState(() => newIdempotencyKey());
  const outstanding = useMemo(() => (invoices.data?.pages.flatMap((p) => p.items) ?? []).filter((i) => isOutstanding(i.status)), [invoices.data]);
  const reset = () => { create.reset(); setInvoiceId(''); setAmount(''); setRef(''); setKey(newIdempotencyKey()); };
  return (
    <Drawer open={open} onClose={() => { reset(); onClose(); }} title="Record a payment">
      {create.isSuccess ? (
        <div className="space-y-4">
          <Alert tone={create.data.status === 'succeeded' ? 'success' : create.data.status === 'failed' ? 'danger' : 'info'} title={`Payment ${create.data.status}`}>{fmtCents(create.data.amountCents)} on {create.data.invoice.number}{create.data.failureReason ? ` — ${create.data.failureReason}` : ''}</Alert>
          <Button onClick={() => { reset(); onClose(); }}>Done</Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ invoiceId, amountCents: Math.round(Number(amount) * 100), method, paymentMethodRef: ref, idempotencyKey: key }); }}>
          <Select label="Invoice" value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); const inv = outstanding.find((i) => i.id === e.target.value); if (inv) setAmount((inv.balanceCents / 100).toFixed(2)); }} required>
            <option value="">Select an open invoice</option>
            {outstanding.map((i) => <option key={i.id} value={i.id}>{i.number} · {i.tenantName ?? i.unitNumber} · balance {fmtCents(i.balanceCents)}</option>)}
          </Select>
          <Input label="Amount (USD)" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>{['check', 'cash', 'ach', 'card', 'other'].map((m) => <option key={m} value={m}>{m}</option>)}</Select>
          <Input label="Reference" placeholder="Check number or receipt id" value={ref} onChange={(e) => setRef(e.target.value)} required hint="Stored as a provider reference only; never a card or account number." />
          {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not record payment'} />}
          <div className="flex gap-2"><Button type="submit" loading={create.isPending}>Record payment</Button><Button type="button" variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button></div>
        </form>
      )}
    </Drawer>
  );
}
