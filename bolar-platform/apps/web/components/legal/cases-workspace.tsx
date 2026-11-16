'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useCases, useCreateCase, type CaseDto } from '@/lib/hooks/legal';
import { usePrivacyRequests } from '@/lib/hooks/privacy';
import { useLegalHolds } from '@/lib/hooks/legal-hold';
import { Badge, Button, Drawer, Input, KpiCard, PageHeader, Select, Table, Alert, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { dueLabel, fmtDate, humanize } from './util';
import { AgencyReview } from './agency-review';

const KINDS = ['eviction', 'dispute', 'compliance', 'agency', 'other'] as const;

function nextDeadline(c: CaseDto) {
  const open = c.deadlines.filter((d) => !d.done).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return open[0] ?? null;
}

/** p52 "Legal case workspace": cases with status and deadline chips, privileged markers, quick KPIs. */
export function CasesWorkspace() {
  const { me } = useAuth();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const cases = useCases({ status: status || undefined });
  const holds = useLegalHolds({ status: 'active' });
  const privacy = usePrivacyRequests();
  const canWrite = useCan('case:write');
  const count = (d: { pages: { items: unknown[] }[] } | undefined) => (d ? d.pages.reduce((n, p) => n + p.items.length, 0) : '…');
  const overdue = cases.data ? cases.data.pages.flatMap((p) => p.items).filter((c) => c.deadlines.some((d) => !d.done && new Date(d.dueAt).getTime() < Date.now())).length : '…';

  return (
    <>
      <PageHeader title="Legal case workspace" description={`Privileged matters for ${me?.org.name ?? 'your organization'}. Case threads are confidential and every access is logged.`} actions={canWrite && <Button onClick={() => setOpen(true)}>New case</Button>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Visible cases" value={count(cases.data)} hint="represented or lead" />
        <KpiCard label="Overdue deadlines" value={overdue} hint="needs action" tone={typeof overdue === 'number' && overdue > 0 ? 'danger' : 'success'} />
        <KpiCard label="Active legal holds" value={count(holds.data)} hint={`${count(privacy.data)} privacy requests`} tone="violet" />
      </div>
      <div className="mb-4 max-w-xs">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option><option value="open">open</option><option value="active">active</option><option value="on_hold">on hold</option><option value="closed">closed</option>
        </Select>
      </div>
      <StateView isLoading={cases.isLoading} error={cases.error} data={cases.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void cases.refetch()}
        empty={{ title: 'No cases yet', description: 'Cases you lead or represent appear here. Privileged matters are hidden from everyone else.', action: canWrite && <Button onClick={() => setOpen(true)}>Open a case</Button> }}>
        {(d) => (
          <>
            <Table<CaseDto> caption="Cases" rows={d.pages.flatMap((p) => p.items)} columns={[
              { key: 'title', header: 'Case', render: (c) => <div><Link href={`/legal/cases/${c.id}`} className="font-medium text-cobalt-600 underline-offset-2 hover:underline">{c.title}</Link><p className="text-xs text-muted">{humanize(c.kind)} · opened {fmtDate(c.createdAt)}</p></div> },
              { key: 'status', header: 'Status', render: (c) => <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge> },
              { key: 'deadline', header: 'Next deadline', render: (c) => { const n = nextDeadline(c); if (!n) return <span className="text-xs text-muted">none</span>; const l = dueLabel(n.dueAt); return <div className="flex flex-wrap items-center gap-2"><span className="text-sm">{n.title}</span><Badge tone={l.tone}>{l.text}</Badge></div>; } },
              { key: 'flags', header: 'Flags', render: (c) => <div className="flex flex-wrap gap-1">{c.privileged && <Badge tone="violet">privileged</Badge>}{(c.activeHoldIds?.length ?? 0) > 0 && <Badge tone="danger">legal hold</Badge>}{c.leaseId && <Badge>lease linked</Badge>}</div> },
            ]} />
            {cases.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void cases.fetchNextPage()} loading={cases.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      <AgencyReview />
      <NewCaseDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function NewCaseDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateCase();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<string>('eviction');
  const [leaseId, setLeaseId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [privileged, setPrivileged] = useState(true);
  const reset = () => { setTitle(''); setLeaseId(''); setPropertyId(''); setKind('eviction'); setPrivileged(true); create.reset(); };
  return (
    <Drawer open={open} onClose={() => { reset(); onClose(); }} title="Open a case">
      {create.isSuccess ? (
        <div className="space-y-4">
          <Alert tone="success" title={`Case "${create.data.title}" opened`}>You are the lead lawyer and hold the represents relationship. <Link className="underline" href={`/legal/cases/${create.data.id}`}>Open the case</Link>.</Alert>
          <Button onClick={() => { reset(); onClose(); }}>Done</Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ title, kind, leaseId: leaseId || undefined, propertyId: propertyId || undefined, privileged }); }}>
          <Input label="Title" required minLength={3} value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select>
          <Input label="Lease id" value={leaseId} onChange={(e) => setLeaseId(e.target.value)} hint="Optional. Linking a lease pulls its documents and audit trail into packets and holds." />
          <Input label="Property id" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} hint="Optional when a lease is linked." />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={privileged} onChange={(e) => setPrivileged(e.target.checked)} /> Privileged (restricted to lead counsel and representatives)</label>
          {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not open case'} />}
          <div className="flex gap-2"><Button type="submit" loading={create.isPending}>Open case</Button><Button type="button" variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button></div>
        </form>
      )}
    </Drawer>
  );
}
