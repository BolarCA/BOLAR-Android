'use client';
import Link from 'next/link';
import { useState } from 'react';
import { PROPERTY_STATUSES } from '@bolar/contracts';
import { useCan } from '@/lib/auth';
import { useProperties, humanize, type PropertyDto } from '@/lib/hooks/property';
import { Badge, Button, Input, PageHeader, Select, Table, cn, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { PropertyFormDrawer } from './property-form-drawer';

/**
 * Day 18 property list, shared by /manager/properties (full) and /owner/properties (read-only).
 * Filters map 1:1 to GET /properties query params; the API applies tenant + relationship scoping.
 */
export function PropertiesList({ basePath, readOnly = false, title, description }: { basePath: string; readOnly?: boolean; title: string; description: string }) {
  const canWrite = useCan('property:write') && !readOnly;
  const [filters, setFilters] = useState({ q: '', status: '', city: '', state: '' });
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [createOpen, setCreateOpen] = useState(false);
  const list = useProperties({ q: filters.q || undefined, status: filters.status || undefined, city: filters.city || undefined, state: filters.state || undefined });
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const occupancy = (p: PropertyDto) => (p.unitCounts ? `${p.unitCounts.occupied + p.unitCounts.notice}/${p.unitCounts.total}` : '—');

  return (
    <>
      <PageHeader title={title} description={description} actions={canWrite && <Button onClick={() => setCreateOpen(true)}>Add property</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64"><Input id="filter-q" label="Search" placeholder="Name, address or city" value={filters.q} onChange={set('q')} /></div>
        <div className="w-40">
          <Select id="filter-status" label="Status" value={filters.status} onChange={set('status')}>
            <option value="">Any active</option>
            {PROPERTY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <div className="w-40"><Input id="filter-city" label="City" value={filters.city} onChange={set('city')} /></div>
        <div className="w-24"><Input id="filter-state" label="State" maxLength={2} placeholder="TX" value={filters.state} onChange={set('state')} /></div>
        <div role="group" aria-label="View" className="ml-auto flex gap-1 rounded-lg border border-line p-1">
          <Button type="button" variant={view === 'table' ? 'primary' : 'ghost'} aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</Button>
          <Button type="button" variant={view === 'cards' ? 'primary' : 'ghost'} aria-pressed={view === 'cards'} onClick={() => setView('cards')}>Cards</Button>
        </div>
      </div>

      <StateView isLoading={list.isLoading} error={list.error} data={list.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void list.refetch()} skeleton={view === 'cards' ? 'cards' : 'list'}
        empty={{ title: filters.q || filters.status || filters.city || filters.state ? 'No properties match these filters' : readOnly ? 'No properties are shared with you yet' : 'No properties yet', description: readOnly ? 'Properties appear here once your property manager records you as the owner.' : 'Add your first property to start tracking units, leases and work orders.', action: canWrite && <Button onClick={() => setCreateOpen(true)}>Add property</Button> }}>
        {(d) => {
          const rows = d.pages.flatMap((p) => p.items);
          return (
            <>
              {view === 'table' ? (
                <Table<PropertyDto> caption="Properties" rows={rows} columns={[
                  { key: 'name', header: 'Property', render: (p) => <div><Link href={`${basePath}/${p.id}`} className="font-medium text-cobalt-600 hover:underline">{p.name}</Link><p className="text-xs text-muted">{p.addressLine1}</p></div> },
                  { key: 'location', header: 'Location', render: (p) => <span>{p.city}, {p.state} {p.postalCode}</span> },
                  { key: 'type', header: 'Type', render: (p) => <span className="capitalize">{p.propertyType}</span> },
                  { key: 'units', header: 'Occupied / units', render: (p) => <span className="tabular-nums">{occupancy(p)}</span> },
                  { key: 'status', header: 'Status', render: (p) => <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge> },
                ]} />
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Properties">
                  {rows.map((p) => (
                    <li key={p.id} className={cn('rounded-[14px] border border-line bg-surface p-5 shadow-sm')}>
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`${basePath}/${p.id}`} className="text-base font-semibold text-navy-900 hover:underline">{p.name}</Link>
                        <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted">{p.addressLine1}, {p.city}, {p.state} {p.postalCode}</p>
                      <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                        <div><dt className="text-xs text-muted">Units</dt><dd className="font-semibold">{p.unitCounts?.total ?? 0}</dd></div>
                        <div><dt className="text-xs text-muted">Occupied</dt><dd className="font-semibold">{p.unitCounts?.occupied ?? 0}</dd></div>
                        <div><dt className="text-xs text-muted">Vacant</dt><dd className="font-semibold">{p.unitCounts?.vacant ?? 0}</dd></div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
              {list.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>Load more</Button></div>}
            </>
          );
        }}
      </StateView>
      {canWrite && <PropertyFormDrawer open={createOpen} onClose={() => setCreateOpen(false)} />}
    </>
  );
}
