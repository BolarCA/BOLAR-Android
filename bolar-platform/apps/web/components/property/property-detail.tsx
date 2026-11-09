'use client';
import Link from 'next/link';
import { useState } from 'react';
import { UNIT_STATUSES } from '@bolar/contracts';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useArchiveProperty, useCreateBuilding, useProperty, useUnits, useUpdateProperty, formatCents, humanize, type UnitDto } from '@/lib/hooks/property';
import { Alert, Badge, Button, Card, Input, KpiCard, Modal, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { UnitFormDrawer } from './unit-form-drawer';
import { UnitStatusModal } from './unit-status-modal';
import { HierarchyView } from './hierarchy-view';

/**
 * Day 18 property detail: KPIs by unit status, units table with create drawer + status modal, buildings,
 * hierarchy view. The same component renders read-only for the owner portal; the API enforces access and the
 * StateView shows the denied state when a landlord opens a property they do not own.
 */
export function PropertyDetail({ id, basePath, readOnly = false }: { id: string; basePath: string; readOnly?: boolean }) {
  const canWriteProperty = useCan('property:write') && !readOnly;
  const canWriteUnit = useCan('unit:write') && !readOnly;
  const prop = useProperty(id);
  const [tab, setTab] = useState<'units' | 'hierarchy'>('units');
  const [unitFilters, setUnitFilters] = useState({ status: '', q: '' });
  const units = useUnits(id, { status: unitFilters.status || undefined, q: unitFilters.q || undefined });
  const [unitOpen, setUnitOpen] = useState(false);
  const [statusUnit, setStatusUnit] = useState<UnitDto | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [buildingName, setBuildingName] = useState('');
  const update = useUpdateProperty(id);
  const archive = useArchiveProperty(id);
  const addBuilding = useCreateBuilding(id);

  return (
    <StateView isLoading={prop.isLoading} error={prop.error} data={prop.data} onRetry={() => void prop.refetch()} skeleton="detail">
      {(p) => {
        const archived = p.status === 'archived';
        return (
          <>
            <nav aria-label="Back" className="mb-3 text-sm"><Link href={basePath} className="text-cobalt-600 hover:underline">← All properties</Link></nav>
            <PageHeader title={p.name} description={`${p.addressLine1}${p.addressLine2 ? `, ${p.addressLine2}` : ''}, ${p.city}, ${p.state} ${p.postalCode}${p.county ? ` · ${p.county} County` : ''}`}
              actions={<div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
                <Badge>{p.propertyType}</Badge>
                {p.portfolio && <Badge tone="violet">{p.portfolio.name}</Badge>}
                {canWriteUnit && !archived && <Button onClick={() => setUnitOpen(true)}>Add unit</Button>}
                {canWriteProperty && !archived && <Button variant="danger" onClick={() => setArchiveOpen(true)}>Archive</Button>}
              </div>} />

            <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Units" value={p.unitCounts.total} hint={`${p.buildings.length} building${p.buildings.length === 1 ? '' : 's'}`} />
              <KpiCard label="Occupied" value={p.unitCounts.occupied} hint={p.unitCounts.total ? `${Math.round((p.unitCounts.occupied / p.unitCounts.total) * 100)}% occupancy` : 'no units'} tone="success" />
              <KpiCard label="Vacant" value={p.unitCounts.vacant} hint={`${p.unitCounts.reserved} reserved`} tone={p.unitCounts.reserved ? 'info' : 'neutral'} />
              <KpiCard label="On notice" value={p.unitCounts.notice} hint={`${p.unitCounts.make_ready} make ready · ${p.unitCounts.down} down`} tone="info" />
            </div>

            {canWriteProperty && !archived && (
              <Card title="Property status" className="mb-6">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-48">
                    <Select id="property-status" label="Lifecycle status" value={p.status} onChange={(e) => update.mutate({ status: e.target.value })}>
                      <option value="onboarding">onboarding</option><option value="active">active</option><option value="inactive">inactive</option>
                    </Select>
                  </div>
                  {update.isPending && <span className="text-sm text-muted" role="status">Saving…</span>}
                  {update.isError && <Alert tone="danger" title={update.error instanceof ApiError ? update.error.message : 'Update failed'} />}
                </div>
              </Card>
            )}

            <div role="group" aria-label="Detail view" className="mb-4 flex gap-1 rounded-lg border border-line p-1 w-fit">
              <Button type="button" variant={tab === 'units' ? 'primary' : 'ghost'} aria-pressed={tab === 'units'} onClick={() => setTab('units')}>Units</Button>
              <Button type="button" variant={tab === 'hierarchy' ? 'primary' : 'ghost'} aria-pressed={tab === 'hierarchy'} onClick={() => setTab('hierarchy')}>Hierarchy</Button>
            </div>

            {tab === 'units' ? (
              <section aria-labelledby="units-heading" className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <h2 id="units-heading" className="mr-auto text-base font-semibold text-navy-900">Units</h2>
                  <div className="w-44"><Input id="unit-filter-q" label="Unit number" value={unitFilters.q} onChange={(e) => setUnitFilters((f) => ({ ...f, q: e.target.value }))} /></div>
                  <div className="w-44">
                    <Select id="unit-filter-status" label="Unit status" value={unitFilters.status} onChange={(e) => setUnitFilters((f) => ({ ...f, status: e.target.value }))}>
                      <option value="">Any</option>
                      {UNIT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                    </Select>
                  </div>
                </div>
                <StateView isLoading={units.isLoading} error={units.error} data={units.data} isEmpty={(d) => d.pages.every((pg) => pg.items.length === 0)} onRetry={() => void units.refetch()}
                  empty={{ title: unitFilters.q || unitFilters.status ? 'No units match' : 'No units yet', description: 'Units carry occupancy status, target rent and availability. Leases attach to units.', action: canWriteUnit && !archived && <Button onClick={() => setUnitOpen(true)}>Add unit</Button> }}>
                  {(d) => (
                    <>
                      <Table<UnitDto> caption="Units" rows={d.pages.flatMap((pg) => pg.items)} columns={[
                        { key: 'unit', header: 'Unit', render: (u) => <span className="font-medium">{u.unitNumber}</span> },
                        { key: 'building', header: 'Building', render: (u) => <span className="text-muted">{p.buildings.find((b) => b.id === u.buildingId)?.name ?? '—'}</span> },
                        { key: 'layout', header: 'Beds / baths', render: (u) => <span>{u.bedrooms ?? '—'} / {u.bathrooms ?? '—'}</span> },
                        { key: 'sqft', header: 'Sq ft', render: (u) => <span className="tabular-nums">{u.squareFeet?.toLocaleString() ?? '—'}</span> },
                        { key: 'rent', header: 'Target rent', render: (u) => <span className="tabular-nums">{formatCents(u.targetRentCents)}</span> },
                        { key: 'status', header: 'Status', render: (u) => <Badge tone={statusTone(u.status)}>{humanize(u.status)}</Badge> },
                        { key: 'available', header: 'Available', render: (u) => <span className="text-xs">{u.availableFrom ? new Date(u.availableFrom).toLocaleDateString() : '—'}</span> },
                        { key: 'actions', header: '', className: 'text-right', render: (u) => canWriteUnit && !archived ? <Button variant="secondary" onClick={() => setStatusUnit(u)} aria-label={`Change status of unit ${u.unitNumber}`}>Change status</Button> : null },
                      ]} />
                      {units.hasNextPage && <div><Button variant="secondary" onClick={() => void units.fetchNextPage()} loading={units.isFetchingNextPage}>Load more</Button></div>}
                    </>
                  )}
                </StateView>
              </section>
            ) : (
              <Card title="Hierarchy"><HierarchyView propertyId={id} /></Card>
            )}

            <Card title="Buildings" className="mt-6">
              {p.buildings.length === 0 ? <p className="text-sm text-muted">No buildings recorded. Units can exist without a building.</p> : (
                <ul className="divide-y divide-line">
                  {p.buildings.map((b) => <li key={b.id} className="flex items-center justify-between py-2 text-sm"><span className="font-medium">{b.name ?? 'Building'}</span><span className="text-muted">{b.unitCount ?? 0} units{b.floors ? ` · ${b.floors} floors` : ''}</span></li>)}
                </ul>
              )}
              {canWriteProperty && !archived && (
                <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); addBuilding.mutate({ name: buildingName || undefined }, { onSuccess: () => setBuildingName('') }); }}>
                  <div className="w-60"><Input id="building-name" label="New building name" maxLength={120} value={buildingName} onChange={(e) => setBuildingName(e.target.value)} /></div>
                  <Button type="submit" variant="secondary" loading={addBuilding.isPending}>Add building</Button>
                  {addBuilding.isError && <Alert tone="danger" title={addBuilding.error instanceof ApiError ? addBuilding.error.message : 'Could not add building'} />}
                </form>
              )}
            </Card>

            {canWriteUnit && <UnitFormDrawer propertyId={id} buildings={p.buildings} open={unitOpen} onClose={() => setUnitOpen(false)} />}
            {canWriteUnit && <UnitStatusModal propertyId={id} unit={statusUnit} onClose={() => setStatusUnit(null)} />}
            {canWriteProperty && (
              <Modal open={archiveOpen} onClose={() => setArchiveOpen(false)} title={`Archive ${p.name}?`}
                footer={<><Button variant="secondary" onClick={() => setArchiveOpen(false)}>Cancel</Button><Button variant="danger" loading={archive.isPending} onClick={() => archive.mutate(undefined, { onSuccess: () => setArchiveOpen(false) })}>Archive property</Button></>}>
                <p className="text-sm text-ink">Archived properties are hidden from lists and become read-only. Archiving is blocked while any unit is occupied, on notice or reserved. This action is audited.</p>
                {archive.isError && <div className="mt-3"><Alert tone="danger" title={archive.error instanceof ApiError ? archive.error.message : 'Could not archive'} /></div>}
              </Modal>
            )}
          </>
        );
      }}
    </StateView>
  );
}
