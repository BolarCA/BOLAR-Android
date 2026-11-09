'use client';
import Link from 'next/link';
import type { ReactNode, TextareaHTMLAttributes } from 'react';
import type { WorkOrderStatus } from '@bolar/contracts';
import { Badge, cn } from '@/components/ui';

/** Board lanes (blueprint p49): new, triage, assigned, scheduled, in-progress, blocked, done. */
export const LANES: { key: string; label: string; statuses: WorkOrderStatus[] }[] = [
  { key: 'new', label: 'New', statuses: ['new'] },
  { key: 'triage', label: 'Triage', statuses: ['triaged', 'reopened'] },
  { key: 'assigned', label: 'Assigned', statuses: ['assigned'] },
  { key: 'scheduled', label: 'Scheduled', statuses: ['scheduled'] },
  { key: 'in_progress', label: 'In progress', statuses: ['in_progress'] },
  { key: 'blocked', label: 'Blocked', statuses: ['blocked'] },
  { key: 'done', label: 'Done', statuses: ['review', 'complete'] },
];

export const STATUS_LABELS: Record<string, string> = { new: 'new', triaged: 'triaged', assigned: 'assigned', scheduled: 'scheduled', in_progress: 'in progress', blocked: 'blocked', review: 'in review', complete: 'complete', reopened: 'reopened', canceled: 'canceled' };
export const CATEGORY_LABELS: Record<string, string> = { plumbing: 'Plumbing', electrical: 'Electrical', hvac: 'Heating / cooling', appliance: 'Appliance', structural: 'Structural', pest: 'Pest control', safety: 'Safety', other: 'Other' };
export const PRIORITY_LABELS: Record<string, string> = { emergency: 'Emergency', high: 'High', normal: 'Normal', low: 'Low' };
export const ENTRY_LABELS: Record<string, string> = { ask: 'Ask before entering', granted: 'Permission to enter granted', denied: 'Do not enter without me' };

/** Button labels for a transition target, with context for the decline path. */
export function transitionLabel(from: string, to: string): string {
  if (to === 'triaged' && from === 'assigned') return 'Decline / unassign';
  if (to === 'triaged' && from === 'reopened') return 'Re-triage';
  return ({ triaged: 'Triage', assigned: 'Mark assigned', scheduled: 'Schedule', in_progress: 'Start work', blocked: 'Mark blocked', review: 'Submit for review', complete: 'Mark complete', reopened: 'Reopen', canceled: 'Cancel request' } as Record<string, string>)[to] ?? to;
}
/** Input a transition needs before it can be sent. */
export function transitionNeeds(from: string, to: string): { note: 'required' | 'optional' | 'none'; scheduledFor: boolean; actualCents: boolean } {
  if (to === 'scheduled') return { note: 'optional', scheduledFor: true, actualCents: false };
  if (to === 'blocked' || to === 'canceled' || (to === 'triaged' && from === 'assigned')) return { note: 'required', scheduledFor: false, actualCents: false };
  if (to === 'review') return { note: 'optional', scheduledFor: false, actualCents: true };
  if (to === 'reopened') return { note: 'optional', scheduledFor: false, actualCents: false };
  return { note: 'none', scheduledFor: false, actualCents: false };
}

export function humanizeDuration(ms: number): string {
  const abs = Math.abs(ms);
  const h = Math.round(abs / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.round(abs / 60_000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
export const fmtMoney = (cents: number | null | undefined) => (cents === null || cents === undefined ? '—' : (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' }));
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function PriorityBadge({ priority }: { priority: string }) {
  const tone = priority === 'emergency' ? 'danger' : priority === 'high' ? 'warning' : priority === 'low' ? 'neutral' : 'info';
  return <Chip tone={tone}>{PRIORITY_LABELS[priority] ?? priority}</Chip>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === 'complete' ? 'success' : status === 'blocked' || status === 'reopened' ? 'warning' : status === 'canceled' ? 'danger' : status === 'review' ? 'violet' : status === 'new' ? 'neutral' : 'info';
  return <Chip tone={tone}>{STATUS_LABELS[status] ?? status}</Chip>;
}

/** SLA chip: red when overdue (p49), amber inside 4 hours, otherwise time remaining; closed orders show met/missed. */
export function SlaChip({ slaDueAt, overdue, status, completedAt }: { slaDueAt: string | null; overdue: boolean; status: string; completedAt?: string | null }) {
  if (!slaDueAt) return <Badge>No SLA</Badge>;
  const due = new Date(slaDueAt).getTime();
  if (status === 'complete' || status === 'canceled') {
    if (status === 'canceled') return <Badge>SLA closed</Badge>;
    const met = completedAt ? new Date(completedAt).getTime() <= due : true;
    return <Badge tone={met ? 'success' : 'danger'}>{met ? 'SLA met' : 'SLA missed'}</Badge>;
  }
  const remaining = due - Date.now();
  if (overdue || remaining < 0) return <Badge tone="danger">Overdue {humanizeDuration(remaining)}</Badge>;
  if (remaining < 4 * 3_600_000) return <Chip tone="warning">Due in {humanizeDuration(remaining)}</Chip>;
  return <Badge tone="info">Due in {humanizeDuration(remaining)}</Badge>;
}

export function Textarea({ label, id, hint, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  const taId = id ?? `ta-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <label htmlFor={taId} className="block text-sm">
      <span className="mb-1 block font-medium text-navy-900">{label}</span>
      <textarea id={taId} aria-describedby={hint ? `${taId}-hint` : undefined} className={cn('min-h-24 w-full rounded-lg border border-line bg-surface p-3 text-base text-ink', className)} {...rest} />
      {hint && <span id={`${taId}-hint`} className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

/** A link styled like a button (avoids nesting a button inside an anchor). */
export function LinkButton({ href, children, variant = 'secondary', className }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; className?: string }) {
  const styles = { primary: 'bg-cobalt-500 text-white hover:bg-cobalt-600', secondary: 'bg-surface text-navy-900 border border-line hover:bg-navy-50', ghost: 'bg-transparent text-cobalt-600 hover:bg-cobalt-100' };
  return <Link href={href} className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition', styles[variant], className)}>{children}</Link>;
}

/** Badge wrapper: the shared warning tone (orange-700 on orange-100) is below 4.5:1, so warning chips use a solid high-contrast variant. */
export function Chip({ tone = 'neutral', children }: { tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet'; children: ReactNode }) {
  if (tone === 'warning') return <span className="inline-flex items-center rounded-full bg-orange-700 px-2.5 py-0.5 text-xs font-semibold text-white">{children}</span>;
  return <Badge tone={tone}>{children}</Badge>;
}
