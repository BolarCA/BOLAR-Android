'use client';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api-client';
import { useCan } from '@/lib/auth';
import { Alert, Badge, Button, Card, Drawer, Input, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { REPORT_KIND_LABELS, fmtDate, useCreateReportDefinition, useReportDefinitions, useReportRun, useReportRuns, useRunReportDefinition, type ReportDefinitionDto, type ReportRunDto } from '@/lib/hooks/reporting';
import { REPORT_KINDS } from '@bolar/contracts';
import { LoadMore, flatItems } from './shared';

/** Scheduled reports: definitions (kind, filters, cron, recipients, format), manual runs and audited downloads. */
export function ScheduledReports({ allowedKinds = [...REPORT_KINDS] as string[] }: { allowedKinds?: string[] }) {
  const canRead = useCan('finance:read');
  const [open, setOpen] = useState(false);
  const defs = useReportDefinitions({}, canRead);
  const runs = useReportRuns({}, canRead);
  const run = useRunReportDefinition();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Scheduled reports" actions={<Button onClick={() => setOpen(true)}>New scheduled report</Button>}>
        <p className="mb-3 text-sm text-muted">Each definition is a report kind, filters, an optional cron schedule, recipients and a format. The daily job runs due definitions; Run now exports immediately.</p>
        {run.isError && <div className="mb-3"><Alert tone="danger" title="Run failed">{run.error instanceof ApiError ? run.error.message : 'Unknown error'}</Alert></div>}
        <StateView isLoading={defs.isLoading} error={defs.error} data={defs.data} isEmpty={(d) => flatItems(d).length === 0} empty={{ title: 'No scheduled reports yet', description: 'Create one to export a report on a schedule or on demand.', action: <Button onClick={() => setOpen(true)}>New scheduled report</Button> }} onRetry={() => void defs.refetch()}>
          {(d) => (
            <>
              <Table<ReportDefinitionDto> caption="Report definitions" rows={flatItems(d)} columns={[
                { key: 'name', header: 'Report', render: (r) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-muted">{REPORT_KIND_LABELS[r.kind] ?? r.kind} · {r.format.toUpperCase()}{r.scopeJson ? ` · ${r.scopeJson.propertyIds.length} propert${r.scopeJson.propertyIds.length === 1 ? 'y' : 'ies'}` : ''}</p></div> },
                { key: 'cron', header: 'Schedule', render: (r) => r.scheduleCron ? <code className="text-xs">{r.scheduleCron}</code> : <span className="text-muted">On demand</span> },
                { key: 'last', header: 'Last run', render: (r) => r.lastRunAt ? fmtDate(r.lastRunAt) : '—' },
                { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
                { key: 'run', header: '', render: (r) => <Button variant="secondary" aria-label={`Run ${r.name} now`} disabled={r.status !== 'active'} loading={run.isPending && run.variables === r.id} onClick={() => run.mutate(r.id)}>Run now</Button> },
              ]} />
              <LoadMore list={defs} />
            </>
          )}
        </StateView>
      </Card>
      <Card title="Recent runs">
        <StateView isLoading={runs.isLoading} error={runs.error} data={runs.data} isEmpty={(d) => flatItems(d).length === 0} empty={{ title: 'No runs yet', description: 'Runs appear here with their row count and a download link once complete.' }} onRetry={() => void runs.refetch()}>
          {(d) => (
            <>
              <Table<ReportRunDto> caption="Report runs" rows={flatItems(d)} columns={[
                { key: 'def', header: 'Report', render: (r) => <div><p className="font-medium">{r.definitionName ?? r.definitionId}</p><p className="text-xs text-muted">{r.kind ? REPORT_KIND_LABELS[r.kind] : ''} · {r.format.toUpperCase()} · {r.trigger}</p></div> },
                { key: 'when', header: 'Requested', render: (r) => fmtDate(r.createdAt) },
                { key: 'rows', header: 'Rows', className: 'text-right', render: (r) => r.rowCount ?? '—' },
                { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
                { key: 'dl', header: '', render: (r) => <DownloadCell run={r} /> },
              ]} />
              <LoadMore list={runs} />
            </>
          )}
        </StateView>
      </Card>
      <CreateDefinitionDrawer open={open} onClose={() => setOpen(false)} allowedKinds={allowedKinds} />
    </div>
  );
}

/** Download is a second, audited call (`report.downloaded`) that returns a short-lived signed URL. */
function DownloadCell({ run }: { run: ReportRunDto }) {
  const [wanted, setWanted] = useState(false);
  const detail = useReportRun(wanted ? run.id : null);
  if (run.status !== 'complete' || !run.storageKey) return run.status === 'failed' ? <span className="text-xs text-danger-600">{run.error ?? 'failed'}</span> : null;
  if (detail.data?.download) return <a className="text-sm font-semibold text-cobalt-600 underline" href={detail.data.download.url} target="_blank" rel="noreferrer" data-testid="report-download-link">Open {run.format.toUpperCase()}</a>;
  return <Button variant="ghost" aria-label={`Download ${run.definitionName ?? 'report'} run`} loading={detail.isFetching} onClick={() => setWanted(true)}>Download</Button>;
}

function CreateDefinitionDrawer({ open, onClose, allowedKinds }: { open: boolean; onClose: () => void; allowedKinds: string[] }) {
  const create = useCreateReportDefinition();
  const [name, setName] = useState('');
  const [kind, setKind] = useState(allowedKinds[0] ?? 'rent_roll');
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [cron, setCron] = useState('');
  const [recipients, setRecipients] = useState('');
  const [months, setMonths] = useState('12');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name, kind: kind as never, format, scheduleCron: cron.trim() || null, recipients: recipients.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean), filters: kind === 'collections' ? { months: Number(months) } : undefined },
      { onSuccess: () => { setName(''); setCron(''); setRecipients(''); onClose(); } },
    );
  };
  const err = create.error instanceof ApiError ? create.error : null;
  const fieldError = (path: string) => err?.body.fieldErrors?.find((f) => f.path.endsWith(path))?.message;
  return (
    <Drawer open={open} onClose={onClose} title="New scheduled report">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required minLength={3} maxLength={120} error={fieldError('name')} />
        <Select label="Report kind" value={kind} onChange={(e) => setKind(e.target.value)}>{allowedKinds.map((k) => <option key={k} value={k}>{REPORT_KIND_LABELS[k] ?? k}</option>)}</Select>
        <Select label="Format" value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'json')}><option value="csv">CSV</option><option value="json">JSON</option></Select>
        {kind === 'collections' && <Select label="Months" value={months} onChange={(e) => setMonths(e.target.value)}>{[3, 6, 12, 24].map((m) => <option key={m} value={m}>Last {m} months</option>)}</Select>}
        <Input label="Schedule (cron)" value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 6 1 * *" hint="5-field cron; leave empty for on-demand only. The daily job runs definitions due that day." error={fieldError('scheduleCron')} />
        <Input label="Recipients" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="books@example.test, owner@example.test" hint="Comma-separated email addresses notified when a run completes." error={fieldError('recipients')} />
        {err && !err.body.fieldErrors?.length && <Alert tone="danger" title="Could not create the report">{err.message}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={create.isPending}>Create report</Button>
        </div>
      </form>
    </Drawer>
  );
}
