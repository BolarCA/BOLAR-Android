'use client';
import { useState } from 'react';
import { useAudit, type AuditDto } from '@/lib/hooks/iam';
import { Badge, Button, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/** Audit report (Day 15): filter by action/outcome; payloads hidden unless audit:read_sensitive. */
export function AuditLog() {
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const q = useAudit({ action: action || undefined, outcome: outcome || undefined });
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of allow, deny, review-required and support-session events for this organization." />
      <div className="mb-4 grid max-w-xl gap-3 sm:grid-cols-2">
        <Input label="Action prefix" placeholder="e.g. auth., role., sensitive" value={action} onChange={(e) => setAction(e.target.value)} />
        <Select label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Any</option><option value="allow">allow</option><option value="deny">deny</option><option value="review_required">review_required</option><option value="error">error</option>
        </Select>
      </div>
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No audit events match', description: 'Adjust the filters or wait for activity.' }} onRetry={() => void q.refetch()}>
        {(d) => (
          <>
            <Table<AuditDto> caption="Audit events" rows={d.pages.flatMap((p) => p.items)} columns={[
              { key: 'time', header: 'When', render: (r) => <span className="whitespace-nowrap text-xs">{new Date(r.createdAt).toLocaleString()}</span> },
              { key: 'action', header: 'Action', render: (r) => <code className="text-xs">{r.action}</code> },
              { key: 'resource', header: 'Resource', render: (r) => <span className="text-xs">{r.resourceType}{r.resourceId ? ` · ${r.resourceId.slice(0, 10)}…` : ''}</span> },
              { key: 'outcome', header: 'Outcome', render: (r) => <Badge tone={statusTone(r.outcome)}>{r.outcome}</Badge> },
              { key: 'actor', header: 'Actor', render: (r) => <span className="text-xs">{r.actorId ? `${r.actorId.slice(0, 10)}…` : 'system'}</span> },
              { key: 'req', header: 'Request', render: (r) => <span className="text-xs text-muted">{r.requestId.slice(0, 8)}</span> },
            ]} />
            {q.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
    </>
  );
}
