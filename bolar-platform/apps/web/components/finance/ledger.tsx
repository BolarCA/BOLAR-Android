'use client';
import { useState } from 'react';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { fmtCents, fmtDate, useAccountEntries, useCreateJournalEntry, useJournalEntries, useReverseJournal, useSeedDefaultAccounts, useTrialBalance, type JournalEntryDto, type LedgerAccountEntryDto } from '@/lib/hooks/finance';
import { Alert, Badge, Button, Card, Drawer, Input, Modal, PageHeader, Select, Table } from '@/components/ui';
import { financeTone as statusTone } from '@/lib/hooks/finance';
import { StateView } from '@/components/ui/state-view';

/** Ledger (Day 37): trial balance with account drill-down, recent journal entries with reversal, manual adjustment request. */
export function LedgerScreen() {
  const canWrite = useCan('finance:write');
  const canPost = useCan('finance:post');
  const tb = useTrialBalance();
  const seed = useSeedDefaultAccounts();
  const [account, setAccount] = useState<{ id: string; code: string; name: string } | null>(null);
  const [adjOpen, setAdjOpen] = useState(false);
  return (
    <>
      <PageHeader title="Ledger" description="Trial balance over posted journal entries. Posted entries are immutable; corrections are mirrored reversals, and manual adjustments wait for a second approver."
        actions={canPost && <Button onClick={() => setAdjOpen(true)}>New adjustment</Button>} />
      <StateView isLoading={tb.isLoading} error={tb.error} data={tb.data} isEmpty={(d) => d.rows.length === 0} onRetry={() => void tb.refetch()}
        empty={{ title: 'No chart of accounts yet', description: 'Seed the default chart (cash, receivables, deposits, payables, income and expense accounts) to start posting.', action: canWrite && <Button onClick={() => seed.mutate()} loading={seed.isPending}>Seed default chart</Button> }}>
        {(d) => (
          <Card title="Trial balance" actions={<Badge tone={d.balanced ? 'success' : 'danger'}><span data-testid="trial-balance-status" data-state={d.balanced ? 'balanced' : 'unbalanced'}>{d.balanced ? 'Balanced' : 'Unbalanced'}</span></Badge>}>
            <Table caption="Trial balance" rows={d.rows.map((r) => ({ ...r, id: r.accountId }))} onRowClick={(r) => setAccount({ id: r.accountId, code: r.code, name: r.name })} columns={[
              { key: 'code', header: 'Account', render: (r) => <button className="text-left" onClick={() => setAccount({ id: r.accountId, code: r.code, name: r.name })}><span className="font-mono text-xs text-muted">{r.code}</span> <span className="font-medium underline">{r.name}</span></button> },
              { key: 'type', header: 'Type', render: (r) => <Badge>{r.type}</Badge> },
              { key: 'debit', header: 'Debits', className: 'text-right', render: (r) => fmtCents(r.debitCents) },
              { key: 'credit', header: 'Credits', className: 'text-right', render: (r) => fmtCents(r.creditCents) },
              { key: 'balance', header: 'Balance', className: 'text-right font-semibold', render: (r) => fmtCents(r.balanceCents) },
            ]} />
            <div className="mt-3 flex flex-wrap justify-end gap-6 text-sm"><span>Total debits <strong>{fmtCents(d.totalDebitCents)}</strong></span><span>Total credits <strong>{fmtCents(d.totalCreditCents)}</strong></span></div>
          </Card>
        )}
      </StateView>
      <div className="mt-6"><JournalList /></div>
      <AccountDrawer account={account} onClose={() => setAccount(null)} />
      <AdjustmentModal open={adjOpen} onClose={() => setAdjOpen(false)} />
    </>
  );
}

