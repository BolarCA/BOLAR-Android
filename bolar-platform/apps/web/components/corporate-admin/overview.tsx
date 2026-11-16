'use client';
import Link from 'next/link';
import { useAuth, useCan } from '@/lib/auth';
import { useTenantProfiles, type TenantProfileDto } from '@/lib/hooks/tenant-profile';
import { useLeases, cents, day, type LeaseDto } from '@/lib/hooks/lease';
import { useDocuments, type DocumentDto } from '@/lib/hooks/document';
import { Badge, Button, Card, KpiCard, PageHeader, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/**
 * Corporate tenant admin (blueprint p44): employee housing at a glance. The API scopes leases to the ones the
 * business account is a party to and tenant profiles to the org, so this screen reads existing endpoints only.
 */
export function CorporateOverview() {
  const { me } = useAuth();
  const canProfiles = useCan('tenant_profile:read');
  const canLeases = useCan('lease:read');
  const canDocs = useCan('document:read');
  const occupants = useTenantProfiles({ kind: 'occupant' }, canProfiles);
  const corporate = useTenantProfiles({ kind: 'corporate' }, canProfiles);
  const leases = useLeases({}, canLeases);
  const documents = useDocuments({});
  const occupantRows = occupants.data?.pages.flatMap((p) => p.items) ?? [];
  const leaseRows = leases.data?.pages.flatMap((p) => p.items) ?? [];
  const activeLeases = leaseRows.filter((l) => ['active', 'renewal', 'signed'].includes(l.status));
  const monthly = activeLeases.reduce((n, l) => n + l.rentCents, 0);
  return (
    <>
      <PageHeader title="Corporate housing overview" description={`Employee housing managed for ${me?.org.name ?? 'your organization'}: occupants, the leases that house them and the documents behind each placement.`} actions={<Link href="/corporate-admin/occupants"><Button variant="secondary">Occupants</Button></Link>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Occupants" value={canProfiles ? (occupants.data ? occupantRows.length : '…') : '—'} hint={`${occupantRows.filter((o) => o.status === 'active').length} housed`} tone="info" />
        <KpiCard label="Corporate accounts" value={canProfiles ? (corporate.data ? corporate.data.pages.reduce((n, p) => n + p.items.length, 0) : '…') : '—'} hint="sponsor profiles" />
        <KpiCard label="Active leases" value={canLeases ? (leases.data ? activeLeases.length : '…') : '—'} hint={`${leaseRows.length - activeLeases.length} in progress`} tone={activeLeases.length ? 'success' : 'neutral'} />
        <KpiCard label="Monthly spend" value={canLeases ? (leases.data ? cents(monthly) : '…') : '—'} hint="committed rent" tone="violet" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Occupants" actions={<Link href="/corporate-admin/occupants" className="text-sm text-cobalt-600 underline">All occupants</Link>}>
          <StateView isLoading={occupants.isLoading} error={occupants.error} data={occupants.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void occupants.refetch()}
            empty={{ title: 'No occupants yet', description: 'Occupants appear here once your property manager links employees to a corporate lease.' }}>
            {() => <OccupantTable rows={occupantRows.slice(0, 8)} />}
          </StateView>
        </Card>
        <Card title="Leases">
          <StateView isLoading={leases.isLoading} error={leases.error} data={leases.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void leases.refetch()}
            empty={{ title: 'No leases yet', description: 'Leases where your business account is the sponsor will be listed with their status and monthly rent.' }}>
            {() => <Table<LeaseDto> caption="Corporate leases" rows={leaseRows.slice(0, 8)} columns={[
              { key: 'unit', header: 'Unit', render: (l) => <div><p className="font-medium">{l.property.name}</p><p className="text-xs text-muted">Unit {l.unit.unitNumber} · {l.property.city}, {l.property.state}</p></div> },
              { key: 'status', header: 'Status', render: (l) => <Badge tone={statusTone(l.status)}>{l.status}</Badge> },
              { key: 'term', header: 'Term', render: (l) => <span className="text-xs">{day(l.startDate)} – {day(l.endDate)}</span> },
              { key: 'rent', header: 'Rent', render: (l) => cents(l.rentCents) },
            ]} />}
          </StateView>
        </Card>
      </div>
      <Card title="Documents" className="mt-6">
        <StateView isLoading={documents.isLoading} error={documents.error} data={documents.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void documents.refetch()}
          empty={{ title: 'No documents shared yet', description: canDocs ? 'Lease agreements and housing policies shared with your account will appear here.' : 'Your role does not include document access.' }}>
          {(d) => <Table<DocumentDto> caption="Shared documents" rows={d.pages.flatMap((p) => p.items).slice(0, 8)} columns={[
            { key: 'title', header: 'Title', render: (x) => <span className="font-medium">{x.title}</span> },
            { key: 'category', header: 'Category', render: (x) => <Badge>{x.category}</Badge> },
            { key: 'classification', header: 'Classification', render: (x) => <Badge tone={x.gated ? 'violet' : 'neutral'}>{x.classification}</Badge> },
            { key: 'created', header: 'Added', render: (x) => day(x.createdAt) },
          ]} />}
        </StateView>
      </Card>
    </>
  );
}

function OccupantTable({ rows }: { rows: TenantProfileDto[] }) {
  return (
    <Table<TenantProfileDto> caption="Occupants" rows={rows} columns={[
      { key: 'name', header: 'Occupant', render: (o) => <div><p className="font-medium">{o.displayName}</p>{o.email && <p className="text-xs text-muted">{o.email}</p>}</div> },
      { key: 'status', header: 'Status', render: (o) => <Badge tone={statusTone(o.status)}>{o.status}</Badge> },
      { key: 'since', header: 'Since', render: (o) => day(o.createdAt) },
    ]} />
  );
}

/** Full occupant roster for the corporate admin. */
export function CorporateOccupants() {
  const canProfiles = useCan('tenant_profile:read');
  const occupants = useTenantProfiles({ kind: 'occupant' }, canProfiles);
  return (
    <>
      <PageHeader title="Occupants" description="Employees housed under your corporate leases. Contact details beyond name and email require an approved purpose." />
      <StateView isLoading={occupants.isLoading} error={occupants.error} data={occupants.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void occupants.refetch()}
        empty={{ title: 'No occupants yet', description: 'Occupants appear here once your property manager links employees to a corporate lease.' }}>
        {(d) => (
          <>
            <OccupantTable rows={d.pages.flatMap((p) => p.items)} />
            {occupants.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void occupants.fetchNextPage()} loading={occupants.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
    </>
  );
}
