'use client';
import { usePropertyHierarchy, formatCents, humanize, type UnitDto } from '@/lib/hooks/property';
import { Alert, Badge, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/** Day 19 hierarchy: portfolio -> property -> buildings -> units, from GET /properties/:id/hierarchy. */
export function HierarchyView({ propertyId }: { propertyId: string }) {
  const q = usePropertyHierarchy(propertyId);
  const UnitList = ({ units }: { units: UnitDto[] }) => (
    <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {units.map((u) => (
        <li key={u.id} className="flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          <span><span className="font-medium">Unit {u.unitNumber}</span><span className="ml-2 text-xs text-muted">{formatCents(u.targetRentCents)}</span></span>
          <Badge tone={statusTone(u.status)}>{humanize(u.status)}</Badge>
        </li>
      ))}
      {units.length === 0 && <li className="text-sm text-muted">No units</li>}
    </ul>
  );
  return (
    <StateView isLoading={q.isLoading} error={q.error} data={q.data} onRetry={() => void q.refetch()} skeleton="detail">
      {(h) => (
        <div className="space-y-4">
          <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Hierarchy path">
            <li><Badge tone="violet">Portfolio</Badge> <span className="ml-1 font-medium">{h.portfolio?.name ?? 'No portfolio'}</span></li>
            <li aria-hidden>→</li>
            <li><Badge tone="info">Property</Badge> <span className="ml-1 font-medium">{h.property.name}</span></li>
          </ol>
          {h.truncated && <Alert tone="warning" title="Showing the first 500 units">Use the units table with filters to browse the rest.</Alert>}
          <ul className="space-y-4">
            {h.buildings.map((b) => (
              <li key={b.id} className="rounded-[14px] border border-line bg-navy-50 p-4">
                <h3 className="text-sm font-semibold text-navy-900">{b.name ?? 'Building'} <span className="font-normal text-muted">· {b.unitCount} unit{b.unitCount === 1 ? '' : 's'}{b.floors ? ` · ${b.floors} floor${b.floors === 1 ? '' : 's'}` : ''}</span></h3>
                <UnitList units={b.units} />
              </li>
            ))}
            {h.unassignedUnits.length > 0 && (
              <li className="rounded-[14px] border border-dashed border-line p-4">
                <h3 className="text-sm font-semibold text-navy-900">Not assigned to a building <span className="font-normal text-muted">· {h.unassignedUnits.length}</span></h3>
                <UnitList units={h.unassignedUnits} />
              </li>
            )}
            {h.buildings.length === 0 && h.unassignedUnits.length === 0 && <li className="text-sm text-muted">No buildings or units yet.</li>}
          </ul>
        </div>
      )}
    </StateView>
  );
}
