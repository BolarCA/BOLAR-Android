'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LEASE_STATES } from '@bolar/contracts';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { cents, day, useCreateLease, useLeaseFormOptions, useLeases, type LeaseDto } from '@/lib/hooks/lease';
import { useTenantProfiles } from '@/lib/hooks/tenant-profile';
import { Alert, Badge, Button, Drawer, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/** Day 24 staff lease list with status filter and the create drawer (property -> unit -> tenant pickers). */
export function LeasesList() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const canWrite = useCan('lease:write');
  const list = useLeases({ status: status || undefined });
  return (
    <>
      <PageHeader title="Leases" description="Draft, review, approve, send for signature and activate leases. Overlapping occupancy on a unit is blocked." actions={canWrite && <Button onClick={() => setOpen(true)}>New lease</Button>} />
      <div className="mb-4 max-w-xs">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {LEASE_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <StateView isLoading={list.isLoading} error={list.error} data={list.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void list.refetch()}
        empty={{ title: status ? `No ${status} leases` : 'No leases yet', description: 'Create a draft lease for a vacant unit to get started.', action: canWrite && <Button onClick={() => setOpen(true)}>New lease</Button> }}>
        {(d) => (
          <>
            <Table<LeaseDto> caption="Leases" rows={d.pages.flatMap((p) => p.items)} onRowClick={(r) => router.push(`/manager/leases/${r.id}`)} columns={[
              { key: 'unit', header: 'Property / unit', render: (l) => <a className="font-medium text-cobalt-600 underline-offset-2 hover:underline" href={`/manager/leases/${l.id}`} onClick={(e) => e.stopPropagation()}>{l.property.name} · {l.unit.unitNumber}</a> },
              { key: 'tenant', header: 'Parties', render: (l) => (l.parties.length ? l.parties.map((p) => p.displayName).join(', ') : <span className="text-muted">none</span>) },
              { key: 'term', header: 'Term', render: (l) => <span className="whitespace-nowrap">{day(l.startDate)} – {day(l.endDate)}</span> },
              { key: 'rent', header: 'Rent', render: (l) => cents(l.rentCents) },
              { key: 'status', header: 'Status', render: (l) => <Badge tone={statusTone(l.status)}>{l.status}</Badge> },
            ]} />
            {list.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      <CreateLeaseDrawer open={open} onClose={() => setOpen(false)} onCreated={(id) => router.push(`/manager/leases/${id}`)} />
    </>
  );
}

const firstOfNextMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };
const plusOneYear = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };

/** Parse "key: value" lines into lease terms. */
export function parseTerms(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function CreateLeaseDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const options = useLeaseFormOptions(open);
  const create = useCreateLease();
  const [propertyId, setPropertyId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [tenantQ, setTenantQ] = useState('');
  const [tenantProfileId, setTenantProfileId] = useState('');
  const [startDate, setStartDate] = useState(firstOfNextMonth());
  const [endDate, setEndDate] = useState(plusOneYear(firstOfNextMonth()));
  const [rent, setRent] = useState('');
  const [deposit, setDeposit] = useState('');
  const [terms, setTerms] = useState('term: 12 months\npets: none\nutilities: tenant pays electric');
  const tenants = useTenantProfiles({ q: tenantQ || undefined }, open);
  const property = options.data?.properties.find((p) => p.id === propertyId);
  const unit = property?.units.find((u) => u.id === unitId);
  const tenantRows = useMemo(() => tenants.data?.pages.flatMap((p) => p.items) ?? [], [tenants.data]);
  const fieldError = (path: string) => (create.error instanceof ApiError ? create.error.body.fieldErrors?.find((f) => f.path.endsWith(path))?.message : undefined);

  return (
    <Drawer open={open} onClose={onClose} title="New lease">
      <StateView isLoading={options.isLoading} error={options.error} data={options.data} isEmpty={(d) => d.properties.length === 0} empty={{ title: 'No properties available', description: 'You need a property with units before drafting a lease.' }}>
        {(d) => (
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ propertyId, unitId, startDate, endDate, rentCents: Math.round(Number(rent) * 100), depositCents: Math.round(Number(deposit || 0) * 100), ...(tenantProfileId ? { tenantProfileId } : {}), termsJson: parseTerms(terms) }, {
              onSuccess: (lease) => { onClose(); onCreated?.(lease.id); },
            });
          }}>
            <Select label="Property" required value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setUnitId(''); const p = d.properties.find((x) => x.id === e.target.value); if (p?.units[0]) setRent((p.units[0].targetRentCents / 100).toFixed(2)); }}>
              <option value="">Select a property</option>
              {d.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Select label="Unit" required value={unitId} disabled={!property} onChange={(e) => { setUnitId(e.target.value); const u = property?.units.find((x) => x.id === e.target.value); if (u) setRent((u.targetRentCents / 100).toFixed(2)); }}>
              <option value="">{property ? 'Select a unit' : 'Choose a property first'}</option>
              {property?.units.map((u) => <option key={u.id} value={u.id}>{u.unitNumber} · {u.status}</option>)}
            </Select>
            {unit && unit.status !== 'vacant' && <Alert tone="warning" title={`Unit ${unit.unitNumber} is ${unit.status}`}>Drafting is allowed, but approval is blocked while another lease occupies these dates.</Alert>}
            <Input label="Find tenant" placeholder="Search by name or email" value={tenantQ} onChange={(e) => setTenantQ(e.target.value)} />
            <Select label="Primary tenant" value={tenantProfileId} onChange={(e) => setTenantProfileId(e.target.value)}>
              <option value="">No tenant yet (add later)</option>
              {tenantRows.map((t) => <option key={t.id} value={t.id}>{t.displayName} · {t.status}</option>)}
            </Select>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Start date" type="date" required value={startDate} onChange={(e) => { setStartDate(e.target.value); if (e.target.value) setEndDate(plusOneYear(e.target.value)); }} error={fieldError('startDate')} />
              <Input label="End date" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} error={fieldError('endDate')} />
              <Input label="Monthly rent (USD)" type="number" min={1} step="0.01" required value={rent} onChange={(e) => setRent(e.target.value)} error={fieldError('rentCents')} />
              <Input label="Security deposit (USD)" type="number" min={0} step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} error={fieldError('depositCents')} />
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-navy-900">Terms (one “key: value” per line)</span>
              <textarea value={terms} onChange={(e) => setTerms(e.target.value)} className="min-h-24 w-full rounded-lg border border-line bg-surface p-3 font-mono text-sm" />
            </label>
            {create.isError && <Alert tone={create.error instanceof ApiError && create.error.status === 409 ? 'warning' : 'danger'} title={create.error instanceof ApiError ? create.error.message : 'Could not create the lease'} />}
            <div className="flex gap-2"><Button type="submit" loading={create.isPending} disabled={!propertyId || !unitId}>Create draft</Button><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button></div>
          </form>
        )}
      </StateView>
    </Drawer>
  );
}
