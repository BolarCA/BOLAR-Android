'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useAddDeadline, useCase, useCaseLegalHold, useCaseTimeline, useUpdateCase, type CaseDto } from '@/lib/hooks/legal';
import { auditManifestUrl, useExport, useExportDecision, useExports, useRequestExport, type ExportJobDto } from '@/lib/hooks/packet-export';
import { Alert, Badge, Button, Card, Input, Modal, PageHeader, Select, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { dueLabel, fmtDate, fmtDateTime, humanize, shortId } from './util';

const NEXT: Record<CaseDto['status'], CaseDto['status'][]> = { open: ['active', 'on_hold', 'closed'], active: ['on_hold', 'closed'], on_hold: ['active', 'closed'], closed: [] };

/** p52 case detail: privileged banner, deadlines, related records, legal hold, evidence packet gate, timeline. */
export function CaseDetail({ id }: { id: string }) {
  const q = useCase(id);
  return (
    <StateView isLoading={q.isLoading} error={q.error} data={q.data} onRetry={() => void q.refetch()} skeleton="detail" resource={{ type: 'case', id, classification: 'restricted' }}>
      {(c) => <CaseBody c={c} />}
    </StateView>
  );
}

function CaseBody({ c }: { c: CaseDto }) {
  const { me } = useAuth();
  const update = useUpdateCase();
  const addDeadline = useAddDeadline();
  const holdM = useCaseLegalHold();
  const canWrite = useCan('case:write');
  const canHold = useCan('legal_hold:write');
  const [holdOpen, setHoldOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [dlTitle, setDlTitle] = useState('');
  const [dlDue, setDlDue] = useState('');
  const held = (c.activeHoldIds?.length ?? 0) > 0;

  return (
    <>
      <Alert tone="violet" title="Privileged and confidential">This case thread is restricted to lead counsel and representatives. Access is logged in the audit trail{me ? ` for ${me.actor.email}` : ''}.</Alert>
      <div className="mt-4">
        <PageHeader title={c.title} description={`${humanize(c.kind)} · opened ${fmtDate(c.createdAt)} · lead ${shortId(c.leadLawyerId)}`}
          actions={<div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
            {held ? <Badge tone="danger">legal hold active</Badge> : <Badge>no legal hold</Badge>}
            {canHold && !held && c.status !== 'closed' && <Button variant="secondary" onClick={() => setHoldOpen(true)}>Place legal hold</Button>}
          </div>} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Deadlines and tasks" className="lg:col-span-2">
          {c.deadlines.length === 0 && <p className="text-sm text-muted">No deadlines yet.</p>}
          <ul className="divide-y divide-line">
            {[...c.deadlines].sort((a, b) => a.dueAt.localeCompare(b.dueAt)).map((d) => { const l = d.done ? { text: 'done', tone: 'success' as const } : dueLabel(d.dueAt); return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div><p className={d.done ? 'text-sm line-through text-muted' : 'text-sm font-medium'}>{d.title}</p><p className="text-xs text-muted">{fmtDateTime(d.dueAt)}</p></div>
                <div className="flex items-center gap-2"><Badge tone={l.tone}>{l.text}</Badge>
                  {canWrite && !d.done && <Button variant="ghost" aria-label={`Mark ${d.title} done`} onClick={() => update.mutate({ id: c.id, deadlines: c.deadlines.map((x) => (x.id === d.id ? { ...x, done: true } : x)) })}>Mark done</Button>}
                </div>
              </li>
            ); })}
          </ul>
          {canWrite && (
            <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); addDeadline.mutate({ id: c.id, title: dlTitle, dueAt: new Date(dlDue).toISOString() }, { onSuccess: () => { setDlTitle(''); setDlDue(''); } }); }}>
              <Input label="New deadline" required value={dlTitle} onChange={(e) => setDlTitle(e.target.value)} placeholder="e.g. File petition" />
              <Input label="Due" type="datetime-local" required value={dlDue} onChange={(e) => setDlDue(e.target.value)} />
              <Button type="submit" loading={addDeadline.isPending}>Add</Button>
            </form>
          )}
          {addDeadline.isError && <Alert tone="danger" title={addDeadline.error instanceof ApiError ? addDeadline.error.message : 'Could not add deadline'} />}
        </Card>
        <div className="space-y-4">
          <Card title="Status">
            {canWrite && NEXT[c.status].length > 0 ? (
              <Select label="Move to" value="" onChange={(e) => { if (e.target.value) update.mutate({ id: c.id, status: e.target.value, note: 'Status changed from case workspace' }); }}>
                <option value="">Choose…</option>{NEXT[c.status].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
              </Select>
            ) : <p className="text-sm text-muted">{c.status === 'closed' ? 'Closed cases cannot be reopened.' : 'Read only.'}</p>}
            {update.isError && <p className="mt-2 text-xs text-danger-600" role="alert">{update.error instanceof ApiError ? update.error.message : 'Update failed'}</p>}
          </Card>
          <Card title="Related records">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-muted">Lease</dt><dd>{c.leaseId ? <Link className="text-cobalt-600 underline" href={`/manager/leases/${c.leaseId}`}>{shortId(c.leaseId)}</Link> : '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Property</dt><dd>{c.propertyId ? <Link className="text-cobalt-600 underline" href={`/manager/properties/${c.propertyId}`}>{shortId(c.propertyId)}</Link> : '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Tenant profile</dt><dd>{c.tenantProfileId ? <Link className="text-cobalt-600 underline" href={`/manager/tenants/${c.tenantProfileId}`}>{shortId(c.tenantProfileId)}</Link> : '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Legal holds</dt><dd>{held ? <Link className="text-cobalt-600 underline" href="/legal/legal-holds">{c.activeHoldIds!.length} active</Link> : 'none'}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <EvidencePanel c={c} />
        <Timeline id={c.id} />
      </div>
      <Modal open={holdOpen} onClose={() => setHoldOpen(false)} title="Place a legal hold"
        footer={<><Button variant="secondary" onClick={() => setHoldOpen(false)}>Cancel</Button><Button loading={holdM.isPending} onClick={() => holdM.mutate({ id: c.id, reason, note }, { onSuccess: () => { setHoldOpen(false); setReason(''); setNote(''); } })}>Create hold</Button></>}>
        <p className="text-sm text-muted">Scope: this case{c.leaseId ? ', its lease' : ''}{c.propertyId ? ', the property' : ''}{c.tenantProfileId ? ' and the tenant profile' : ''}. Deletion and retention actions are blocked while the hold is active.</p>
        <div className="mt-3 space-y-3">
          <Input label="Reason" required minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Input label="Counsel approval note" required minLength={5} value={note} onChange={(e) => setNote(e.target.value)} />
          {holdM.isError && <Alert tone="danger" title={holdM.error instanceof ApiError ? holdM.error.message : 'Could not create hold'} />}
        </div>
      </Modal>
    </>
  );
}

