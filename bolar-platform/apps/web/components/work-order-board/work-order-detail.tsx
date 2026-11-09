'use client';
import { useState } from 'react';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useAddWorkOrderNote, useAssignWorkOrder, useTransitionWorkOrder, useUploadWorkOrderMedia, useWorkOrder, useWorkOrderMedia, type WorkOrderDetailDto, type WorkOrderEventDto } from '@/lib/hooks/maintenance';
import { useEligibleVendors } from '@/lib/hooks/vendor';
import { Alert, Badge, Button, Input, Select } from '@/components/ui';
import { EmptyState, StateView } from '@/components/ui/state-view';
import { CATEGORY_LABELS, Chip, ENTRY_LABELS, Field, PriorityBadge, SlaChip, StatusBadge, Textarea, fmtDate, fmtMoney, transitionLabel, transitionNeeds } from './labels';

/**
 * Work order detail (Day 34 "detail drawer with timeline, media, messages, actions"). Shared by the manager drawer,
 * the resident request drawer and the vendor job page; what the actor may do comes from the API (`allowedTransitions`).
 */
export function WorkOrderDetail({ id, onClose }: { id: string; onClose?: () => void }) {
  const q = useWorkOrder(id);
  return (
    <StateView isLoading={q.isLoading} error={q.error} data={q.data} onRetry={() => void q.refetch()} skeleton="detail">
      {(wo) => <DetailBody wo={wo} onClose={onClose} />}
    </StateView>
  );
}

