'use client';
import Link from 'next/link';
import { useWorkOrders, type WorkOrderDto } from '@/lib/hooks/maintenance';
import { Badge, Card, PageHeader, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/** Vendor schedule: assigned jobs grouped by scheduled day (blueprint p46 "schedule"). The API scopes to assigned work orders. */
export default function VendorSchedulePage() {
  const q = useWorkOrders({ status: 'assigned,scheduled,in_progress,blocked' } as never, { limit: 100 });
  return (
    <>
      <PageHeader title="Schedule" description="Your assigned visits grouped by day. Unscheduled jobs appear first so you can propose a time from the job page." />
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No scheduled work', description: 'Jobs assigned to you by a property manager will appear here.' }} onRetry={() => void q.refetch()}>
        {(d) => {
          const rows = d.pages.flatMap((p) => p.items);
          const groups = new Map<string, WorkOrderDto[]>();
          for (const r of rows) {
            const key = r.scheduledFor ? new Date(r.scheduledFor).toDateString() : 'Not yet scheduled';
            groups.set(key, [...(groups.get(key) ?? []), r]);
          }
          const ordered = [...groups.entries()].sort(([a], [b]) => (a === 'Not yet scheduled' ? -1 : b === 'Not yet scheduled' ? 1 : new Date(a).getTime() - new Date(b).getTime()));
          return (
            <div className="space-y-6">
              {ordered.map(([day, items]) => (
                <Card key={day} title={day}>
                  <ul className="divide-y divide-line">
                    {items.map((w) => (
                      <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                        <div>
                          <Link href={`/vendor/jobs/${w.id}`} className="font-medium text-cobalt-700 hover:underline">{w.number} · {w.title}</Link>
                          <p className="text-xs text-muted">{w.property?.name}{w.unit ? ` · Unit ${w.unit.unitNumber}` : ''}{w.scheduledFor ? ` · ${new Date(w.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
                        </div>
                        <div className="flex gap-2"><Badge tone={statusTone(w.priority)}>{w.priority}</Badge><Badge tone={statusTone(w.status)}>{w.status.replace(/_/g, ' ')}</Badge>{w.overdue && <Badge tone="danger">SLA overdue</Badge>}</div>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          );
        }}
      </StateView>
    </>
  );
}
