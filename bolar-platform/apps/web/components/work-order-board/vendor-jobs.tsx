'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { useWorkOrders, type WorkOrderDto } from '@/lib/hooks/maintenance';
import { Card, KpiCard, PageHeader, Table } from "@/components/ui";
import { StateView } from '@/components/ui/state-view';
import { WorkOrderDetail } from './work-order-detail';
import { LinkButton, PriorityBadge, SlaChip, StatusBadge, fmtDate } from './labels';

/** Vendor portal landing: only the jobs assigned to this vendor (API enforces), with SLA and schedule. */
export function VendorJobs() {
  const q = useWorkOrders({}, { limit: 100 });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const active = items.filter((w) => !['complete', 'canceled'].includes(w.status));
  const overdue = active.filter((w) => w.overdue).length;
  const today = active.filter((w) => w.scheduledFor && new Date(w.scheduledFor).toDateString() === new Date().toDateString()).length;
  return (
    <>
      <PageHeader title="My jobs" description="Work orders assigned to you. Schedule, start, flag blockers and submit for review; the manager closes the job." />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Active jobs" value={active.length} />
        <KpiCard label="Overdue" value={overdue} tone={overdue ? 'danger' : 'success'} hint={overdue ? 'needs attention' : 'on track'} />
        <KpiCard label="Scheduled today" value={today} />
      </div>
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No assigned jobs', description: 'Jobs appear here once a property manager assigns you a work order.' }} onRetry={() => void q.refetch()}>
        {() => (
          <Table<WorkOrderDto> caption="Assigned work orders" rows={items} columns={[
            { key: 'job', header: 'Job', render: (w) => <div><Link href={`/vendor/jobs/${w.id}`} className="font-medium text-cobalt-600 underline-offset-2 hover:underline">{w.title}</Link><p className="text-xs text-muted">{w.number} · {w.property?.name}{w.unit ? ` · Unit ${w.unit.unitNumber}` : ''}</p></div> },
            { key: 'status', header: 'Status', render: (w) => <StatusBadge status={w.status} /> },
            { key: 'priority', header: 'Priority', render: (w) => <PriorityBadge priority={w.priority} /> },
            { key: 'sla', header: 'SLA', render: (w) => <SlaChip slaDueAt={w.slaDueAt} overdue={w.overdue} status={w.status} completedAt={w.completedAt} /> },
            { key: 'when', header: 'Scheduled', render: (w) => fmtDate(w.scheduledFor) },
            { key: 'open', header: '', className: 'text-right', render: (w) => <LinkButton href={`/vendor/jobs/${w.id}`}>Open<span className="sr-only"> {w.title}</span></LinkButton> },
          ]} />
        )}
      </StateView>
    </>
  );
}

/** Vendor job page: schedule / start / block / review actions, notes and photo evidence. Unassigned jobs render the denied state. */
export function VendorJobDetail({ id }: { id: string }) {
  return (
    <>
      <PageHeader title="Job details" actions={<LinkButton href="/vendor">Back to my jobs</LinkButton>} />
      <Card>
        <WorkOrderDetail id={id} />
      </Card>
    </>
  );
}
