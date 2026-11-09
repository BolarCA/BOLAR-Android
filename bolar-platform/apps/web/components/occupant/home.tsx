'use client';
import Link from 'next/link';
import { useAuth, useCan } from '@/lib/auth';
import { useLeases, cents, day } from '@/lib/hooks/lease';
import { useWorkOrders, type WorkOrderDto } from '@/lib/hooks/maintenance';
import { useDocuments, type DocumentDto } from '@/lib/hooks/document';
import { Badge, Button, Card, KpiCard, PageHeader, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { PriorityBadge, SlaChip, StatusBadge } from '@/components/work-order-board/labels';

/**
 * Occupant home (blueprint p45): a reduced resident view. Occupants are not the lease holder, so there is no rent
 * or payment surface; they see their housing status, their own maintenance requests and documents shared with them.
 */
export function OccupantHome() {
  const { me } = useAuth();
  const canLease = useCan('lease:read');
  const canRequests = useCan('work_order:read');
  const leases = useLeases({}, canLease);
  const requests = useWorkOrders({ mine: 'true', includeCanceled: 'true' }, { limit: 50, enabled: canRequests });
  const documents = useDocuments({});
  const lease = leases.data?.pages.flatMap((p) => p.items).find((l) => ['active', 'renewal', 'signed'].includes(l.status)) ?? leases.data?.pages.flatMap((p) => p.items)[0];
  const requestRows = requests.data?.pages.flatMap((p) => p.items) ?? [];
  const openRequests = requestRows.filter((w) => !['complete', 'canceled'].includes(w.status));
  const docCount = documents.data?.pages.reduce((n, p) => n + p.items.length, 0);
  return (
    <>
      <PageHeader title={`Welcome, ${me?.actor.name.split(' ')[0] ?? 'there'}`} description="Your housing status, maintenance requests and shared documents. Questions about rent or the lease itself go to the lease holder or your property manager." actions={<Link href="/occupant/requests"><Button>New request</Button></Link>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Housing" value={canLease ? (leases.data ? (lease ? `Unit ${lease.unit.unitNumber}` : 'Not assigned') : '…') : '—'} hint={lease ? lease.status : 'awaiting lease link'} tone={lease ? statusTone(lease.status) : 'neutral'} />
        <KpiCard label="Open requests" value={canRequests ? (requests.data ? openRequests.length : '…') : '—'} hint={`${requestRows.length} total`} tone={openRequests.length ? 'info' : 'neutral'} />
        <KpiCard label="Documents" value={documents.data ? (docCount ?? 0) : '…'} hint="shared with you" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="My housing">
          <StateView isLoading={leases.isLoading} error={leases.error} data={leases.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void leases.refetch()}
            empty={{ title: 'No housing assigned yet', description: 'Once your property manager links you to a lease as an occupant, the unit, term and building details appear here.' }}>
            {() => lease ? (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted">Property</dt><dd className="font-medium">{lease.property.name}</dd><dd className="text-xs text-muted">{lease.property.city}, {lease.property.state}</dd></div>
                <div><dt className="text-muted">Unit</dt><dd className="font-medium">{lease.unit.unitNumber}</dd></div>
                <div><dt className="text-muted">Term</dt><dd className="font-medium">{day(lease.startDate)} – {day(lease.endDate)}</dd></div>
                <div><dt className="text-muted">Lease holder rent</dt><dd className="font-medium">{cents(lease.rentCents)}/mo</dd><dd className="text-xs text-muted">paid by the lease holder</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted">People on the lease</dt><dd className="mt-1 flex flex-wrap gap-1">{lease.parties.map((p) => <Badge key={p.id} tone={p.role === 'occupant' ? 'info' : 'neutral'}>{p.displayName} · {p.role.replace(/_/g, ' ')}</Badge>)}</dd></div>
              </dl>
            ) : null}
          </StateView>
        </Card>
        <Card title="My requests" actions={<Link href="/occupant/requests" className="text-sm text-cobalt-600 underline">All requests</Link>}>
          <StateView isLoading={requests.isLoading} error={requests.error} data={requests.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void requests.refetch()}
            empty={{ title: 'No requests yet', description: 'Report something that needs fixing and track it here.', action: <Link href="/occupant/requests"><Button variant="secondary">New request</Button></Link> }}>
            {() => <Table<WorkOrderDto> caption="My maintenance requests" rows={requestRows.slice(0, 6)} columns={[
              { key: 'title', header: 'Request', render: (w) => <div><p className="font-medium">{w.title}</p><p className="text-xs text-muted">{w.number}</p></div> },
              { key: 'priority', header: 'Priority', render: (w) => <PriorityBadge priority={w.priority} /> },
              { key: 'status', header: 'Status', render: (w) => <StatusBadge status={w.status} /> },
              { key: 'sla', header: 'Target', render: (w) => <SlaChip slaDueAt={w.slaDueAt} overdue={w.overdue} status={w.status} completedAt={w.completedAt} /> },
            ]} />}
          </StateView>
        </Card>
      </div>
      <Card title="Documents shared with me" className="mt-6" actions={<Link href="/occupant/documents" className="text-sm text-cobalt-600 underline">All documents</Link>}>
        <StateView isLoading={documents.isLoading} error={documents.error} data={documents.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void documents.refetch()}
          empty={{ title: 'No documents yet', description: 'House rules, move-in checklists and notices shared with you will appear here.' }}>
          {(d) => <Table<DocumentDto> caption="Shared documents" rows={d.pages.flatMap((p) => p.items).slice(0, 6)} columns={[
            { key: 'title', header: 'Title', render: (x) => <span className="font-medium">{x.title}</span> },
            { key: 'category', header: 'Category', render: (x) => <Badge>{x.category}</Badge> },
            { key: 'created', header: 'Added', render: (x) => day(x.createdAt) },
          ]} />}
        </StateView>
      </Card>
    </>
  );
}
