'use client';
import { useEffect, useMemo, useState } from 'react';
import { WORK_ORDER_PRIORITIES } from '@bolar/contracts';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useSlaScan, useWorkOrders, type WorkOrderDto, type WorkOrderFilters } from '@/lib/hooks/maintenance';
import { useVendors } from '@/lib/hooks/vendor';
import { Alert, Button, Drawer, Input, PageHeader, Select, Table, cn } from '@/components/ui';
import { EmptyState, StateView } from '@/components/ui/state-view';
import { WorkOrderCard } from './work-order-card';
import { WorkOrderDetail } from './work-order-detail';
import { LANES, PRIORITY_LABELS, PriorityBadge, SlaChip, StatusBadge, fmtDate } from './labels';

/**
 * Property manager maintenance board (blueprint p49, Day 34): kanban/list hybrid with filters by property, priority,
 * assignee and vendor; SLA chips; detail drawer. On small screens the lanes collapse to a lane selector + list.
 */
export function MaintenanceBoard() {
  const canWrite = useCan('work_order:write');
  const canReadVendors = useCan('vendor:read');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [lane, setLane] = useState<string>('all');
  const [selected, setSelected] = useState<string | null>(null);
  // Deep link from the operations queue (Day 54): /manager/maintenance?workOrderId=<id> opens the detail drawer.
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('workOrderId'); if (id) setSelected(id); }, []);
  const [f, setF] = useState<{ propertyId: string; priority: string; vendorId: string; assigneeId: string; overdue: boolean; includeCanceled: boolean; q: string }>({ propertyId: '', priority: '', vendorId: '', assigneeId: '', overdue: false, includeCanceled: false, q: '' });
  const params: WorkOrderFilters = useMemo(() => ({
    propertyId: f.propertyId || undefined, priority: f.priority || undefined, assignedVendorId: f.vendorId || undefined, assignedUserId: f.assigneeId || undefined,
    overdue: f.overdue ? 'true' : undefined, includeCanceled: f.includeCanceled ? 'true' : undefined, q: f.q || undefined,
  }), [f]);
  const q = useWorkOrders(params);
  const vendors = useVendors({}, canReadVendors);
  const scan = useSlaScan();
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  // Filter options come from the loaded orders so the board does not depend on the property module.
  const properties = useMemo(() => [...new Map(items.filter((w) => w.property).map((w) => [w.property!.id, w.property!.name])).entries()], [items]);
  const assignees = useMemo(() => [...new Map(items.filter((w) => w.assignee).map((w) => [w.assignee!.id, w.assignee!.name])).entries()], [items]);
  const hasFilters = Boolean(f.propertyId || f.priority || f.vendorId || f.assigneeId || f.overdue || f.q);
  const overdueCount = items.filter((w) => w.overdue).length;

  return (
    <>
      <PageHeader title="Maintenance board" description="Work orders by lane with SLA tracking. Open a card for the timeline, photos, notes, vendor assignment and state actions."
        actions={<>
          <div role="group" aria-label="View" className="flex rounded-lg border border-line p-0.5">
            <Button variant={view === 'board' ? 'primary' : 'ghost'} aria-pressed={view === 'board'} onClick={() => setView('board')}>Board</Button>
            <Button variant={view === 'list' ? 'primary' : 'ghost'} aria-pressed={view === 'list'} onClick={() => setView('list')}>List</Button>
          </div>
          {canWrite && <Button variant="secondary" onClick={() => scan.mutate()} loading={scan.isPending}>Run SLA scan</Button>}
        </>} />

      {scan.isSuccess && <div className="mb-4"><Alert tone={scan.data.breached.length ? 'warning' : 'success'} title={scan.data.breached.length ? `${scan.data.breached.length} work order(s) newly marked SLA breached` : `No new SLA breaches (${scan.data.scanned} overdue already flagged)`}>Escalation steps are in the maintenance escalation runbook.</Alert></div>}
      {scan.isError && <div className="mb-4"><Alert tone="danger" title={scan.error instanceof ApiError ? scan.error.message : 'SLA scan failed'} /></div>}

      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6" onSubmit={(e) => e.preventDefault()} aria-label="Filters">
        <Input label="Search" placeholder="Title or description" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select label="Property" value={f.propertyId} onChange={(e) => setF({ ...f, propertyId: e.target.value })}>
          <option value="">All properties</option>
          {properties.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
        <Select label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
          <option value="">All priorities</option>
          {WORK_ORDER_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </Select>
        <Select label="Vendor" value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} disabled={!canReadVendors}>
          <option value="">All vendors</option>
          {vendors.data?.pages.flatMap((p) => p.items).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </Select>
        <Select label="Assignee" value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
          <option value="">Anyone</option>
          {assignees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
        <fieldset className="flex flex-col justify-end gap-1 text-sm">
          <legend className="sr-only">Flags</legend>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked })} /> Overdue only{overdueCount > 0 && <span className="rounded-full bg-danger-100 px-2 text-xs font-semibold text-danger-600">{overdueCount}</span>}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.includeCanceled} onChange={(e) => setF({ ...f, includeCanceled: e.target.checked })} /> Show canceled</label>
        </fieldset>
      </form>

      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void q.refetch()} skeleton="cards"
        empty={{ title: hasFilters ? 'No work orders match these filters' : 'No work orders yet', description: hasFilters ? 'Try clearing a filter.' : 'Resident requests and staff-created work orders appear here, sorted into lanes.', action: hasFilters && <Button variant="secondary" onClick={() => setF({ propertyId: '', priority: '', vendorId: '', assigneeId: '', overdue: false, includeCanceled: false, q: '' })}>Clear filters</Button> }}>
        {() => (
          <>
            {view === 'list' ? (
              <ListView items={items} onOpen={setSelected} />
            ) : (
              <>
                {/* Desktop lanes */}
                <div className="hidden gap-3 lg:grid" style={{ gridTemplateColumns: `repeat(${LANES.length}, minmax(0, 1fr))` }} data-testid="board-lanes">
                  {LANES.map((l) => <Lane key={l.key} label={l.label} items={items.filter((w) => (l.statuses as string[]).includes(w.status))} onOpen={setSelected} showStatus={l.statuses.length > 1} />)}
                </div>
                {/* Mobile: lane selector + list */}
                <div className="lg:hidden">
                  <Select label="Lane" value={lane} onChange={(e) => setLane(e.target.value)}>
                    <option value="all">All lanes ({items.length})</option>
                    {LANES.map((l) => <option key={l.key} value={l.key}>{l.label} ({items.filter((w) => (l.statuses as string[]).includes(w.status)).length})</option>)}
                  </Select>
                  <ul className="mt-3 space-y-2" aria-label="Work orders">
                    {items.filter((w) => lane === 'all' || (LANES.find((l) => l.key === lane)?.statuses as string[] | undefined)?.includes(w.status)).map((w) => <WorkOrderCard key={w.id} wo={w} onOpen={setSelected} showStatus />)}
                  </ul>
                </div>
              </>
            )}
            {q.hasNextPage && <div className="mt-4"><Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title="Work order">
        {selected && <WorkOrderDetail id={selected} onClose={() => setSelected(null)} />}
      </Drawer>
    </>
  );
}

function Lane({ label, items, onOpen, showStatus }: { label: string; items: WorkOrderDto[]; onOpen: (id: string) => void; showStatus: boolean }) {
  const overdue = items.filter((w) => w.overdue).length;
  return (
    <section aria-label={`${label} lane`} className={cn('flex min-h-40 flex-col rounded-[14px] border border-line bg-canvas p-2', overdue > 0 && 'border-t-4 border-t-danger-600')}>
      <header className="mb-2 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-navy-900">{label}</h2>
        <span className="rounded-full bg-navy-100 px-2 text-xs font-semibold text-navy-700" aria-label={`${items.length} in ${label}`}>{items.length}</span>
      </header>
      {items.length === 0 ? <p className="px-1 text-xs text-muted">Empty</p> : (
        <ul className="space-y-2">{items.map((w) => <WorkOrderCard key={w.id} wo={w} onOpen={onOpen} showStatus={showStatus} />)}</ul>
      )}
    </section>
  );
}

function ListView({ items, onOpen }: { items: WorkOrderDto[]; onOpen: (id: string) => void }) {
  if (items.length === 0) return <EmptyState title="Nothing to list" />;
  return (
    <Table<WorkOrderDto> caption="Work orders" rows={items} onRowClick={(w) => onOpen(w.id)} columns={[
      { key: 'number', header: 'Order', render: (w) => <div><p className="font-medium">{w.title}</p><p className="text-xs text-muted">{w.number} · {w.property?.name}{w.unit ? ` · ${w.unit.unitNumber}` : ''}</p></div> },
      { key: 'status', header: 'Status', render: (w) => <StatusBadge status={w.status} /> },
      { key: 'priority', header: 'Priority', render: (w) => <PriorityBadge priority={w.priority} /> },
      { key: 'sla', header: 'SLA', render: (w) => <SlaChip slaDueAt={w.slaDueAt} overdue={w.overdue} status={w.status} completedAt={w.completedAt} /> },
      { key: 'assignee', header: 'Vendor / assignee', render: (w) => w.vendor?.name ?? w.assignee?.name ?? <span className="text-muted">—</span> },
      { key: 'scheduled', header: 'Scheduled', render: (w) => fmtDate(w.scheduledFor) },
      { key: 'open', header: '', className: 'text-right', render: (w) => <Button variant="ghost" onClick={(e) => { e.stopPropagation(); onOpen(w.id); }} aria-label={`Open ${w.title}`}>Open</Button> },
    ]} />
  );
}
