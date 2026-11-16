'use client';
import { useState } from 'react';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { usePrivacyAction, usePrivacyRequest, usePrivacyRequests, type PrivacyRequestDto } from '@/lib/hooks/privacy';
import { Alert, Badge, Button, Drawer, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { dueLabel, fmtDate, fmtDateTime, humanize } from './util';

const STATUSES = ['received', 'identity_verification', 'discovery', 'exception_review', 'approved', 'denied', 'fulfilled', 'closed'];

/** Day 48 privacy queue shared by /legal/privacy-requests and /subaccount/privacy-requests. */
export function PrivacyRequestsQueue() {
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const q = usePrivacyRequests({ status: status || undefined });
  return (
    <>
      <PageHeader title="Privacy requests" description="Access, deletion, correction and portability requests. Identity is verified before discovery; deletion exceptions (legal hold, retention, audit) are reviewed and every decision is made by an accountable human." />
      <div className="mb-4 max-w-xs"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></div>
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No privacy requests', description: 'Requests arrive through the public intake form and appear here with their SLA countdown.' }} onRetry={() => void q.refetch()}>
        {(d) => (
          <>
            <Table<PrivacyRequestDto> caption="Privacy requests" rows={d.pages.flatMap((p) => p.items)} onRowClick={(r) => setSelected(r.id)} columns={[
              { key: 'kind', header: 'Request', render: (r) => <div><p className="font-medium">{humanize(r.kind)}</p><p className="text-xs text-muted">{r.subjectEmail}</p></div> },
              { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge> },
              { key: 'identity', header: 'Identity', render: (r) => (r.identityVerifiedAt ? <Badge tone="success">verified</Badge> : <Badge tone="danger">pending</Badge>) },
              { key: 'due', header: 'Due', render: (r) => { const l = dueLabel(r.dueAt); return <div className="flex items-center gap-2"><span className="text-xs">{fmtDate(r.dueAt)}</span>{!['fulfilled', 'closed', 'denied'].includes(r.status) && <Badge tone={l.tone}>{l.text}</Badge>}</div>; } },
              { key: 'open', header: '', className: 'text-right', render: (r) => <Button variant="ghost" aria-label={`Open ${r.kind} request from ${r.subjectEmail}`} onClick={() => setSelected(r.id)}>Open</Button> },
            ]} />
            {q.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Privacy request">{selected && <RequestDetail id={selected} />}</Drawer>
    </>
  );
}

function RequestDetail({ id }: { id: string }) {
  const { me } = useAuth();
  const q = usePrivacyRequest(id);
  const act = usePrivacyAction();
  const canWrite = useCan('privacy_request:write');
  const canApprove = useCan('privacy_request:approve');
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState<'approved' | 'denied' | 'partial'>('approved');
  return (
    <StateView isLoading={q.isLoading} error={q.error} data={q.data} onRetry={() => void q.refetch()} skeleton="detail">
      {(r) => {
        const counts = r.discoveryJson.counts ?? {};
        const isCreator = !!r.createdBy && r.createdBy === me?.actor.id;
        return (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge><Badge tone="info">{humanize(r.kind)}</Badge>{r.identityVerifiedAt ? <Badge tone="success">identity {r.identityMethod}</Badge> : <Badge tone="danger">identity pending</Badge>}</div>
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-muted">Subject</dt><dd>{r.subjectEmail}</dd>
              <dt className="text-muted">Received</dt><dd>{fmtDateTime(r.createdAt)}</dd>
              <dt className="text-muted">Due</dt><dd>{fmtDate(r.dueAt)} <Badge tone={dueLabel(r.dueAt).tone}>{dueLabel(r.dueAt).text}</Badge></dd>
              {r.decision && <><dt className="text-muted">Decision</dt><dd>{r.decision} on {fmtDate(r.decidedAt)}</dd></>}
            </dl>
            {Object.keys(counts).length > 0 && (
              <section><h3 className="font-semibold">Discovery</h3><ul className="mt-1 grid grid-cols-2 gap-1 text-xs">{Object.entries(counts).map(([k, v]) => <li key={k} className="flex justify-between rounded bg-navy-50 px-2 py-1"><span>{humanize(k)}</span><span className="font-semibold">{v}</span></li>)}</ul></section>
            )}
            {r.exceptionsJson.length > 0 && (
              <section><h3 className="font-semibold">Exceptions</h3><ul className="mt-1 space-y-1">{r.exceptionsJson.map((e, i) => <li key={i} className="rounded border border-line p-2 text-xs"><Badge tone={e.type === 'legal_hold' ? 'danger' : 'neutral'}>{humanize(e.type)}</Badge> <span className="ml-1">{e.note}</span></li>)}</ul></section>
            )}
            {r.confirmationDraft && (
              <section><h3 className="font-semibold">Confirmation draft</h3><pre className="mt-1 whitespace-pre-wrap rounded bg-navy-50 p-3 text-xs" data-testid="confirmation-draft">{r.confirmationDraft}</pre></section>
            )}
            {r.manifestJson && <p className="text-xs text-muted">Manifest sha256: <code>{String(r.manifestJson.sha256)}</code></p>}
            <section className="space-y-2 border-t border-line pt-3">
              <h3 className="font-semibold">Actions</h3>
              {act.isError && <Alert tone="danger" title={act.error instanceof ApiError ? act.error.message : 'Action failed'} />}
              {canWrite && ['identity_verification', 'discovery'].includes(r.status) && <Button variant="secondary" disabled={!r.identityVerifiedAt} loading={act.isPending} onClick={() => act.mutate({ id, action: 'discover' })}>Run discovery</Button>}
              {!r.identityVerifiedAt && r.status === 'identity_verification' && <p className="text-xs text-muted">Discovery unlocks once the subject completes identity verification.</p>}
              {canWrite && ['discovery', 'exception_review'].includes(r.status) && <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate({ id, action: 'review-exceptions' })}>Review exceptions</Button>}
              {canApprove && r.status === 'exception_review' && !isCreator && (
                <div className="space-y-2 rounded-lg border border-line p-3">
                  <Select label="Decision" value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}><option value="approved">approved</option><option value="partial">partial</option><option value="denied">denied</option></Select>
                  <Input label="Decision note" required minLength={5} value={note} onChange={(e) => setNote(e.target.value)} />
                  <Button loading={act.isPending} onClick={() => act.mutate({ id, action: 'decide', body: { decision, note } })}>Record decision</Button>
                </div>
              )}
              {r.status === 'exception_review' && !canApprove && <p className="text-xs text-muted">Awaiting a decision by counsel or an approver.</p>}
              {canWrite && r.status === 'approved' && <Button loading={act.isPending} onClick={() => act.mutate({ id, action: 'fulfill' })}>Fulfil request</Button>}
              {canWrite && ['fulfilled', 'denied'].includes(r.status) && <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate({ id, action: 'close', body: { note: 'Closed from queue' } })}>Close</Button>}
            </section>
          </div>
        );
      }}
    </StateView>
  );
}