function EvidencePanel({ c }: { c: CaseDto }) {
  const { me } = useAuth();
  const canRequest = useCan('export:request');
  const canApprove = useCan('export:approve');
  const canAudit = useCan('audit:read');
  const exportsQ = useExports({ sourceType: 'case', sourceId: c.id }, canRequest);
  const request = useRequestExport();
  const decide = useExportDecision();
  const [note, setNote] = useState('');
  return (
    <Card title="Evidence packet" actions={canRequest && <Button variant="secondary" loading={request.isPending} onClick={() => request.mutate({ kind: 'evidence_packet', sourceType: 'case', sourceId: c.id, redaction: { fields: ['ssnLast4', 'dateOfBirth'] } })}>Request export</Button>}>
      <p className="mb-3 text-xs text-muted">Exports are drafts until a different reviewer approves them. The manifest lists files, hashes, audit events, filters, redaction and the reviewer.</p>
      {request.isError && <Alert tone="danger" title={request.error instanceof ApiError ? request.error.message : 'Could not request export'} />}
      {!canRequest ? <p className="text-sm text-muted">Your role cannot request exports.</p> : (
        <StateView isLoading={exportsQ.isLoading} error={exportsQ.error} data={exportsQ.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No packets requested', description: 'Request an export to assemble the case packet.' }} onRetry={() => void exportsQ.refetch()}>
          {(d) => (
            <ul className="divide-y divide-line">
              {d.pages.flatMap((p) => p.items).map((j: ExportJobDto) => (
                <li key={j.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><p className="text-sm font-medium">{humanize(j.kind)} · {shortId(j.id)}</p><p className="text-xs text-muted">requested {fmtDateTime(j.createdAt)}{j.redactionJson.fields?.length ? ` · redacts ${j.redactionJson.fields.join(', ')}` : ''}</p></div>
                    <Badge tone={statusTone(j.status)}>{j.status}</Badge>
                  </div>
                  {j.status === 'requested' && canApprove && j.requestedBy !== me?.actor.id && (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <Input label="Review note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this packet may be released" />
                      <Button loading={decide.isPending} onClick={() => decide.mutate({ id: j.id, decision: 'approve', note: note || 'Approved from case workspace' })}>Approve export</Button>
                      <Button variant="ghost" onClick={() => decide.mutate({ id: j.id, decision: 'deny', note: note || 'Denied from case workspace' })}>Deny</Button>
                    </div>
                  )}
                  {j.status === 'requested' && j.requestedBy === me?.actor.id && <p className="mt-1 text-xs text-muted">Awaiting a different approver (you requested this packet).</p>}
                  {j.status === 'complete' && <ExportSummary id={j.id} />}
                  {j.status === 'failed' && <p className="mt-1 text-xs text-danger-600">{j.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </StateView>
      )}
      {decide.isError && <Alert tone="danger" title={decide.error instanceof ApiError ? decide.error.message : 'Decision failed'} />}
      {canAudit && <p className="mt-3 text-xs"><a className="text-cobalt-600 underline" href={auditManifestUrl('case', c.id)} target="_blank" rel="noreferrer">Audit manifest for this case (JSON)</a></p>}
    </Card>
  );
}

export function ExportSummary({ id }: { id: string }) {
  const q = useExport(id);
  if (!q.data) return <p className="mt-1 text-xs text-muted">Loading manifest…</p>;
  const m = q.data.manifestJson;
  return (
    <div className="mt-2 rounded-lg bg-navy-50 p-3 text-xs" data-testid="export-manifest">
      <p><span className="font-semibold">Manifest</span> · {m?.counts.files ?? 0} files · {m?.counts.auditEvents ?? 0} audit events · {m?.counts.subjects ?? 0} subjects</p>
      <p className="mt-1 break-all">sha256 <code>{q.data.manifestSha256}</code></p>
      {q.data.download && <a className="mt-1 inline-block text-cobalt-600 underline" href={q.data.download.url} target="_blank" rel="noreferrer">Download manifest</a>}
    </div>
  );
}

function Timeline({ id }: { id: string }) {
  const q = useCaseTimeline(id);
  return (
    <Card title="Timeline">
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No events yet' }} onRetry={() => void q.refetch()}>
        {(d) => (
          <ol className="space-y-2 text-sm">
            {d.pages.flatMap((p) => p.items).map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 border-l-2 border-cobalt-100 pl-3">
                <span><code className="text-xs">{e.action}</code> <span className="text-xs text-muted">on {e.resourceType}</span></span>
                <span className="text-xs text-muted">{fmtDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ol>
        )}
      </StateView>
    </Card>
  );
}
