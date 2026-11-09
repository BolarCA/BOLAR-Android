'use client';
import { useId, useState, type ReactNode } from 'react';
import type { UseInfiniteQueryResult } from '@tanstack/react-query';
import { useCan } from '@/lib/auth';
import { fmtCents, fmtPct, useRefreshReports, type ReportKpisDto } from '@/lib/hooks/reporting';
import { Badge, Button, KpiCard, Select } from '@/components/ui';
import { useProperties } from '@/lib/hooks/property';

/** "Data as of" badge plus a refresh button for staff. Every report screen shows how old the governed views are. */
export function FreshnessBadge({ refreshedAt, staleSeconds, canRefresh }: { refreshedAt: string | null | undefined; staleSeconds?: number | null; canRefresh: boolean }) {
  const refresh = useRefreshReports();
  const stale = staleSeconds ?? (refreshedAt ? Math.round((Date.now() - new Date(refreshedAt).getTime()) / 1000) : null);
  const label = refreshedAt ? `Data as of ${new Date(refreshedAt).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}` : 'Freshness unknown';
  const age = stale === null ? '' : stale < 90 ? 'just now' : stale < 3600 ? `${Math.round(stale / 60)} min ago` : `${Math.round(stale / 3600)} h ago`;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="reports-freshness" data-refreshed-at={refreshedAt ?? ''}>
      <Badge tone={stale !== null && stale > 3600 ? 'warning' : 'success'}>{label}{age ? ` (${age})` : ''}</Badge>
      {canRefresh && <Button variant="secondary" onClick={() => refresh.mutate()} loading={refresh.isPending} aria-label="Refresh data">Refresh data</Button>}
      {refresh.isSuccess && <span role="status" className="text-xs text-muted">Refreshed in {refresh.data.durationMs} ms</span>}
      {refresh.isError && <span role="alert" className="text-xs text-danger-600">Refresh failed</span>}
    </div>
  );
}

export type KpiVariant = 'finance' | 'owner' | 'manager';

/** Headline KPI strip; each portal shows the subset that matters to its role (metrics in docs/metrics-definitions.md). */
export function KpiStrip({ k, variant }: { k: ReportKpisDto; variant: KpiVariant }) {
  const cards: ReactNode[] = [];
  if (variant !== 'manager') {
    cards.push(<KpiCard key="rent" label="Monthly rent roll" value={fmtCents(k.rentRoll.monthlyRentCents)} hint={`${k.rentRoll.activeLeases} active lease${k.rentRoll.activeLeases === 1 ? '' : 's'}`} tone="info" />);
  }
  if (variant === 'finance') {
    cards.push(<KpiCard key="ar" label="Open receivables" value={fmtCents(k.arAging.balanceCents)} hint={`${k.arAging.openInvoices} open · ${fmtCents(k.arAging.overdueCents)} past due`} tone={k.arAging.overdueCents ? 'danger' : 'success'} />);
  }
  cards.push(<KpiCard key="occ" label="Occupancy" value={fmtPct(k.occupancy.occupancyPct)} hint={`${k.occupancy.occupiedUnits} of ${k.occupancy.totalUnits} units`} tone={k.occupancy.occupancyPct >= 90 ? 'success' : 'warning'} />);
  if (variant !== 'manager') {
    cards.push(<KpiCard key="col" label="Collected this month" value={fmtCents(k.collections.thisMonthCents)} hint={`${fmtCents(k.collections.trailing12Cents)} trailing 12 months`} tone="success" />);
  }
  if (variant !== 'owner') {
    cards.push(<KpiCard key="sla" label="Maintenance SLA" value={fmtPct(k.maintenanceSla.slaCompliancePct)} hint={`${k.maintenanceSla.completedWithinSla} of ${k.maintenanceSla.completedOrders} on time · ${k.maintenanceSla.breachedOpen} breached open`} tone={k.maintenanceSla.breachedOpen ? 'danger' : 'success'} />);
  }
  if (k.complianceHits && variant !== 'owner') {
    cards.push(<KpiCard key="comp" label="Compliance hits" value={k.complianceHits.total} hint={`${k.complianceHits.open} open · ${k.complianceHits.critical} critical`} tone={k.complianceHits.open ? 'warning' : 'success'} />);
  }
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="report-kpis">{cards}</div>;
}

/** Accessible tab strip (roving aria-selected buttons + a single tabpanel). */
export function Tabs({ tabs, initial }: { tabs: { key: string; label: string; content: ReactNode }[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key ?? '');
  const id = useId();
  const current = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <div>
      <div role="tablist" aria-label="Report sections" className="mb-4 flex flex-wrap gap-2 border-b border-line">
        {tabs.map((t) => (
          <button key={t.key} role="tab" id={`${id}-tab-${t.key}`} aria-selected={t.key === current?.key} aria-controls={`${id}-panel-${t.key}`} tabIndex={t.key === current?.key ? 0 : -1}
            onClick={() => setActive(t.key)}
            onKeyDown={(e) => { const i = tabs.findIndex((x) => x.key === current?.key); if (e.key === 'ArrowRight') setActive(tabs[(i + 1) % tabs.length]!.key); if (e.key === 'ArrowLeft') setActive(tabs[(i - 1 + tabs.length) % tabs.length]!.key); }}
            className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-semibold ${t.key === current?.key ? 'border-cobalt-500 text-cobalt-700' : 'border-transparent text-muted hover:text-navy-900'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {current && <div role="tabpanel" id={`${id}-panel-${current.key}`} aria-labelledby={`${id}-tab-${current.key}`}>{current.content}</div>}
    </div>
  );
}

export function LoadMore({ list }: { list: UseInfiniteQueryResult<unknown, unknown> }) {
  if (!list.hasNextPage) return null;
  return <div className="mt-3"><Button variant="secondary" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>Load more</Button></div>;
}

export function flatItems<T>(data: { pages: { items: T[] }[] } | undefined): T[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}

/** Property filter shared by every report table (lists the properties the actor may see). */
export function PropertyFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const canRead = useCan('property:read');
  const props = useProperties();
  const items = flatItems(props.data);
  if (!canRead) return null;
  return (
    <Select label="Property" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All properties</option>
      {items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </Select>
  );
}
