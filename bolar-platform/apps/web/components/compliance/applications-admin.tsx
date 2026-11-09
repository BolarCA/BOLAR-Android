'use client';
import { useEffect, useState } from 'react';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { REASON_CODES, useAdverseAction, useApplication, useApplicationAction, useApplicationLookups, useApplications, useCreateApplication, useDecideApplication, useRunScreening, useScreeningResult, type AdverseActionDto, type ApplicationDto, type ScreeningOrderDto } from '@/lib/hooks/screening';
import { Alert, Button, Card, Drawer, Modal, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { Pill } from './pill';
import { StateView } from '@/components/ui/state-view';

/** /manager/applications: applications list, consent capture, screening order/run, restricted result, human decision, adverse action timeline. */
export function ApplicationsAdmin() {
  const canWrite = useCan('application:write');
  const q = useApplications();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { const f = new URLSearchParams(window.location.search).get('focus'); if (f) setSelectedId(f); }, []);
  return (
    <>
      <PageHeader title="Applications and screening" description="Consent gates every provider call, reports stay restricted, and a human records each decision. Adverse actions follow the FCRA pre-adverse, waiting period and final notice flow." actions={canWrite && <Button onClick={() => setCreateOpen(true)}>New application</Button>} />
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void q.refetch()} empty={{ title: 'No applications yet', description: 'Create an application for a prospective tenant to start screening.', action: canWrite && <Button onClick={() => setCreateOpen(true)}>New application</Button> }}>
        {(d) => (
          <Table<ApplicationDto> caption="Applications" rows={d.pages.flatMap((p) => p.items)} onRowClick={(a) => setSelectedId(a.id)} columns={[
            { key: 'applicant', header: 'Applicant', render: (a) => <div><p className="font-medium">{a.applicantName ?? a.applicantId}</p><p className="text-xs text-muted">{a.propertyName ?? a.propertyId}</p></div> },
            { key: 'status', header: 'Status', render: (a) => <Pill tone={statusTone(a.status)}>{a.status.replace(/_/g, ' ')}</Pill> },
            { key: 'submitted', header: 'Submitted', render: (a) => (a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : '—') },
            { key: 'decided', header: 'Decided', render: (a) => (a.decidedAt ? new Date(a.decidedAt).toLocaleDateString() : '—') },
            { key: 'open', header: '', className: 'text-right', render: (a) => <Button variant="secondary" onClick={(e) => { e.stopPropagation(); setSelectedId(a.id); }} aria-label={`Open application for ${a.applicantName ?? a.applicantId}`}>Open</Button> },
          ]} />
        )}
      </StateView>
      <CreateApplicationDrawer open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => { setCreateOpen(false); setSelectedId(id); }} />
      {selectedId && <ApplicationDrawer id={selectedId} onClose={() => setSelectedId(null)} />}
    </>
  );
}

function CreateApplicationDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const lookups = useApplicationLookups(open);
  const create = useCreateApplication();
  const [propertyId, setPropertyId] = useState('');
  const [applicantId, setApplicantId] = useState('');
  return (
    <Drawer open={open} onClose={onClose} title="New application">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ propertyId, applicantId }, { onSuccess: (a) => onCreated(a.id) }); }}>
        <Select label="Property" required value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          <option value="">Select a property</option>
          {lookups.data?.properties.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.city}, {p.state}</option>)}
        </Select>
        <Select label="Applicant" required value={applicantId} onChange={(e) => setApplicantId(e.target.value)}>
          <option value="">Select an applicant profile</option>
          {lookups.data?.applicants.map((a) => <option key={a.id} value={a.id}>{a.displayName} ({a.status})</option>)}
        </Select>
        {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not create application'} />}
        <div className="flex gap-2"><Button type="submit" loading={create.isPending} disabled={!propertyId || !applicantId}>Create application</Button><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button></div>
      </form>
    </Drawer>
  );
}

function ApplicationDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useApplication(id);
  const act = useApplicationAction();
  const run = useRunScreening();
  const canOrder = useCan('screening:order');
  const canDecide = useCan('adverse_action:manage');
  const canWrite = useCan('application:write');
  const [deciding, setDeciding] = useState(false);
  const app = q.data;
  const orders = app?.screeningOrders ?? [];
  const latestOrder = orders[orders.length - 1];
  const consented = orders.some((o) => o.consentAt);
  const err = act.error ?? run.error;
  return (
    <Drawer open onClose={onClose} title="Application">
      <StateView isLoading={q.isLoading} error={q.error} data={app} onRetry={() => void q.refetch()} skeleton="detail">
        {(a) => (
          <div className="space-y-5 text-sm" data-testid="application-detail">
            <div className="flex flex-wrap items-center gap-2"><Pill tone={statusTone(a.status)}>{a.status.replace(/_/g, ' ')}</Pill><span className="font-medium">{a.applicantName}</span><span className="text-muted">· {a.propertyName}</span></div>
            {err && <Alert tone="danger" title={err instanceof ApiError ? err.message : 'Action failed'} />}
            <Card title="Workflow">
              <div className="flex flex-wrap gap-2">
                {canWrite && a.status === 'draft' && <Button loading={act.isPending} onClick={() => act.mutate({ id: a.id, action: 'submit' })}>Submit application</Button>}
                {canWrite && ['submitted', 'screening', 'review'].includes(a.status) && !consented && <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate({ id: a.id, action: 'consent', body: { consentDocumentId: 'consent-form-on-file' } })}>Record applicant consent</Button>}
                {canOrder && a.status === 'submitted' && <Button loading={act.isPending} onClick={() => act.mutate({ id: a.id, action: 'screening-orders', body: {} })}>Order screening</Button>}
                {canOrder && latestOrder?.status === 'ordered' && <Button loading={run.isPending} onClick={() => run.mutate(latestOrder.id)}>Run screening (mock provider)</Button>}
                {canDecide && a.status === 'review' && <Button onClick={() => setDeciding(true)}>Record decision</Button>}
                {canWrite && ['draft', 'submitted', 'screening', 'review'].includes(a.status) && <Button variant="ghost" onClick={() => act.mutate({ id: a.id, action: 'withdraw' })}>Withdraw</Button>}
              </div>
              <p className="mt-3 text-xs text-muted">Consent is required before any provider call (FCRA §604). Decisions are recorded by a person; AI never decides screening outcomes.</p>
            </Card>
            {orders.length > 0 && (
              <Card title="Screening orders">
                <ul className="space-y-2">{orders.map((o) => <OrderRow key={o.id} order={o} />)}</ul>
              </Card>
            )}
            {a.adverseActions.length > 0 && (
              <Card title="Adverse action timeline">
                <ul className="space-y-3">{a.adverseActions.map((aa) => <AdverseRow key={aa.id} aa={aa} canDecide={canDecide} />)}</ul>
              </Card>
            )}
            {deciding && <DecideModal id={a.id} onClose={() => setDeciding(false)} />}
          </div>
        )}
      </StateView>
    </Drawer>
  );
}

function OrderRow({ order }: { order: ScreeningOrderDto }) {
  const [showResult, setShowResult] = useState(false);
  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2"><Pill tone={statusTone(order.status)}>{order.status.replace(/_/g, ' ')}</Pill><span className="text-xs text-muted">{order.provider} · consent {order.consentAt ? new Date(order.consentAt).toLocaleDateString() : 'not recorded'}</span></div>
      {order.resultId && <Button variant="secondary" className="mt-2" onClick={() => setShowResult((s) => !s)} aria-expanded={showResult}>{showResult ? 'Hide report' : 'View report (restricted)'}</Button>}
      {showResult && order.resultId && <ResultPanel orderId={order.id} resultId={order.resultId} />}
    </li>
  );
}

