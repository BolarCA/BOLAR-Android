'use client';
import { useEffect, useState } from 'react';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useNoticeAction, useNotices, type NoticeDto } from '@/lib/hooks/notice';
import { severityTone, useEvaluations } from '@/lib/hooks/compliance';
import { Alert, Button, Drawer, Modal, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { Pill } from './pill';
import { StateView } from '@/components/ui/state-view';

const STATUSES = ['pending_approval', 'draft', 'approved', 'sent', 'rejected', 'canceled', ''];

/** /compliance/notices: approval queue. Approver must differ from the author; guard hits are shown before approving. */
export function NoticeApprovals() {
  const canApprove = useCan('notice:approve');
  const [status, setStatus] = useState('pending_approval');
  const q = useNotices({ status: status || undefined });
  const [selected, setSelected] = useState<NoticeDto | null>(null);
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (!focus || selected) return;
    const found = q.data?.pages.flatMap((p) => p.items).find((n) => n.id === focus);
    if (found) setSelected(found);
  }, [q.data, selected]);
  return (
    <>
      <PageHeader title="Notice approvals" description="Legal notices stay drafts until an accountable approver signs off. Fair-housing and source-of-income guard hits are attached as evidence." />
      <div className="mb-4 max-w-xs"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s ? s.replace(/_/g, ' ') : 'All statuses'}</option>)}</Select></div>
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void q.refetch()} empty={{ title: 'Nothing awaiting approval', description: 'Notices submitted by managers appear here with their guard evidence.' }}>
        {(d) => (
          <Table<NoticeDto> caption="Notices" rows={d.pages.flatMap((p) => p.items)} columns={[
            { key: 'recipient', header: 'Recipient', render: (n) => <div><p className="font-medium">{n.recipientName ?? n.recipientId}</p><p className="text-xs text-muted">{n.kind.replace(/_/g, ' ')} · {n.templateKey}</p></div> },
            { key: 'status', header: 'Status', render: (n) => <Pill tone={statusTone(n.status)}>{n.status.replace(/_/g, ' ')}</Pill> },
            { key: 'guard', header: 'Rule hits', render: (n) => (n.ruleEvaluationIds.length ? <Pill tone="warning">{n.ruleEvaluationIds.length} hit{n.ruleEvaluationIds.length > 1 ? 's' : ''}</Pill> : <Pill tone="success">clean</Pill>) },
            { key: 'created', header: 'Created', render: (n) => new Date(n.createdAt).toLocaleDateString() },
            { key: 'actions', header: '', className: 'text-right', render: (n) => <Button variant="secondary" onClick={() => setSelected(n)} aria-label={`Review notice for ${n.recipientName ?? n.recipientId}`}>Review</Button> },
          ]} />
        )}
      </StateView>
      {selected && <NoticeReviewDrawer notice={selected} canApprove={canApprove} onClose={() => setSelected(null)} />}
    </>
  );
}

export function NoticeReviewDrawer({ notice, canApprove, onClose }: { notice: NoticeDto; canApprove: boolean; onClose: () => void }) {
  const act = useNoticeAction();
  const hits = useEvaluations({ resourceType: 'notice', resourceId: notice.id });
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const items = hits.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Drawer open onClose={onClose} title={`${notice.kind.replace(/_/g, ' ')} notice`}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2"><Pill tone={statusTone(notice.status)}>{notice.status.replace(/_/g, ' ')}</Pill><Pill>{notice.templateKey}</Pill></div>
        <p>To: <strong>{notice.recipientName ?? notice.recipientId}</strong></p>
        <section><h3 className="mb-1 font-semibold">Body</h3><pre className="whitespace-pre-wrap rounded-lg border border-line bg-navy-50 p-3 font-sans text-sm">{notice.bodyDraft}</pre></section>
        <section>
          <h3 className="mb-1 font-semibold">Compliance evidence</h3>
          {hits.isLoading ? <p className="text-muted">Loading…</p> : items.length === 0 ? <p className="text-muted">No rule hits recorded for this notice.</p> : (
            <ul className="space-y-2" data-testid="notice-guard-hits">
              {items.map((e) => { const ev = e.evidenceJson as { matchedTerms?: string[]; conditionsMatched?: string[] }; return (
                <li key={e.id} className="rounded-lg border border-line p-2">
                  <div className="flex flex-wrap gap-1"><Pill tone={severityTone(e.severity)}>{e.severity}</Pill><Pill tone={statusTone(e.result)}>{e.result}</Pill>{e.reviewedAt && <Pill>{e.resolution}</Pill>}</div>
                  <p className="mt-1 font-medium">{e.title}</p>
                  <p className="text-xs text-muted">{(ev.matchedTerms ?? ev.conditionsMatched ?? []).join(', ')}</p>
                  {e.sourceUrl && <a className="text-xs text-cobalt-600 underline" href={e.sourceUrl} target="_blank" rel="noreferrer">Source</a>}
                </li>
              ); })}
            </ul>
          )}
        </section>
        {act.isError && <Alert tone="danger" title={act.error instanceof ApiError ? act.error.message : 'Action failed'} />}
        {canApprove && notice.status === 'pending_approval' && (
          <div className="flex gap-2">
            <Button loading={act.isPending} onClick={() => act.mutate({ id: notice.id, action: 'approve' }, { onSuccess: onClose })}>Approve</Button>
            <Button variant="danger" onClick={() => setRejecting(true)}>Reject</Button>
          </div>
        )}
        {!canApprove && notice.status === 'pending_approval' && <Alert tone="info" title="Awaiting an approver">Your role can review but not approve notices.</Alert>}
      </div>
      <Modal open={rejecting} onClose={() => setRejecting(false)} title="Reject notice" footer={<><Button variant="secondary" onClick={() => setRejecting(false)}>Cancel</Button><Button variant="danger" disabled={note.trim().length < 3} loading={act.isPending} onClick={() => act.mutate({ id: notice.id, action: 'reject', note }, { onSuccess: () => { setRejecting(false); onClose(); } })}>Reject</Button></>}>
        <label className="block text-sm"><span className="mb-1 block font-medium text-navy-900">Reviewer note</span><textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-24 w-full rounded-lg border border-line bg-surface p-3 text-base" /></label>
      </Modal>
    </Drawer>
  );
}
