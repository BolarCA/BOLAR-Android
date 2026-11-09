'use client';
import { useState } from 'react';
import { ENTRY_PERMISSIONS, WORK_ORDER_CATEGORIES, WORK_ORDER_PRIORITIES } from '@bolar/contracts';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useCreateWorkOrder, useUploadWorkOrderMedia, useWorkOrders, type WorkOrderDto } from '@/lib/hooks/maintenance';
import { Alert, Button, Card, Drawer, Input, PageHeader, Select, Table } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { WorkOrderDetail } from './work-order-detail';
import { CATEGORY_LABELS, ENTRY_LABELS, PRIORITY_LABELS, PriorityBadge, SlaChip, StatusBadge, Textarea, fmtDate, humanizeDuration } from './labels';

const PRIORITY_GUIDANCE: Record<string, string> = {
  emergency: 'Active flooding, gas smell, no heat in freezing weather, electrical sparks, lock-out or anything unsafe. Target response: 24 hours. If anyone is in danger call 911 first.',
  high: 'No hot water, a broken fridge or stove, a leak you can contain, a broken window or door lock. Target response: 3 days.',
  normal: 'Something is broken but you can live with it for a bit. Target response: 7 days.',
  low: 'Cosmetic issues and small annoyances. Target response: 14 days.',
};

type Window = { start: string; end: string };

