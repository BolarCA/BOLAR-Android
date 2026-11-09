import type { WorkOrderDto } from '@/lib/hooks/maintenance';
import type { LeaseDto } from '@/lib/hooks/lease';
import type { RuleEvaluationDto } from '@/lib/hooks/compliance';
import type { NoticeDto } from '@/lib/hooks/notice';
import type { ApplicationDto } from '@/lib/hooks/screening';
import type { SensitiveAccessDto } from '@/lib/hooks/iam';

/** Unified operations queue model (blueprint p40, Day 54). Pure functions so the ordering and filters are unit-testable. */
export const QUEUE_TYPES = ['work_order', 'lease', 'compliance', 'notice', 'application', 'access_request'] as const;
export type QueueType = (typeof QUEUE_TYPES)[number];
export const QUEUE_TYPE_LABELS: Record<QueueType, string> = { work_order: 'Work order', lease: 'Lease', compliance: 'Compliance', notice: 'Notice', application: 'Application', access_request: 'Access request' };

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export type DueWindow = 'all' | 'overdue' | 'today' | '7d' | '30d';
export const DUE_WINDOWS: { key: DueWindow; label: string }[] = [
  { key: 'all', label: 'Any due date' }, { key: 'overdue', label: 'Overdue' }, { key: 'today', label: 'Due today' }, { key: '7d', label: 'Next 7 days' }, { key: '30d', label: 'Next 30 days' },
];

export interface QueueLink { label: string; href: string }
export interface QueueItem {
  id: string;
  type: QueueType;
  title: string;
  /** Short status/context line under the title. */
  subtitle: string;
  severity: Severity;
  dueAt: string | null;
  overdue: boolean;
  propertyId: string | null;
  propertyName: string | null;
  assignee: { id: string; name: string; kind: 'vendor' | 'user' } | null;
  /** Primary deep link. */
  href: string;
  /** Secondary deep links (tenant, vendor, property). */
  links: QueueLink[];
}

export interface QueueFilters { types: QueueType[]; propertyId: string; severity: string; due: DueWindow; assigneeId: string }
export const EMPTY_FILTERS: QueueFilters = { types: [], propertyId: '', severity: '', due: 'all', assigneeId: '' };

const DAY = 86_400_000;
const plusDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * DAY).toISOString();
const isOverdue = (dueAt: string | null, now: number) => Boolean(dueAt && new Date(dueAt).getTime() < now);
/** Seeded compliance fixtures carry marker ids such as `demo:lease-ca`; only real record ids deep-link to a workspace. */
const looksLikeRecordId = (id: string) => /^[a-z0-9]{20,32}$/i.test(id);

const WO_SEVERITY: Record<string, Severity> = { emergency: 'critical', high: 'high', normal: 'medium', low: 'low' };
const WO_STATUS_LABEL: Record<string, string> = { new: 'New', triaged: 'Triaged', assigned: 'Assigned', scheduled: 'Scheduled', in_progress: 'In progress', blocked: 'Blocked', review: 'In review', reopened: 'Reopened' };

/** Work orders that need attention: overdue, due within 72h, or emergency/high still unassigned. Completed and canceled orders never enter the queue. */
export function workOrderItems(rows: WorkOrderDto[], now = Date.now()): QueueItem[] {
  return rows
    .filter((w) => !['complete', 'canceled'].includes(w.status))
    .filter((w) => w.overdue || (w.slaDueAt && new Date(w.slaDueAt).getTime() - now < 3 * DAY) || ((w.priority === 'emergency' || w.priority === 'high') && !w.assignedVendorId && !w.assignedUserId))
    .map((w) => ({
      id: `wo:${w.id}`, type: 'work_order', title: w.title,
      subtitle: `${w.number} · ${WO_STATUS_LABEL[w.status] ?? w.status}${w.unit ? ` · Unit ${w.unit.unitNumber}` : ''}${w.overdue ? ' · SLA breached' : ''}`,
      severity: WO_SEVERITY[w.priority] ?? 'medium', dueAt: w.slaDueAt, overdue: w.overdue || isOverdue(w.slaDueAt, now),
      propertyId: w.propertyId, propertyName: w.property?.name ?? null,
      assignee: w.vendor ? { id: w.vendor.id, name: w.vendor.name, kind: 'vendor' } : w.assignee ? { id: w.assignee.id, name: w.assignee.name, kind: 'user' } : null,
      href: `/manager/maintenance?workOrderId=${w.id}`,
      links: [...(w.vendor ? [{ label: 'Vendor', href: `/manager/vendors/${w.vendor.id}` }] : []), { label: 'Property', href: `/manager/properties/${w.propertyId}` }],
    }));
}

