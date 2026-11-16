'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useCan } from '@/lib/auth';
import { useWorkOrders } from '@/lib/hooks/maintenance';
import { useLeases } from '@/lib/hooks/lease';
import { useEvaluations } from '@/lib/hooks/compliance';
import { useNotices } from '@/lib/hooks/notice';
import { useApplications } from '@/lib/hooks/screening';
import { useSensitiveAccessRequests } from '@/lib/hooks/iam';
import { useProperties } from '@/lib/hooks/property';
import { Badge, Button, KpiCard, PageHeader, Select, cn } from '@/components/ui';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/state-view';
import {
  DUE_WINDOWS, EMPTY_FILTERS, QUEUE_TYPES, QUEUE_TYPE_LABELS, SEVERITIES, accessRequestItems, applicationItems, applyFilters, complianceItems, dueLabel, leaseItems, noticeItems, sortQueue, workOrderItems,
  type QueueFilters, type QueueItem, type QueueType, type Severity,
} from './queue-model';

const SEVERITY_TONE: Record<Severity, 'danger' | 'warning' | 'info' | 'neutral'> = { critical: 'danger', high: 'warning', medium: 'info', low: 'neutral' };
const TYPE_TONE: Record<QueueType, 'danger' | 'warning' | 'info' | 'neutral' | 'violet' | 'success'> = { work_order: 'warning', lease: 'info', compliance: 'violet', notice: 'danger', application: 'success', access_request: 'neutral' };

/**
 * Property manager operations cockpit (blueprint p40, Day 54): one queue across work order SLAs, lease tasks,
 * compliance hits, notices awaiting approval, applications in review and the manager's own pending access
 * requests. Each source is fetched only when the role holds the matching permission; a source that fails does
 * not hide the others.
 */