function AccountDrawer({ account, onClose }: { account: { id: string; code: string; name: string } | null; onClose: () => void }) {
  const q = useAccountEntries(account?.id ?? null);
  return (
    <Drawer open={!!account} onClose={onClose} title={account ? `${account.code} ${account.name}` : 'Account'}>
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No entries', description: 'Posted lines for this account appear here.' }} onRetry={() => void q.refetch()}>
        {(d) => (
          <>
            <Table<LedgerAccountEntryDto> caption="Account entries" rows={d.pages.flatMap((p) => p.items)} columns={[
              { key: 'when', header: 'Posted', render: (l) => fmtDate(l.postedAt) },
              { key: 'src', header: 'Source', render: (l) => <div><Badge>{l.sourceType}</Badge><p className="mt-1 text-xs text-muted">{l.journalMemo ?? l.memo}</p></div> },
              { key: 'debit', header: 'Debit', className: 'text-right', render: (l) => (l.debitCents ? fmtCents(l.debitCents) : '') },
              { key: 'credit', header: 'Credit', className: 'text-right', render: (l) => (l.creditCents ? fmtCents(l.creditCents) : '') },
            ]} />
            {q.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
    </Drawer>
  );
}

function JournalList() {
  const canPost = useCan('finance:post');
  const q = useJournalEntries();
  const reverse = useReverseJournal();
  const [target, setTarget] = useState<JournalEntryDto | null>(null);
  const [reason, setReason] = useState('');
  return (
    <Card title="Journal entries">
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No journal entries', description: 'Entries are posted when invoices issue and payments succeed.' }} onRetry={() => void q.refetch()}>
        {(d) => (
          <>
            <Table<JournalEntryDto> caption="Journal entries" rows={d.pages.flatMap((p) => p.items)} columns={[
              { key: 'when', header: 'Posted', render: (e) => (e.postedAt ? fmtDate(e.postedAt) : <Badge tone="info">pending</Badge>) },
              { key: 'src', header: 'Source', render: (e) => <div><Badge tone={e.sourceType === 'reversal' ? 'violet' : 'neutral'}>{e.sourceType}</Badge><p className="mt-1 text-xs text-muted">{e.memo}</p></div> },
              { key: 'lines', header: 'Lines', render: (e) => <ul className="text-xs">{e.lines.map((l) => <li key={l.id}><span className="font-mono">{l.accountCode}</span> {l.debitCents ? `Dr ${fmtCents(l.debitCents)}` : `Cr ${fmtCents(l.creditCents)}`}</li>)}</ul> },
              { key: 'amt', header: 'Amount', className: 'text-right', render: (e) => fmtCents(e.totalDebitCents) },
              { key: 'status', header: 'Status', render: (e) => <Badge tone={statusTone(e.status)}>{e.status}</Badge> },
              { key: 'act', header: '', className: 'text-right', render: (e) => (canPost && e.status === 'posted' && e.sourceType !== 'reversal' ? <Button variant="ghost" onClick={() => setTarget(e)} aria-label={`Reverse entry ${e.memo ?? e.id}`}>Reverse</Button> : null) },
            ]} />
            {q.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      <Modal open={!!target} onClose={() => { setTarget(null); reverse.reset(); }} title="Reverse journal entry"
        footer={<><Button variant="secondary" onClick={() => { setTarget(null); reverse.reset(); }}>Cancel</Button><Button variant="danger" loading={reverse.isPending} onClick={() => target && reverse.mutate({ id: target.id, reason }, { onSuccess: () => { setTarget(null); setReason(''); } })}>Post reversal</Button></>}>
        <p className="text-sm text-muted">A mirrored entry is posted; the original stays immutable.</p>
        <div className="mt-3"><Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required /></div>
        {reverse.isError && <div className="mt-3"><Alert tone="danger" title={reverse.error instanceof ApiError ? reverse.error.message : 'Reversal failed'} /></div>}
      </Modal>
    </Card>
  );
}

function AdjustmentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateJournalEntry();
  const [memo, setMemo] = useState('');
  const [debit, setDebit] = useState('4100');
  const [credit, setCredit] = useState('1100');
  const [amount, setAmount] = useState('');
  const close = () => { create.reset(); onClose(); };
  return (
    <Modal open={open} onClose={close} title="Request a manual adjustment" footer={<><Button variant="secondary" onClick={close}>Close</Button>{!create.isSuccess && <Button loading={create.isPending} onClick={() => create.mutate({ sourceType: 'adjustment', memo, lines: [{ accountCode: debit, debitCents: Math.round(Number(amount) * 100) }, { accountCode: credit, creditCents: Math.round(Number(amount) * 100) }] })}>Submit for approval</Button>}</>}>
      {create.isSuccess ? <Alert tone="success" title="Adjustment submitted">It is pending until a different user with approval rights posts it from the dashboard queue.</Alert> : (
        <div className="space-y-3">
          <Input label="Memo" value={memo} onChange={(e) => setMemo(e.target.value)} minLength={3} required hint="Write-offs, corrections and manual adjustments need a second approver." />
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Debit account" value={debit} onChange={(e) => setDebit(e.target.value)}>{['1000', '1100', '1200', '2000', '2100', '2200', '3000', '4000', '4100', '4200', '5000', '5100', '5200', '5300', '5400'].map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            <Select label="Credit account" value={credit} onChange={(e) => setCredit(e.target.value)}>{['1000', '1100', '1200', '2000', '2100', '2200', '3000', '4000', '4100', '4200', '5000', '5100', '5200', '5300', '5400'].map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            <Input label="Amount (USD)" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not submit'} />}
        </div>
      )}
    </Modal>
  );
}