/** Resident maintenance intake (Day 31) with confirmation state, photo upload after creation, and "my requests". */
export function TenantMaintenance() {
  const canRequest = useCan('maintenance:request');
  const [open, setOpen] = useState<string | null>(null);
  const mine = useWorkOrders({ includeCanceled: 'true' }, { limit: 50 });
  return (
    <>
      <PageHeader title="Maintenance" description="Tell us what needs fixing. You will get a request number right away and can follow progress here." />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {canRequest ? <IntakeForm onCreated={(id) => setOpen(id)} /> : <Alert tone="neutral" title="Your account cannot file requests">Ask your property manager to link your lease to your login.</Alert>}
        </div>
        <div className="lg:col-span-2">
          <Card title="My requests">
            <StateView isLoading={mine.isLoading} error={mine.error} data={mine.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No requests yet', description: 'Your submitted requests and their status will show here.' }} onRetry={() => void mine.refetch()}>
              {(d) => (
                <Table<WorkOrderDto> caption="My maintenance requests" rows={d.pages.flatMap((p) => p.items)} onRowClick={(w) => setOpen(w.id)} columns={[
                  { key: 'title', header: 'Request', render: (w) => <div><p className="font-medium">{w.title}</p><p className="text-xs text-muted">{w.number} · {fmtDate(w.createdAt)}</p></div> },
                  { key: 'status', header: 'Status', render: (w) => <div className="flex flex-col gap-1"><StatusBadge status={w.status} /><SlaChip slaDueAt={w.slaDueAt} overdue={w.overdue} status={w.status} completedAt={w.completedAt} /></div> },
                  { key: 'open', header: '', className: 'text-right', render: (w) => <Button variant="ghost" onClick={(e) => { e.stopPropagation(); setOpen(w.id); }} aria-label={`Open request ${w.title}`}>View</Button> },
                ]} />
              )}
            </StateView>
          </Card>
        </div>
      </div>
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title="Your request">{open && <WorkOrderDetail id={open} onClose={() => setOpen(null)} />}</Drawer>
    </>
  );
}

function IntakeForm({ onCreated }: { onCreated: (id: string) => void }) {
  const create = useCreateWorkOrder();
  const upload = useUploadWorkOrderMedia();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('plumbing');
  const [priority, setPriority] = useState<string>('normal');
  const [description, setDescription] = useState('');
  const [entry, setEntry] = useState<string>('ask');
  const [windows, setWindows] = useState<Window[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'done' | 'unavailable' | 'failed'>('idle');

  const reset = () => { create.reset(); setTitle(''); setDescription(''); setPriority('normal'); setCategory('plumbing'); setEntry('ask'); setWindows([]); setFiles([]); setUploadState('idle'); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const availability = windows.filter((w) => w.start && w.end).map((w) => ({ start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() }));
    create.mutate({ title, category: category as never, priority: priority as never, description, entryPermission: entry as never, availability }, {
      onSuccess: async (wo) => {
        onCreated(wo.id);
        if (files.length === 0) return;
        setUploadState('uploading');
        try {
          for (const file of files) await upload.mutateAsync({ workOrderId: wo.id, file });
          setUploadState('done');
        } catch (err) {
          setUploadState(err instanceof ApiError && err.isNotFound ? 'unavailable' : 'failed');
        }
      },
    });
  }

  if (create.isSuccess) {
    const wo = create.data;
    const slaIn = wo.slaDueAt ? humanizeDuration(new Date(wo.slaDueAt).getTime() - Date.now()) : null;
    return (
      <Card>
        <div data-state="confirmation" className="space-y-4">
          <Alert tone="success" title={`Request ${wo.number} received`}>
            <p>We logged your <strong>{PRIORITY_LABELS[wo.priority]?.toLowerCase()}</strong> {CATEGORY_LABELS[wo.category]?.toLowerCase()} request{wo.unit ? ` for unit ${wo.unit.unitNumber}` : ''}.{slaIn ? ` Target response: within ${slaIn}.` : ''}</p>
            {wo.priority === 'emergency' && <p className="mt-2 font-semibold">If anyone is in danger or there is a gas smell, call 911 now, then your emergency line.</p>}
          </Alert>
          {wo.possibleDuplicateId && <Alert tone="warning" title="This may duplicate an open request">A similar {CATEGORY_LABELS[wo.category]?.toLowerCase()} request for your unit is already open. Your manager will merge them if so; nothing else to do.</Alert>}
          {uploadState === 'uploading' && <p role="status" className="text-sm text-muted">Uploading {files.length} photo(s)…</p>}
          {uploadState === 'done' && <p role="status" className="text-sm text-success-700">{files.length} photo(s) attached.</p>}
          {uploadState === 'unavailable' && <Alert tone="neutral" title="Photos could not be attached">Photo upload is not available in this build. Your request was still submitted; a manager may ask for photos later.</Alert>}
          {uploadState === 'failed' && <Alert tone="danger" title="Photo upload failed">Your request was submitted. You can try adding photos again from the request details.</Alert>}
          <div className="flex gap-2">
            <Button onClick={() => onCreated(wo.id)}>View request</Button>
            <Button variant="secondary" onClick={reset}>Submit another</Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card title="New request">
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate={false}>
        <Input label="Title" required minLength={3} maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kitchen sink is leaking" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {WORK_ORDER_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </Select>
          <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} aria-describedby="priority-guidance">
            {WORK_ORDER_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </Select>
        </div>
        <p id="priority-guidance" className={priority === 'emergency' ? 'rounded-lg border border-danger-100 bg-danger-100/60 p-3 text-sm text-ink' : 'text-xs text-muted'}>
          <PriorityBadge priority={priority} /> <span className="ml-1">{PRIORITY_GUIDANCE[priority]}</span>
        </p>
        <Textarea label="Description" required minLength={10} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} hint="What is happening, where, and since when. At least 10 characters." />
        <Select label="Entry permission" value={entry} onChange={(e) => setEntry(e.target.value)}>
          {ENTRY_PERMISSIONS.map((p) => <option key={p} value={p}>{ENTRY_LABELS[p]}</option>)}
        </Select>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-navy-900">When are you available? <span className="font-normal text-muted">(optional, up to 3 windows)</span></legend>
          {windows.map((w, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input id={`win-start-${i}`} label={`Window ${i + 1} start`} type="datetime-local" value={w.start} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <Input id={`win-end-${i}`} label={`Window ${i + 1} end`} type="datetime-local" value={w.end} onChange={(e) => setWindows(windows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
              <Button type="button" variant="ghost" className="self-end" onClick={() => setWindows(windows.filter((_, j) => j !== i))} aria-label={`Remove window ${i + 1}`}>Remove</Button>
            </div>
          ))}
          {windows.length < 3 && <Button type="button" variant="secondary" onClick={() => setWindows([...windows, { start: '', end: '' }])}>Add availability window</Button>}
        </fieldset>
        <Input label="Photos" type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} hint="Optional. Uploaded after your request is created." />
        {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not submit request'}>{create.error instanceof ApiError && create.error.body.fieldErrors?.map((f) => <p key={f.path}>{f.message}</p>)}</Alert>}
        <Button type="submit" loading={create.isPending}>Submit request</Button>
      </form>
    </Card>
  );
}