export function OpsDashboard() {
  const can = {
    workOrders: useCan('work_order:read'), leases: useCan('lease:read'), compliance: useCan('compliance:read'),
    notices: useCan('notice:draft'), applications: useCan('application:read'), access: useCan('sensitive_access:request'), properties: useCan('property:read'),
  };
  const workOrders = useWorkOrders({}, { limit: 100, enabled: can.workOrders });
  const review = useLeases({ status: 'review' }, can.leases);
  const approved = useLeases({ status: 'approved' }, can.leases);
  const sent = useLeases({ status: 'sent' }, can.leases);
  const evaluations = useEvaluations(can.compliance ? { reviewed: 'false' } : {});
  const notices = useNotices({ status: 'pending_approval' });
  const screening = useApplications({ status: 'screening' });
  const inReview = useApplications({ status: 'review' });
  const access = useSensitiveAccessRequests({ status: 'pending' });
  const properties = useProperties();
  const [f, setF] = useState<QueueFilters>(EMPTY_FILTERS);

  const sources = [
    { key: 'workOrders', enabled: can.workOrders, q: workOrders }, { key: 'leases', enabled: can.leases, q: review }, { key: 'leases', enabled: can.leases, q: approved }, { key: 'leases', enabled: can.leases, q: sent },
    { key: 'compliance', enabled: can.compliance, q: evaluations }, { key: 'notices', enabled: can.notices, q: notices }, { key: 'applications', enabled: can.applications, q: screening }, { key: 'applications', enabled: can.applications, q: inReview },
    { key: 'access', enabled: can.access, q: access },
  ] as const;
  const loading = sources.some((s) => s.enabled && s.q.isLoading);
  const failed = sources.filter((s) => s.enabled && s.q.isError);

  const flat = <T,>(d: { pages: { items: T[] }[] } | undefined) => d?.pages.flatMap((p) => p.items) ?? [];
  const items = useMemo(() => sortQueue([
    ...(can.workOrders ? workOrderItems(flat(workOrders.data)) : []),
    ...(can.leases ? leaseItems([...flat(review.data), ...flat(approved.data), ...flat(sent.data)]) : []),
    ...(can.compliance ? complianceItems(flat(evaluations.data)) : []),
    ...(can.notices ? noticeItems(flat(notices.data)) : []),
    ...(can.applications ? applicationItems([...flat(screening.data), ...flat(inReview.data)]) : []),
    ...(can.access ? accessRequestItems(flat(access.data)) : []),
  ]), [can.workOrders, can.leases, can.compliance, can.notices, can.applications, can.access, workOrders.data, review.data, approved.data, sent.data, evaluations.data, notices.data, screening.data, inReview.data, access.data]);
  const visible = useMemo(() => applyFilters(items, f), [items, f]);

  const propertyOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of flat(properties.data)) m.set(p.id, p.name);
    for (const i of items) if (i.propertyId && i.propertyName && !m.has(i.propertyId)) m.set(i.propertyId, i.propertyName);
    return [...m.entries()];
  }, [properties.data, items]);
  const assigneeOptions = useMemo(() => [...new Map(items.filter((i) => i.assignee).map((i) => [i.assignee!.id, `${i.assignee!.name}${i.assignee!.kind === 'vendor' ? ' (vendor)' : ''}`])).entries()], [items]);
  const hasFilters = f.types.length > 0 || Boolean(f.propertyId || f.severity || f.assigneeId) || f.due !== 'all';

  const kpi = {
    overdueWo: flat(workOrders.data).filter((w) => w.overdue).length,
    leases: flat(review.data).length + flat(approved.data).length + flat(sent.data).length,
    compliance: items.filter((i) => i.type === 'compliance').length,
    notices: flat(notices.data).length,
    applications: flat(screening.data).length + flat(inReview.data).length,
    vacant: flat(properties.data).reduce((n, p) => n + (p.unitCounts?.vacant ?? 0), 0),
  };
  const countFor = (t: QueueType) => items.filter((i) => i.type === t).length;
  const toggleType = (t: QueueType) => setF((prev) => ({ ...prev, types: prev.types.includes(t) ? prev.types.filter((x) => x !== t) : [...prev.types, t] }));

  return (
    <>
      <PageHeader title="Operations" description="Everything that needs a decision today, in one queue: SLA risk on work orders, lease tasks, compliance hits, notices and applications. Open any row to act in its workspace." actions={<Link href="/manager/maintenance"><Button variant="secondary">Maintenance board</Button></Link>} />

      <section aria-label="Key indicators" className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="ops-kpis">
        <KpiLink href="/manager/maintenance" label="Overdue work orders" value={can.workOrders ? (workOrders.data ? kpi.overdueWo : '…') : '—'} tone={kpi.overdueWo > 0 ? 'danger' : 'success'} hint={kpi.overdueWo > 0 ? 'SLA breached' : 'all within SLA'} testId="kpi-overdue-work-orders" />
        <KpiLink href="/manager/leases" label="Leases awaiting action" value={can.leases ? (review.data && approved.data && sent.data ? kpi.leases : '…') : '—'} tone={kpi.leases > 0 ? 'warning' : 'neutral'} hint="review · approved · sent" testId="kpi-leases" />
        <KpiLink href="/compliance" label="Compliance hits" value={can.compliance ? (evaluations.data ? kpi.compliance : '…') : '—'} tone={kpi.compliance > 0 ? 'violet' : 'neutral'} hint="unreviewed" testId="kpi-compliance" />
        <KpiLink href="/manager/notices" label="Notices pending" value={can.notices ? (notices.data ? kpi.notices : '…') : '—'} tone={kpi.notices > 0 ? 'warning' : 'neutral'} hint="awaiting approval" testId="kpi-notices" />
        <KpiLink href="/manager/applications" label="Applications in review" value={can.applications ? (screening.data && inReview.data ? kpi.applications : '…') : '—'} tone={kpi.applications > 0 ? 'info' : 'neutral'} hint="screening · review" testId="kpi-applications" />
        <KpiLink href="/manager/properties" label="Vacant units" value={can.properties ? (properties.data ? kpi.vacant : '…') : '—'} tone="neutral" hint="ready to lease" testId="kpi-vacant-units" />
      </section>

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Queue type">
        {QUEUE_TYPES.map((t) => (
          <button key={t} type="button" aria-pressed={f.types.includes(t)} onClick={() => toggleType(t)} data-testid={`type-chip-${t}`}
            className={cn('inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm font-medium transition', f.types.includes(t) ? 'border-cobalt-500 bg-cobalt-500 text-white' : 'border-line bg-surface text-navy-900 hover:bg-navy-50')}>
            {QUEUE_TYPE_LABELS[t]} <span className={cn('rounded-full px-1.5 text-xs', f.types.includes(t) ? 'bg-white/20' : 'bg-navy-100 text-navy-700')}>{countFor(t)}</span>
          </button>
        ))}
      </div>

      <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()} aria-label="Queue filters">
        <Select label="Property" value={f.propertyId} onChange={(e) => setF({ ...f, propertyId: e.target.value })}>
          <option value="">All properties</option>
          {propertyOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
        <Select label="Priority" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>
          <option value="">All priorities</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select label="Due date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value as QueueFilters['due'] })}>
          {DUE_WINDOWS.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
        </Select>
        <Select label="Assignee or vendor" value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
          <option value="">Anyone</option>
          {assigneeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
      </form>

      {failed.length > 0 && (
        <div className="mt-4" data-testid="queue-partial-error">
          <ErrorState error={failed[0]!.q.error} onRetry={() => { for (const s of failed) void s.q.refetch(); }} />
        </div>
      )}

      <section aria-label="Unified queue" className="mt-4" data-testid="ops-queue">
        <div className="mb-2 flex items-center justify-between text-sm text-muted">
          <p aria-live="polite" data-testid="queue-count">{loading ? 'Loading queue…' : `${visible.length} of ${items.length} item${items.length === 1 ? '' : 's'}`}</p>
          {hasFilters && <Button variant="ghost" onClick={() => setF(EMPTY_FILTERS)}>Clear filters</Button>}
        </div>
        {loading && items.length === 0 ? <Skeleton kind="list" /> : visible.length === 0 ? (
          <EmptyState title={hasFilters ? 'Nothing matches these filters' : 'Queue is clear'} description={hasFilters ? 'Try widening the due-date window or clearing a filter.' : 'No overdue work, lease tasks, compliance hits, notices or applications are waiting on you.'} action={hasFilters && <Button variant="secondary" onClick={() => setF(EMPTY_FILTERS)}>Clear filters</Button>} />
        ) : (
          <ul className="divide-y divide-line rounded-[14px] border border-line bg-surface">
            {visible.map((i) => <QueueRow key={i.id} item={i} />)}
          </ul>
        )}
      </section>
    </>
  );
}

function KpiLink({ href, label, value, hint, tone, testId }: { href: string; label: string; value: string | number; hint?: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet'; testId: string }) {
  return (
    <Link href={href} className="block rounded-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cobalt-500" aria-label={`${label}: ${value}. Open ${label.toLowerCase()}`} data-testid={testId}>
      <KpiCard label={label} value={value} hint={hint} tone={tone} />
    </Link>
  );
}

function QueueRow({ item }: { item: QueueItem }) {
  const due = dueLabel(item.dueAt);
  return (
    <li className={cn('grid gap-3 p-4 lg:grid-cols-[auto_1fr_auto_auto] lg:items-center', item.overdue && 'border-l-4 border-l-danger-600')} data-testid="queue-row" data-queue-type={item.type}>
      <div className="flex flex-wrap gap-1.5 lg:w-36 lg:flex-col lg:items-start">
        <Badge tone={TYPE_TONE[item.type]}>{QUEUE_TYPE_LABELS[item.type]}</Badge>
        <Badge tone={SEVERITY_TONE[item.severity]}>{item.severity}</Badge>
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-navy-900"><Link href={item.href} className="hover:underline">{item.title}</Link></p>
        <p className="mt-0.5 text-xs text-muted">{item.subtitle}</p>
        <p className="mt-1 text-xs text-ink">
          {item.propertyName ?? 'Portfolio-wide'}{item.assignee ? ` · ${item.assignee.kind === 'vendor' ? 'Vendor' : 'Assigned'}: ${item.assignee.name}` : ''}
        </p>
      </div>
      <div className="text-sm lg:w-40 lg:text-right"><Badge tone={due.tone}>{due.text}</Badge></div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {item.links.map((l) => <Link key={l.href + l.label} href={l.href} className="text-xs text-cobalt-600 underline">{l.label}</Link>)}
        <Link href={item.href} className="inline-flex min-h-9 items-center rounded-lg bg-cobalt-500 px-3 text-sm font-semibold text-white hover:bg-cobalt-600" aria-label={`Open ${item.title}`}>Open</Link>
      </div>
    </li>
  );
}
