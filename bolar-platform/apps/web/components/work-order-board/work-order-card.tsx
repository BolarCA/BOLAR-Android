'use client';
import type { WorkOrderDto } from '@/lib/hooks/maintenance';
import { cn } from '@/components/ui';
import { PriorityBadge, SlaChip, StatusBadge, STATUS_LABELS, fmtDate } from './labels';

/** Board card (p49): priority, SLA chip (red when overdue), property/unit, assignee or vendor. */
export function WorkOrderCard({ wo, onOpen, showStatus = false }: { wo: WorkOrderDto; onOpen: (id: string) => void; showStatus?: boolean }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(wo.id)} aria-label={`${wo.title}, ${wo.priority} priority, ${STATUS_LABELS[wo.status] ?? wo.status}`}
        className={cn('w-full rounded-lg border bg-surface p-3 text-left shadow-sm transition hover:border-cobalt-500 focus-visible:border-cobalt-500', wo.overdue ? 'border-danger-600/60' : 'border-line')}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold text-muted">{wo.number}</p>
          <PriorityBadge priority={wo.priority} />
        </div>
        <p className="mt-1 line-clamp-2 text-sm font-semibold text-navy-900">{wo.title}</p>
        <p className="mt-1 text-xs text-muted">{wo.property?.name ?? 'Property'}{wo.unit ? ` · Unit ${wo.unit.unitNumber}` : ' · Common area'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <SlaChip slaDueAt={wo.slaDueAt} overdue={wo.overdue} status={wo.status} completedAt={wo.completedAt} />
          {showStatus && <StatusBadge status={wo.status} />}
        </div>
        <p className="mt-2 text-xs text-ink">{wo.vendor ? `Vendor: ${wo.vendor.name}` : wo.assignee ? `Assigned: ${wo.assignee.name}` : 'Unassigned'}{wo.scheduledFor ? ` · ${fmtDate(wo.scheduledFor)}` : ''}</p>
      </button>
    </li>
  );
}