function DetailBody({ wo, onClose }: { wo: WorkOrderDetailDto; onClose?: () => void }) {
  const canAssign = useCan('work_order:assign');
  const isManager = wo.actorKinds.includes('manager');
  const canUpload = useCanUpload(wo);
  const assignable = isManager && canAssign && ['triaged', 'assigned', 'scheduled', 'reopened', 'blocked', 'in_progress'].includes(wo.status);
  return (
    <div className="space-y-6" data-testid="work-order-detail">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{wo.number}</p>
        <h3 className="text-lg font-semibold text-navy-900">{wo.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={wo.status} />
          <PriorityBadge priority={wo.priority} />
          <SlaChip slaDueAt={wo.slaDueAt} overdue={wo.overdue} status={wo.status} completedAt={wo.completedAt} />
          <Badge>{CATEGORY_LABELS[wo.category] ?? wo.category}</Badge>
          {wo.reopenedCount > 0 && <Chip tone="warning">reopened ×{wo.reopenedCount}</Chip>}
          {wo.duplicateOfId && <Badge tone="neutral">duplicate</Badge>}
        </div>
      </header>

      <p className="whitespace-pre-wrap text-sm text-ink">{wo.description}</p>

      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-navy-50 p-3">
        <Field label="Property">{wo.property?.name ?? '—'}</Field>
        <Field label="Unit">{wo.unit?.unitNumber ?? 'Common area'}</Field>
        <Field label="Requested by">{wo.requester?.name ?? '—'} <span className="text-muted">({wo.requesterKind})</span></Field>
        <Field label="Entry">{ENTRY_LABELS[wo.entryPermission] ?? wo.entryPermission}</Field>
        <Field label="Assigned to">{wo.vendor?.name ?? wo.assignee?.name ?? <span className="text-muted">Unassigned</span>}</Field>
        <Field label="Scheduled">{fmtDate(wo.scheduledFor)}</Field>
        <Field label="SLA due">{fmtDate(wo.slaDueAt)}</Field>
        <Field label="Estimate / actual">{fmtMoney(wo.estimateCents)} / {fmtMoney(wo.actualCents)}</Field>
        {wo.availabilityJson.length > 0 && (
          <div className="col-span-2">
            <dt className="text-xs uppercase tracking-wide text-muted">Resident availability</dt>
            <dd className="mt-0.5 text-sm">{wo.availabilityJson.map((w, i) => <span key={i} className="mr-2 inline-block">{fmtDate(w.start)} – {new Date(w.end).toLocaleTimeString([], { timeStyle: 'short' })}</span>)}</dd>
          </div>
        )}
      </dl>

      {wo.vendor && (
        <section aria-labelledby="vendor-panel" className="rounded-lg border border-line p-3">
          <h4 id="vendor-panel" className="text-sm font-semibold text-navy-900">Vendor</h4>
          <p className="text-sm">{wo.vendor.name} <Chip tone={wo.vendor.status === "approved" ? "success" : "warning"}>{wo.vendor.status}</Chip></p>
          <p className="text-xs text-muted">{wo.vendor.trades.join(', ')}{wo.vendor.phone ? ` · ${wo.vendor.phone}` : ''}{wo.vendor.email ? ` · ${wo.vendor.email}` : ''}</p>
        </section>
      )}

      <Actions wo={wo} />
      {assignable && <AssignVendor wo={wo} />}
      <MediaPanel workOrderId={wo.id} canUpload={canUpload} />
      <Notes wo={wo} />
      <Timeline events={wo.events} />
      {onClose && <Button variant="secondary" onClick={onClose}>Done</Button>}
    </div>
  );
}

function useCanUpload(wo: WorkOrderDetailDto) {
  const canMedia = useCan('media:write');
  return canMedia && wo.actorKinds.length > 0 && wo.status !== 'canceled';
}

function Actions({ wo }: { wo: WorkOrderDetailDto }) {
  const transition = useTransitionWorkOrder();
  const [pending, setPending] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [when, setWhen] = useState('');
  const [actual, setActual] = useState('');
  if (wo.allowedTransitions.length === 0) {
    return <Alert tone="neutral" title={wo.actorKinds.length ? 'No actions available in this state' : 'View only'}>{wo.actorKinds.length ? 'Another role must act next (for example the manager completes a job that is in review).' : 'Your role can follow this request but not change it.'}</Alert>;
  }
  const needs = pending ? transitionNeeds(wo.status, pending) : null;
  const submit = (to: string) => {
    const body: { id: string; to: string; note?: string; scheduledFor?: string; actualCents?: number } = { id: wo.id, to };
    const n = transitionNeeds(wo.status, to);
    if (n.note !== 'none' && note.trim()) body.note = note.trim();
    if (n.scheduledFor && when) body.scheduledFor = new Date(when).toISOString();
    if (n.actualCents && actual) body.actualCents = Math.round(Number(actual) * 100);
    transition.mutate(body, { onSuccess: () => { setPending(null); setNote(''); setWhen(''); setActual(''); } });
  };
  return (
    <section aria-labelledby="wo-actions" className="space-y-3">
      <h4 id="wo-actions" className="text-sm font-semibold text-navy-900">Actions</h4>
      <div className="flex flex-wrap gap-2">
        {wo.allowedTransitions.map((to) => {
          const n = transitionNeeds(wo.status, to);
          const direct = n.note === 'none' && !n.scheduledFor && !n.actualCents;
          const danger = to === 'canceled' || (to === 'triaged' && wo.status === 'assigned');
          return (
            <Button key={to} variant={danger ? 'danger' : pending === to ? 'primary' : 'secondary'} loading={transition.isPending && pending === to} aria-pressed={pending === to}
              onClick={() => (direct ? (setPending(to), submit(to)) : setPending(pending === to ? null : to))}>
              {transitionLabel(wo.status, to)}
            </Button>
          );
        })}
      </div>
      {pending && needs && (needs.note !== 'none' || needs.scheduledFor || needs.actualCents) && (
        <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={(e) => { e.preventDefault(); submit(pending); }}>
          {needs.scheduledFor && <Input label="Scheduled for" type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />}
          {needs.actualCents && <Input label="Actual cost (USD)" type="number" min={0} step="0.01" value={actual} onChange={(e) => setActual(e.target.value)} hint="Optional. Final amount for this job." />}
          {needs.note !== 'none' && <Textarea label={needs.note === 'required' ? 'Reason' : 'Note'} required={needs.note === 'required'} value={note} onChange={(e) => setNote(e.target.value)} hint={needs.note === 'required' ? 'Required. Recorded on the timeline and in the audit log.' : undefined} />}
          <div className="flex gap-2">
            <Button type="submit" loading={transition.isPending}>Confirm {transitionLabel(wo.status, pending).toLowerCase()}</Button>
            <Button type="button" variant="ghost" onClick={() => setPending(null)}>Back</Button>
          </div>
        </form>
      )}
      {transition.isError && <Alert tone="danger" title={transition.error instanceof ApiError ? transition.error.message : 'Transition failed'}>{transition.error instanceof ApiError && transition.error.code === 'invalid_transition' && 'The order changed state or a required detail is missing. Refresh and try again.'}</Alert>}
    </section>
  );
}

function AssignVendor({ wo }: { wo: WorkOrderDetailDto }) {
  const eligible = useEligibleVendors(wo.id);
  const assign = useAssignWorkOrder();
  const [vendorId, setVendorId] = useState('');
  return (
    <section aria-labelledby="assign-vendor" className="space-y-3 rounded-lg border border-line p-3">
      <h4 id="assign-vendor" className="text-sm font-semibold text-navy-900">{wo.assignedVendorId ? 'Reassign vendor' : 'Assign vendor'}</h4>
      <StateView isLoading={eligible.isLoading} error={eligible.error} data={eligible.data} isEmpty={(d) => d.items.length === 0} empty={{ title: 'No vendors yet', description: 'Add vendors in the rolodex, then approve them for assignment.' }} onRetry={() => void eligible.refetch()}>
        {(d) => (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (vendorId) assign.mutate({ id: wo.id, vendorId }, { onSuccess: () => setVendorId('') }); }}>
            <Select id="assign-vendor-select" label="Vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)} required>
              <option value="">Choose an eligible vendor…</option>
              {d.items.map((i) => (
                <option key={i.vendor.id} value={i.vendor.id} disabled={!i.eligible || i.vendor.id === wo.assignedVendorId}>
                  {i.eligible ? i.vendor.name : `${i.vendor.name} — ${i.reasons.map((r) => r.replace(/_/g, ' ')).join(', ')}`}
                </option>
              ))}
            </Select>
            <p className="text-xs text-muted">{d.items.filter((i) => i.eligible).length} of {d.items.length} vendors pass the rules for {CATEGORY_LABELS[d.category] ?? d.category} at this property (approved, trade, coverage, insurance, budget).</p>
            {assign.isError && <Alert tone="danger" title={assign.error instanceof ApiError ? assign.error.message : 'Assignment failed'}>{assign.error instanceof ApiError && assign.error.body.fieldErrors?.map((f) => f.message.replace(/_/g, ' ')).join(', ')}</Alert>}
            <Button type="submit" loading={assign.isPending} disabled={!vendorId}>Assign</Button>
          </form>
        )}
      </StateView>
    </section>
  );
}