const LEASE_TASK: Record<string, { label: string; severity: Severity }> = {
  review: { label: 'Awaiting approval', severity: 'high' },
  approved: { label: 'Awaiting send for signature', severity: 'medium' },
  sent: { label: 'Awaiting tenant signature', severity: 'medium' },
};
export function leaseItems(rows: LeaseDto[], now = Date.now()): QueueItem[] {
  return rows.filter((l) => LEASE_TASK[l.status]).map((l) => {
    const task = LEASE_TASK[l.status]!;
    const primary = l.parties.find((p) => p.role === 'primary') ?? l.parties[0];
    return {
      id: `lease:${l.id}`, type: 'lease', title: `${l.property.name} · Unit ${l.unit.unitNumber}`,
      subtitle: `${task.label} · ${primary ? primary.displayName : 'no tenant party yet'} · starts ${new Date(l.startDate).toLocaleDateString(undefined, { timeZone: 'UTC' })}`,
      severity: task.severity, dueAt: l.startDate, overdue: isOverdue(l.startDate, now),
      propertyId: l.propertyId, propertyName: l.property.name, assignee: null,
      href: `/manager/leases/${l.id}`,
      links: [...(primary ? [{ label: 'Tenant', href: `/manager/tenants/${primary.tenantProfileId}` }] : []), { label: 'Property', href: `/manager/properties/${l.propertyId}` }],
    };
  });
}

export function complianceItems(rows: RuleEvaluationDto[], now = Date.now()): QueueItem[] {
  return rows.filter((e) => !e.reviewedAt && e.result !== 'allow').map((e) => ({
    id: `eval:${e.id}`, type: 'compliance', title: e.title,
    subtitle: `${e.result} · ${e.domain} · ${e.jurisdiction} · ${e.resourceType}`,
    severity: (SEVERITIES as readonly string[]).includes(e.severity) ? (e.severity as Severity) : 'medium', dueAt: e.dueAt, overdue: isOverdue(e.dueAt, now),
    propertyId: null, propertyName: null, assignee: null,
    href: e.resourceType === 'lease' && looksLikeRecordId(e.resourceId) ? `/manager/leases/${e.resourceId}` : e.resourceType === 'application' && looksLikeRecordId(e.resourceId) ? `/manager/applications?focus=${e.resourceId}` : '/compliance',
    links: [{ label: 'Compliance queue', href: '/compliance' }],
  }));
}

export function noticeItems(rows: NoticeDto[], now = Date.now()): QueueItem[] {
  return rows.filter((n) => n.status === 'pending_approval').map((n) => {
    const dueAt = plusDays(n.updatedAt, 3);
    return {
      id: `notice:${n.id}`, type: 'notice', title: `${n.kind.replace(/_/g, ' ')} notice${n.recipientName ? ` for ${n.recipientName}` : ''}`,
      subtitle: `Pending approval · ${n.templateKey}${n.ruleEvaluationIds.length ? ` · ${n.ruleEvaluationIds.length} rule hit(s)` : ''}`,
      severity: 'high', dueAt, overdue: isOverdue(dueAt, now), propertyId: null, propertyName: null, assignee: null,
      href: `/manager/notices?focus=${n.id}`,
      links: [{ label: 'Tenant', href: `/manager/tenants/${n.recipientId}` }, ...(n.leaseId ? [{ label: 'Lease', href: `/manager/leases/${n.leaseId}` }] : [])],
    };
  });
}