function ResultPanel({ orderId, resultId }: { orderId: string; resultId: string }) {
  const r = useScreeningResult(orderId);
  return (
    <div className="mt-3" data-testid="screening-result">
      <StateView isLoading={r.isLoading} error={r.error} data={r.data} onRetry={() => void r.refetch()} skeleton="detail" resource={{ type: 'screening_result', id: resultId, classification: 'restricted' }}>
        {(res) => (
          <div className="space-y-2 rounded-lg bg-navy-50 p-3">
            <p><Pill tone="danger">restricted</Pill> received {new Date(res.receivedAt).toLocaleString()}</p>
            {res.summary ? <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm"><dt className="text-muted">Recommendation</dt><dd className="font-medium">{res.summary.recommendation}</dd><dt className="text-muted">Credit band</dt><dd>{res.summary.creditBand ?? '—'}</dd><dt className="text-muted">Eviction records</dt><dd>{res.summary.evictionRecords}</dd><dt className="text-muted">Criminal records</dt><dd>{res.summary.criminalRecords}</dd><dt className="text-muted">Provider</dt><dd>{res.summary.providerContact}</dd></dl> : <p className="text-muted">Summary pending from provider.</p>}
            {res.download && <a className="text-cobalt-600 underline" href={res.download.url} target="_blank" rel="noreferrer">Download report (link expires {new Date(res.download.expiresAt).toLocaleTimeString()})</a>}
            <p className="text-xs text-muted">The provider recommendation is advisory. Only a human decision below changes the application.</p>
          </div>
        )}
      </StateView>
    </div>
  );
}

function AdverseRow({ aa, canDecide }: { aa: AdverseActionDto; canDecide: boolean }) {
  const m = useAdverseAction();
  const remaining = aa.waitingPeriodEndsAt ? Math.ceil((new Date(aa.waitingPeriodEndsAt).getTime() - Date.now()) / 86_400_000) : null;
  return (
    <li className="rounded-lg border border-line p-3" data-testid="adverse-action">
      <div className="flex flex-wrap items-center gap-2"><Pill tone={aa.stage === 'final' ? 'danger' : aa.stage === 'disputed' ? 'warning' : 'info'}>{aa.stage.replace(/_/g, ' ')}</Pill><span className="text-xs text-muted">opened {new Date(aa.createdAt).toLocaleDateString()}</span></div>
      <ol className="mt-2 flex flex-wrap gap-2 text-xs">{['pre_adverse', 'waiting', 'final'].map((s, i) => <li key={s} className={['pre_adverse', 'waiting', 'final'].indexOf(aa.stage) >= i ? 'font-semibold text-navy-900' : 'text-muted'}>{i + 1}. {s.replace(/_/g, ' ')}</li>)}</ol>
      <p className="mt-2">Reasons: {aa.reasonCodes.map((r) => r.replace(/_/g, ' ')).join(', ') || '—'}</p>
      {aa.waitingPeriodEndsAt && aa.stage !== 'final' && <p className="text-xs">Waiting period ends {new Date(aa.waitingPeriodEndsAt).toLocaleDateString()}{remaining !== null && remaining > 0 ? ` (${remaining} day${remaining === 1 ? '' : 's'} left)` : ' (elapsed)'}</p>}
      {aa.noticeId && <p className="text-xs"><a className="text-cobalt-600 underline" href={`/manager/notices?focus=${aa.noticeId}`}>Pre-adverse notice</a> must be approved and sent before the waiting period starts.</p>}
      {aa.disputeOpenedAt && <p className="text-xs text-muted">Dispute opened {new Date(aa.disputeOpenedAt).toLocaleDateString()}</p>}
      {m.isError && <div className="mt-2"><Alert tone="danger" title={m.error instanceof ApiError ? m.error.message : 'Action failed'} /></div>}
      {canDecide && !['final', 'withdrawn'].includes(aa.stage) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {aa.stage !== 'disputed' && <Button variant="secondary" loading={m.isPending} onClick={() => m.mutate({ id: aa.id, action: 'advance' })}>{aa.stage === 'pre_adverse' ? 'Start waiting period' : 'Issue final notice'}</Button>}
          {aa.stage !== 'disputed' && <Button variant="ghost" onClick={() => m.mutate({ id: aa.id, action: 'dispute' })}>Open dispute</Button>}
          <Button variant="ghost" onClick={() => m.mutate({ id: aa.id, action: 'withdraw' })}>Withdraw</Button>
        </div>
      )}
    </li>
  );
}

function DecideModal({ id, onClose }: { id: string; onClose: () => void }) {
  const m = useDecideApplication();
  const [decision, setDecision] = useState('approved');
  const [codes, setCodes] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const needsCodes = decision !== 'approved';
  return (
    <Modal open onClose={onClose} title="Record decision" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={needsCodes && codes.length === 0} onClick={() => m.mutate({ id, decision, reasonCodes: codes, note: note || undefined }, { onSuccess: onClose })}>Confirm decision</Button></>}>
      <div className="space-y-3">
        <Select label="Decision" value={decision} onChange={(e) => setDecision(e.target.value)}><option value="approved">Approved</option><option value="conditionally_approved">Conditionally approved</option><option value="denied">Denied</option></Select>
        {needsCodes && (
          <fieldset><legend className="mb-1 text-sm font-medium text-navy-900">Reason codes (required)</legend>
            <div className="grid grid-cols-2 gap-1 text-sm">{REASON_CODES.map((c) => <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={codes.includes(c)} onChange={(e) => setCodes((cs) => (e.target.checked ? [...cs, c] : cs.filter((x) => x !== c)))} />{c.replace(/_/g, ' ')}</label>)}</div>
          </fieldset>
        )}
        <label className="block text-sm"><span className="mb-1 block font-medium text-navy-900">Note (optional)</span><textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-20 w-full rounded-lg border border-line bg-surface p-3 text-base" /></label>
        {needsCodes && <Alert tone="warning" title="This opens an adverse action">A pre-adverse notice draft is created for approval; the final decision can only be sent after the waiting period.</Alert>}
        {m.isError && <Alert tone="danger" title={m.error instanceof ApiError ? m.error.message : 'Decision failed'} />}
      </div>
    </Modal>
  );
}