function MediaPanel({ workOrderId, canUpload }: { workOrderId: string; canUpload: boolean }) {
  const media = useWorkOrderMedia(workOrderId);
  const upload = useUploadWorkOrderMedia();
  const unavailable = media.error instanceof ApiError && media.error.isNotFound;
  return (
    <section aria-labelledby="photo-evidence" className="space-y-3">
      <h4 id="photo-evidence" className="text-sm font-semibold text-navy-900">Photo evidence</h4>
      {unavailable ? (
        <Alert tone="neutral" title="Photo storage is not available in this build">Photos can be attached once the media service is enabled. Notes and the timeline still record everything else.</Alert>
      ) : (
        <StateView isLoading={media.isLoading} error={media.error} data={media.data} isEmpty={(d) => d.items.length === 0} empty={{ title: 'No photos yet', description: canUpload ? 'Add a photo of the issue or the completed work.' : 'Photos added by the resident or vendor appear here.' }} onRetry={() => void media.refetch()} skeleton="cards">
          {(d) => (
            <ul className="grid grid-cols-3 gap-2">
              {d.items.map((m) => (
                <li key={m.id} className="overflow-hidden rounded-lg border border-line bg-navy-50 p-2 text-xs">
                  {m.downloadUrl && m.mimeType.startsWith('image/') ? <img src={m.downloadUrl} alt={m.fileName} className="mb-1 h-20 w-full rounded object-cover" /> : <div aria-hidden className="mb-1 flex h-20 items-center justify-center rounded bg-navy-100 text-muted">file</div>}
                  <p className="truncate" title={m.fileName}>{m.fileName}</p>
                </li>
              ))}
            </ul>
          )}
        </StateView>
      )}
      {canUpload && !unavailable && (
        <div>
          <Input label="Add photo" type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate({ workOrderId, file: f }); e.target.value = ''; }} hint="JPEG or PNG up to 10 MB." />
          {upload.isError && <p className="mt-1 text-xs text-danger-600" role="alert">{upload.error instanceof ApiError && upload.error.isNotFound ? 'Photo upload is not available in this build.' : 'Upload failed.'}</p>}
          {upload.isSuccess && <p className="mt-1 text-xs text-success-700" role="status">Photo added.</p>}
        </div>
      )}
    </section>
  );
}