export function applicationItems(rows: ApplicationDto[], now = Date.now()): QueueItem[] {
  return rows.filter((a) => a.status === 'screening' || a.status === 'review').map((a) => {
    const dueAt = a.submittedAt ? plusDays(a.submittedAt, 7) : null;
    return {
      id: `app:${a.id}`, type: 'application', title: `${a.applicantName ?? 'Applicant'} · ${a.propertyName ?? 'application'}`,
      subtitle: a.status === 'screening' ? 'Screening in progress' : 'Decision needed (screening complete)',
      severity: a.status === 'review' ? 'high' : 'medium', dueAt, overdue: isOverdue(dueAt, now),
      propertyId: a.propertyId, propertyName: a.propertyName ?? null, assignee: null,
      href: `/manager/applications?focus=${a.id}`,
      links: [{ label: 'Tenant', href: `/manager/tenants/${a.applicantId}` }, { label: 'Property', href: `/manager/properties/${a.propertyId}` }],
    };
  });
}

export function accessRequestItems(rows: SensitiveAccessDto[]): QueueItem[] {
  return rows.filter((r) => r.status === 'pending').map((r) => ({
    id: `access:${r.id}`, type: 'access_request', title: `Access request: ${r.resourceType.replace(/_/g, ' ')}`,
    subtitle: `${r.classification} · ${r.purpose.replace(/_/g, ' ')} · waiting for an approver`,
    severity: 'low', dueAt: null, overdue: false, propertyId: null, propertyName: null, assignee: null,
    href: r.resourceType === 'tenant_profile' && looksLikeRecordId(r.resourceId) ? `/manager/tenants/${r.resourceId}` : '/manager/tenants',
    links: [],
  }));
}

export function applyFilters(items: QueueItem[], f: QueueFilters, now = Date.now()): QueueItem[] {
  return items.filter((i) => {
    if (f.types.length && !f.types.includes(i.type)) return false;
    if (f.propertyId && i.propertyId !== f.propertyId) return false;
    if (f.severity && i.severity !== f.severity) return false;
    if (f.assigneeId && i.assignee?.id !== f.assigneeId) return false;
    if (f.due !== 'all') {
      if (!i.dueAt) return false;
      const t = new Date(i.dueAt).getTime();
      if (f.due === 'overdue') return t < now;
      const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
      if (f.due === 'today') return t <= endOfToday.getTime();
      if (f.due === '7d') return t <= now + 7 * DAY;
      if (f.due === '30d') return t <= now + 30 * DAY;
    }
    return true;
  });
}

/** Overdue first, then severity, then the nearest due date; items without a due date sink to the end of their group. */
export function sortQueue(items: QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return a.title.localeCompare(b.title);
  });
}

export function dueLabel(dueAt: string | null, now = Date.now()): { text: string; tone: 'danger' | 'warning' | 'neutral' } {
  if (!dueAt) return { text: 'No due date', tone: 'neutral' };
  const ms = new Date(dueAt).getTime() - now;
  const days = Math.round(Math.abs(ms) / DAY);
  const hours = Math.round(Math.abs(ms) / 3_600_000);
  const span = days >= 1 ? `${days}d` : `${Math.max(1, hours)}h`;
  if (ms < 0) return { text: `Overdue by ${span}`, tone: 'danger' };
  if (ms < 3 * DAY) return { text: `Due in ${span}`, tone: 'warning' };
  return { text: `Due ${new Date(dueAt).toLocaleDateString()}`, tone: 'neutral' };
}
