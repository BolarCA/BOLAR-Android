'use client';
import { useState } from 'react';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { cents, day, useLeases, useTransitionAnyLease, type LeaseDto } from '@/lib/hooks/lease';
import { Alert, Badge, Button, Modal, PageHeader, Table, statusTone } from '@/components/ui';
import { Denied, StateView } from '@/components/ui/state-view';

/** Landlord approvals queue (blueprint p39): leases in review with Approve / Reject (counsel note). The approver can never be the creator. */
export function ApprovalsQueue() {
  const { me } = useAuth();
  const canApprove = useCan('lease:approve');
  const q = useLeases({ status: 'review' }, canApprove);
  const act = useTransitionAnyLease();
  const [rejecting, setRejecting] = useState<LeaseDto | null>(null);
  const [note, setNote] = useState('');
  if (!canApprove) return <Denied />;
  return (
    <>
      <PageHeader title="Lease approvals" description="Leases submitted for review. Approving is a human gate; you cannot approve a lease you drafted yourself. Rejections return the lease to draft with your note." />
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void q.refetch()} empty={{ title: 'Nothing awaiting approval', description: 'Leases appear here when a manager submits them for review.' }}>
        {(d) => (
          <Table<LeaseDto> caption="Leases awaiting approval" rows={d.pages.flatMap((p) => p.items)} columns={[
            { key: 'unit', header: 'Property / unit', render: (l) => <div><p className="font-medium">{l.property.name}</p><p className="text-xs text-muted">Unit {l.unit.unitNumber} · {l.unit.status}</p></div> },
            { key: 'tenant', header: 'Parties', render: (l) => (l.parties.length ? l.parties.map((p) => `${p.displayName} (${p.role.replace(/_/g, ' ')})`).join(', ') : <span className="text-muted">none</span>) },
            { key: 'term', header: 'Term', render: (l) => <span className="whitespace-nowrap">{day(l.startDate)} – {day(l.endDate)}</span> },
            { key: 'rent', header: 'Rent / deposit', render: (l) => <span className="whitespace-nowrap">{cents(l.rentCents)} / {cents(l.depositCents)}</span> },
            { key: 'status', header: 'Status', render: (l) => <Badge tone={statusTone(l.status)}>{l.status}</Badge> },
            { key: 'actions', header: '', className: 'text-right', render: (l) => (
              l.createdBy === me?.actor.id ? <Badge tone="neutral">you drafted this</Badge> : (
                <div className="flex justify-end gap-2">
                  <Button onClick={() => act.mutate({ id: l.id, to: 'approved' })} loading={act.isPending && act.variables?.id === l.id} aria-label={`Approve lease for unit ${l.unit.unitNumber}`}>Approve</Button>
                  <Button variant="secondary" onClick={() => { setRejecting(l); setNote(''); }} aria-label={`Reject lease for unit ${l.unit.unitNumber}`}>Reject</Button>
                </div>
              )
            ) },
          ]} />
        )}
      </StateView>
      {act.isError && <div className="mt-4"><Alert tone={act.error instanceof ApiError && act.error.status === 409 ? 'warning' : 'danger'} title={act.error instanceof ApiError ? act.error.message : 'Action failed'} /></div>}
      {rejecting && (
        <Modal open onClose={() => setRejecting(null)} title={`Reject lease · Unit ${rejecting.unit.unitNumber}`} footer={<><Button variant="secondary" onClick={() => setRejecting(null)}>Cancel</Button><Button variant="danger" disabled={note.trim().length < 3} loading={act.isPending} onClick={() => act.mutate({ id: rejecting.id, to: 'draft', note }, { onSuccess: () => setRejecting(null) })}>Send back to draft</Button></>}>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Counsel / approver note</span>
            <textarea required minLength={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-28 w-full rounded-lg border border-line bg-surface p-3 text-base" placeholder="Explain what must change before approval." />
          </label>
        </Modal>
      )}
    </>
  );
}