function Notes({ wo }: { wo: WorkOrderDetailDto }) {
  const add = useAddWorkOrderNote();
  const [body, setBody] = useState('');
  const isTenant = wo.actorKinds.includes('tenant') && !wo.actorKinds.includes('manager');
  if (wo.actorKinds.length === 0) return null;
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate({ id: wo.id, body: body.trim(), kind: isTenant ? 'message' : 'note' }, { onSuccess: () => setBody('') }); }}>
      <Textarea label={isTenant ? 'Message to your property manager' : 'Add note'} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} required />
      {add.isError && <Alert tone="danger" title="Could not add note" />}
      <Button type="submit" variant="secondary" loading={add.isPending}>{isTenant ? 'Send message' : 'Add note'}</Button>
    </form>
  );
}

function describeEvent(e: WorkOrderEventDto): string {
  const p = e.payload as Record<string, string | undefined>;
  switch (e.eventType) {
    case 'created': return `Request created (${p.priority ?? ''} priority)`;
    case 'status_changed': return `Status ${p.from} → ${p.to}${p.note ? `: ${p.note}` : ''}`;
    case 'assigned': return `Assigned to ${p.vendorName ?? p.userName ?? 'assignee'}`;
    case 'unassigned': return `Assignment removed${p.reason ? `: ${p.reason}` : ''}`;
    case 'note': return `Note: ${p.body ?? ''}`;
    case 'message': return `Message: ${p.body ?? ''}`;
    case 'media_added': return 'Photos attached';
    case 'sla_breached': return `SLA breached (${p.hoursOverdue ?? '?'}h overdue)`;
    case 'escalated': return `Priority changed ${p.from} → ${p.to}`;
    case 'duplicate': return `Marked duplicate of ${p.duplicateOfId}`;
    default: return e.eventType;
  }
}

function Timeline({ events }: { events: WorkOrderEventDto[] }) {
  if (events.length === 0) return <EmptyState title="No activity yet" />;
  return (
    <section aria-labelledby="wo-timeline">
      <h4 id="wo-timeline" className="text-sm font-semibold text-navy-900">Timeline</h4>
      <ol className="mt-2 space-y-2 border-l-2 border-line pl-4">
        {[...events].reverse().map((e) => (
          <li key={e.id} className="relative text-sm">
            <span aria-hidden className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${e.eventType === 'sla_breached' ? 'bg-danger-600' : e.eventType === 'status_changed' ? 'bg-cobalt-500' : 'bg-navy-200'}`} />
            <p className="text-ink">{describeEvent(e)}</p>
            <p className="text-xs text-muted">{e.actorName ?? (e.actorId ? 'User' : 'System')} · {fmtDate(e.createdAt)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
