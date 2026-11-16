'use client';
import { useState } from 'react';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useAgencyAction, useAgencyRequests, type AgencyRequestDto } from '@/lib/hooks/legal';
import { Alert, Badge, Button, Card, Input, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { dueLabel, fmtDate, humanize } from './util';

/** p34 "request review gate": counsel runs legal review (minimization notes) and decides; the requester can never approve. */
export function AgencyReview() {
  const { me } = useAuth();
  const canApprove = useCan('agency_request:approve');
  const q = useAgencyRequests();
  const act = useAgencyAction();
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!canApprove) return null;
  const noteFor = (id: string) => notes[id] ?? '';
  return (
    <Card title="Agency and law-enforcement requests" className="mt-8">
      <p className="mb-3 text-xs text-muted">Law-enforcement production requires a legal reference and counsel approval. Approval opens a gated export job; nothing is produced until that export is separately approved.</p>
      {act.isError && <div className="mb-3"><Alert tone="danger" title={act.error instanceof ApiError ? act.error.message : 'Action failed'} /></div>}
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No agency requests', description: 'Government users submit requests from the restricted portal.' }} onRetry={() => void q.refetch()}>
        {(d) => (
          <Table<AgencyRequestDto> caption="Agency requests" rows={d.pages.flatMap((p) => p.items)} columns={[
            { key: 'agency', header: 'Request', render: (r) => <div><p className="font-medium">{r.agencyName}</p><p className="max-w-sm text-xs text-muted" title={r.legalBasis}>{humanize(r.kind)}{r.scopeJson.legalReference ? ` · ${r.scopeJson.legalReference}` : ''} · {r.legalBasis.slice(0, 80)}{r.legalBasis.length > 80 ? '…' : ''}</p>{r.minimizationNotes && <p className="mt-1 text-xs"><span className="font-semibold">Minimization:</span> {r.minimizationNotes}</p>}</div> },
            { key: 'status', header: 'Status', render: (r) => <div className="flex flex-col gap-1"><Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>{r.kind === 'law_enforcement' && <Badge tone="danger">law enforcement</Badge>}</div> },
            { key: 'due', header: 'Due', render: (r) => <span className="text-xs">{fmtDate(r.dueAt)} <Badge tone={dueLabel(r.dueAt).tone}>{dueLabel(r.dueAt).text}</Badge></span> },
            { key: 'actions', header: 'Review', render: (r) => {
              if (r.requesterUserId === me?.actor.id) return <span className="text-xs text-muted">You submitted this request; another counsel must decide.</span>;
              if (r.status === 'received' || r.status === 'legal_review') return (
                <div className="flex min-w-64 flex-col gap-2">
                  <Input label={r.status === 'received' ? 'Minimization notes' : 'Decision note'} value={noteFor(r.id)} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                  <div className="flex flex-wrap gap-2">
                    {r.status === 'received' && <Button aria-label={`Legal review for ${r.agencyName}`} loading={act.isPending} onClick={() => act.mutate({ id: r.id, action: 'legal-review', body: { minimizationNotes: noteFor(r.id) } })}>Legal review</Button>}
                    {r.status === 'legal_review' && <>
                      <Button aria-label={`Approve ${r.agencyName}`} loading={act.isPending} onClick={() => act.mutate({ id: r.id, action: 'decide', body: { decision: 'approved', note: noteFor(r.id) || 'Approved after legal review' } })}>Approve</Button>
                      <Button variant="secondary" aria-label={`Deny ${r.agencyName}`} onClick={() => act.mutate({ id: r.id, action: 'decide', body: { decision: 'denied', note: noteFor(r.id) || 'Denied after legal review' } })}>Deny</Button>
                    </>}
                  </div>
                </div>
              );
              if (r.status === 'approved') return <Button variant="secondary" aria-label={`Mark ${r.agencyName} fulfilled`} loading={act.isPending} onClick={() => act.mutate({ id: r.id, action: 'fulfill', body: {} })}>Mark fulfilled</Button>;
              return <span className="text-xs text-muted">{humanize(r.status)}</span>;
            } },
          ]} />
        )}
      </StateView>
    </Card>
  );
}
