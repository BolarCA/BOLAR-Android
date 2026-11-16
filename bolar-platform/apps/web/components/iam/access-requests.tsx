'use client';
import { useAuth } from '@/lib/auth';
import { useDecideAccess, useSensitiveAccessRequests, type SensitiveAccessDto } from '@/lib/hooks/iam';
import { Badge, Button, PageHeader, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/** Sensitive access review (Day 14/15): approvers decide; requesters see their own. */
export function AccessRequests() {
  const { me } = useAuth();
  const q = useSensitiveAccessRequests();
  const decide = useDecideAccess();
  const canApprove = me?.permissions.includes('sensitive_access:approve' as never);
  return (
    <>
      <PageHeader title="Sensitive access requests" description="Time-boxed access to confidential and restricted records. Approvals expire automatically and every read is audited." />
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No access requests', description: 'Requests appear when someone needs classified data.' }} onRetry={() => void q.refetch()}>
        {(d) => (
          <Table<SensitiveAccessDto> caption="Sensitive access requests" rows={d.pages.flatMap((p) => p.items)} columns={[
            { key: 'resource', header: 'Resource', render: (r) => <div><p className="font-medium">{r.resourceType}</p><p className="text-xs text-muted">{r.resourceId}</p></div> },
            { key: 'class', header: 'Classification', render: (r) => <Badge tone={r.classification === 'restricted' ? 'danger' : 'warning'}>{r.classification}</Badge> },
            { key: 'purpose', header: 'Purpose', render: (r) => <div><p>{r.purpose.replace(/_/g, ' ')}</p><p className="max-w-xs truncate text-xs text-muted" title={r.justification}>{r.justification}</p></div> },
            { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
            { key: 'expires', header: 'Expires', render: (r) => (r.expiresAt ? new Date(r.expiresAt).toLocaleString() : '—') },
            { key: 'actions', header: '', className: 'text-right', render: (r) => (canApprove && r.status === 'pending' && r.actorId !== me?.actor.id ? (
              <div className="flex justify-end gap-2">
                <Button onClick={() => decide.mutate({ id: r.id, decision: 'approved', ttlHours: 8 })} loading={decide.isPending}>Approve 8h</Button>
                <Button variant="secondary" onClick={() => decide.mutate({ id: r.id, decision: 'denied' })}>Deny</Button>
              </div>
            ) : null) },
          ]} />
        )}
      </StateView>
    </>
  );
}
