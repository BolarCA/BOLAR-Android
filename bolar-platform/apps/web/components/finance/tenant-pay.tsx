'use client';
import { useMemo, useState } from 'react';
import { ApiError, newIdempotencyKey } from '@/lib/api-client';
import { fmtCents, fmtDate, isOutstanding, useCreatePayment, useInvoices, usePayments, type InvoiceDto, type PaymentDto } from '@/lib/hooks/finance';
import { Alert, Badge, Button, Card, Drawer, Input, KpiCard, PageHeader, Select, Table } from '@/components/ui';
import { financeTone as statusTone } from '@/lib/hooks/finance';
import { EmptyState, StateView } from '@/components/ui/state-view';

/** Resident "Pay rent" (Day 39): balance from open invoices, mock card/ACH form -> POST /payments with an idempotency key, history. */
export function TenantPay() {
  const invoices = useInvoices();
  const payments = usePayments();
  const [paying, setPaying] = useState<InvoiceDto | null>(null);
  const outstanding = useMemo(() => (invoices.data?.pages.flatMap((p) => p.items) ?? []).filter((i) => isOutstanding(i.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [invoices.data]);
  const balance = outstanding.reduce((s, i) => s + i.balanceCents, 0);
  return (
    <>
      <PageHeader title="Pay rent" description="Your current balance across open invoices. Payments run in sandbox mode during the pilot; nothing is charged to a real account." />
      <StateView isLoading={invoices.isLoading} error={invoices.error} data={invoices.data} skeleton="cards" onRetry={() => void invoices.refetch()}>
        {() => (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <KpiCard label="Current balance" value={<span data-testid="tenant-balance" data-cents={balance}>{fmtCents(balance)}</span>} hint={outstanding.length ? `${outstanding.length} open invoice${outstanding.length === 1 ? '' : 's'}` : 'All paid up'} tone={balance ? 'info' : 'success'} />
              <KpiCard label="Next due" value={outstanding[0] ? fmtDate(outstanding[0].dueDate) : '—'} hint={outstanding[0] ? outstanding[0].number : undefined} />
              <div className="flex items-center justify-center rounded-[14px] border border-line bg-surface p-5"><Button className="w-full" disabled={!outstanding[0]} onClick={() => outstanding[0] && setPaying(outstanding[0])}>Pay now</Button></div>
            </div>
            <div className="mt-6">
              {outstanding.length === 0 ? <div data-testid="zero-balance"><EmptyState title="You're all paid up" description="No open invoices. Your next rent invoice appears here when it is issued." /></div> : (
                <Card title="Open invoices">
                  <Table<InvoiceDto> caption="Open invoices" rows={outstanding} columns={[
                    { key: 'number', header: 'Invoice', render: (i) => <div><p className="font-medium">{i.number}</p><p className="text-xs text-muted">{i.propertyName} · Unit {i.unitNumber}</p></div> },
                    { key: 'due', header: 'Due', render: (i) => fmtDate(i.dueDate) },
                    { key: 'balance', header: 'Balance', className: 'text-right', render: (i) => fmtCents(i.balanceCents) },
                    { key: 'status', header: 'Status', render: (i) => <Badge tone={statusTone(i.status)}>{i.status.replace('_', ' ')}</Badge> },
                    { key: 'act', header: '', className: 'text-right', render: (i) => <Button variant="secondary" onClick={() => setPaying(i)} aria-label={`Pay invoice ${i.number}`}>Pay</Button> },
                  ]} />
                </Card>
              )}
            </div>
          </>
        )}
      </StateView>
      <div className="mt-6">
        <Card title="Payment history">
          <StateView isLoading={payments.isLoading} error={payments.error} data={payments.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No payments yet', description: 'Your payments and their status appear here.' }} onRetry={() => void payments.refetch()}>
            {(d) => (
              <Table<PaymentDto> caption="Payment history" rows={d.pages.flatMap((p) => p.items)} columns={[
                { key: 'when', header: 'Date', render: (p) => fmtDate(p.receivedAt ?? p.createdAt) },
                { key: 'inv', header: 'Invoice', render: (p) => p.invoiceNumber ?? p.invoiceId },
                { key: 'amt', header: 'Amount', className: 'text-right', render: (p) => fmtCents(p.amountCents) },
                { key: 'method', header: 'Method', render: (p) => p.method },
                { key: 'status', header: 'Status', render: (p) => <div><Badge tone={statusTone(p.status)}>{p.status}</Badge>{p.failureReason && <p className="mt-1 text-xs text-danger-600">{p.failureReason}</p>}</div> },
              ]} />
            )}
          </StateView>
        </Card>
      </div>
      <PayDrawer invoice={paying} onClose={() => setPaying(null)} />
    </>
  );
}

function PayDrawer({ invoice, onClose }: { invoice: InvoiceDto | null; onClose: () => void }) {
  const pay = useCreatePayment();
  const [method, setMethod] = useState<'card' | 'ach'>('card');
  const [amount, setAmount] = useState('');
  const [card, setCard] = useState('4242 4242 4242 4242');
  const [account, setAccount] = useState('000123456789');
  // One idempotency key per attempt: a retry of the same attempt replays the same payment instead of charging twice.
  const [key, setKey] = useState(() => newIdempotencyKey());
  const amountCents = Math.round(Number(amount || (invoice ? invoice.balanceCents / 100 : 0)) * 100);
  const reset = () => { pay.reset(); setAmount(''); setKey(newIdempotencyKey()); };
  if (!invoice) return null;
  return (
    <Drawer open onClose={() => { reset(); onClose(); }} title={`Pay ${invoice.number}`}>
      {pay.isSuccess && pay.data.status === 'succeeded' && (
        <div data-state="payment-success" className="space-y-4">
          <Alert tone="success" title="Payment received">{fmtCents(pay.data.amountCents)} applied to {pay.data.invoice.number}. Invoice is now {pay.data.invoice.status.replace('_', ' ')}.</Alert>
          <Button onClick={() => { reset(); onClose(); }}>Done</Button>
        </div>
      )}
      {pay.isSuccess && pay.data.status === 'pending' && (
        <div data-state="payment-pending" className="space-y-4">
          <Alert tone="info" title="Payment is processing">Bank transfers take a moment to confirm. We will update your balance when the bank confirms.</Alert>
          <Button onClick={() => { reset(); onClose(); }}>Done</Button>
        </div>
      )}
      {pay.isSuccess && pay.data.status === 'failed' && (
        <div data-state="payment-failed" className="space-y-4">
          <Alert tone="danger" title="Payment failed">{pay.data.failureReason === 'card_declined' ? 'Your card was declined. Try another payment method.' : pay.data.failureReason ?? 'The payment could not be completed.'}</Alert>
          <Button onClick={reset}>Try again</Button>
        </div>
      )}
      {!pay.isSuccess && (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); pay.mutate({ invoiceId: invoice.id, amountCents, method, paymentMethodRef: method === 'card' ? `pm_mock_card_${card.replace(/\s+/g, '').slice(-4)}` : `ba_mock_${account.slice(-4)}`, idempotencyKey: key }); }}>
          <p className="text-sm text-muted">Balance due {fmtCents(invoice.balanceCents)} · due {fmtDate(invoice.dueDate)}</p>
          <Input label="Amount (USD)" type="number" step="0.01" min="0.01" max={(invoice.balanceCents / 100).toFixed(2)} value={amount || (invoice.balanceCents / 100).toFixed(2)} onChange={(e) => setAmount(e.target.value)} required hint="You can pay part of the balance." />
          <Select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as 'card' | 'ach')}><option value="card">Card</option><option value="ach">Bank account (ACH)</option></Select>
          {method === 'card' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Input label="Card number" inputMode="numeric" autoComplete="cc-number" value={card} onChange={(e) => setCard(e.target.value)} required hint="Sandbox only. Use 4242 4242 4242 4242." /></div>
              <Input label="Expiry (MM/YY)" placeholder="12/30" autoComplete="cc-exp" required defaultValue="12/30" />
              <Input label="Security code" inputMode="numeric" autoComplete="cc-csc" required defaultValue="123" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Routing number" inputMode="numeric" required defaultValue="110000000" />
              <Input label="Account number" inputMode="numeric" value={account} onChange={(e) => setAccount(e.target.value)} required />
            </div>
          )}
          {pay.isError && <Alert tone="danger" title={pay.error instanceof ApiError ? pay.error.message : 'Payment could not be submitted'} />}
          <div className="flex gap-2"><Button type="submit" loading={pay.isPending}>Pay {fmtCents(amountCents)}</Button><Button type="button" variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button></div>
          <p className="text-xs text-muted">Card and bank details are sent to the payment provider only; BOLAR stores a reference, never the number.</p>
        </form>
      )}
    </Drawer>
  );
}
