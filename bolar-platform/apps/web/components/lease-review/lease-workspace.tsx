'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CHARGE_CADENCES, CHARGE_TYPES, LEASE_PARTY_ROLES, type LeaseState } from '@bolar/contracts';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import {
  cents, day, useAddLeaseCharge, useAddLeaseParty, useAddLeaseVersion, useCreateEnvelope, useLease, useLeaseDocuments, useLeaseEnvelopes, useLeaseRuleEvaluations, useLeaseTimeline, useTransitionLease, useVoidEnvelope,
  type AuditDto, type LeaseDetailDto, type LeaseTransitionOptionDto,
} from '@/lib/hooks/lease';
import { useTenantProfiles } from '@/lib/hooks/tenant-profile';
import { Alert, Badge, Button, Card, Input, Modal, PageHeader, Select, Table, cn, statusTone } from '@/components/ui';
import { EmptyState, StateView } from '@/components/ui/state-view';
import { parseTerms } from './leases-list';

const RAIL: LeaseState[] = ['draft', 'review', 'approved', 'sent', 'signed', 'active', 'renewal'];
const EXITS: LeaseState[] = ['terminated', 'canceled'];
/** Action label for moving INTO each state. */
const LABEL: Record<LeaseState, string> = { draft: 'Send back to draft', review: 'Submit for review', approved: 'Approve', sent: 'Send for e-signature', signed: 'Record wet signature', active: 'Activate', renewal: 'Start renewal', terminated: 'Terminate', canceled: 'Cancel lease' };
const NEEDS_NOTE: LeaseState[] = ['terminated'];

/** Day 24 / p50 "Lease review workspace": lifecycle rail, parties, terms, charges, compliance checks, documents, approvals, blocked state, counsel note, audit timeline. */
export function LeaseWorkspace({ id }: { id: string }) {
  const q = useLease(id);
  return (
    <StateView isLoading={q.isLoading} error={q.error} data={q.data} skeleton="detail" onRetry={() => void q.refetch()} resource={{ type: 'lease', id }}>
      {(lease) => <Workspace lease={lease} />}
    </StateView>
  );
}

function Workspace({ lease }: { lease: LeaseDetailDto }) {
  const { me } = useAuth();
  const canWrite = useCan('lease:write');
  const canSend = useCan('lease:send');
  const transition = useTransitionLease(lease.id);
  const envelope = useCreateEnvelope(lease.id);
  const [pending, setPending] = useState<LeaseTransitionOptionDto | null>(null);
  const isCreator = me?.actor.id === lease.createdBy;
  const blocked = lease.transitions.filter((t) => !t.allowed && t.reason && !/not allowed/.test(t.reason) && !/note|artifact|activation/.test(t.reason));
  const overlapBlocked = lease.overlaps.length > 0 && ['draft', 'review', 'signed'].includes(lease.status);

  const act = (opt: LeaseTransitionOptionDto) => {
    if (opt.to === 'sent' && lease.status === 'approved') { envelope.mutate(); return; }
    if ((opt.to === 'draft' && lease.status === 'review') || NEEDS_NOTE.includes(opt.to) || opt.to === 'signed' || (opt.to === 'active' && !opt.allowed)) { setPending(opt); return; }
    transition.mutate({ to: opt.to });
  };
  const error = transition.error ?? envelope.error;

  return (
    <>
      <PageHeader title={`${lease.property.name} · Unit ${lease.unit.unitNumber}`} description={`${day(lease.startDate)} – ${day(lease.endDate)} · ${cents(lease.rentCents)}/mo · deposit ${cents(lease.depositCents)}`} actions={<Badge tone={statusTone(lease.status)}>{lease.status}</Badge>} />
      <p className="mb-4"><Link href="/manager/leases" className="text-sm text-cobalt-600 hover:underline">← All leases</Link></p>

      <Card title="Lifecycle" className="mb-6">
        <ol className="flex flex-wrap gap-2" aria-label="Lease lifecycle">
          {RAIL.map((s, i) => {
            const idx = RAIL.indexOf(lease.status as LeaseState);
            const state = s === lease.status ? 'current' : idx >= 0 && i < idx ? 'done' : 'todo';
            return <li key={s} aria-current={state === 'current' ? 'step' : undefined} className={cn('rounded-full px-3 py-1 text-xs font-semibold', state === 'current' && 'bg-cobalt-500 text-white', state === 'done' && 'bg-success-100 text-success-700', state === 'todo' && 'bg-navy-50 text-muted')}>{i + 1}. {s}</li>;
          })}
          {EXITS.includes(lease.status as LeaseState) && <li aria-current="step" className="rounded-full bg-danger-100 px-3 py-1 text-xs font-semibold text-danger-600">{lease.status}</li>}
        </ol>
        {overlapBlocked && (
          <div className="mt-4"><Alert tone="warning" title="Blocked: another lease occupies this unit for these dates">
            <ul className="mt-1 list-disc pl-5">{lease.overlaps.map((o) => <li key={o.id}><Link className="underline" href={`/manager/leases/${o.id}`}>{o.status} lease</Link> {day(o.startDate)} – {day(o.endDate)}</li>)}</ul>
            <p className="mt-1">Adjust the dates in draft, or terminate/cancel the conflicting lease before approving or activating this one.</p>
          </Alert></div>
        )}
        {blocked.filter((b) => !/occupies/.test(b.reason!)).map((b) => <div key={b.to} className="mt-3"><Alert tone="warning" title={`Blocked: ${LABEL[b.to].toLowerCase()}`}>{b.reason}</Alert></div>)}
        {lease.status === 'review' && isCreator && <div className="mt-3"><Alert tone="info" title="Awaiting a second person">You submitted this lease; a landlord or admin with approval rights must approve it.</Alert></div>}
        <div className="mt-4 flex flex-wrap gap-2" data-testid="transition-actions">
          {lease.transitions.map((t) => {
            const direct = t.allowed || (t.to === 'active' && /activation/.test(t.reason ?? '')) || (t.to === 'signed' && /artifact/.test(t.reason ?? '')) || (/note/.test(t.reason ?? '') && (t.to === 'draft' || t.to === 'terminated'));
            if (!direct) return null;
            const danger = t.to === 'canceled' || t.to === 'terminated' || (t.to === 'draft' && lease.status === 'review');
            const hidden = t.to === 'sent' && lease.status === 'approved' && !canSend;
            if (hidden) return null;
            return <Button key={t.to} variant={danger ? 'danger' : t.to === 'approved' ? 'primary' : 'secondary'} onClick={() => act(t)} loading={transition.isPending || envelope.isPending}>{LABEL[t.to]}</Button>;
          })}
          {lease.transitions.length === 0 && <p className="text-sm text-muted">This lease is {lease.status}; no further transitions.</p>}
          {lease.transitions.length > 0 && lease.transitions.every((t) => !t.allowed && /not allowed/.test(t.reason ?? '')) && <p className="text-sm text-muted">Your role cannot move this lease from {lease.status}. {lease.status === 'review' ? 'A landlord or admin approves from the Approvals queue.' : ''}</p>}
        </div>
        {error && <div className="mt-3"><Alert tone={error instanceof ApiError && error.status === 409 ? 'warning' : 'danger'} title={error instanceof ApiError ? error.message : 'Action failed'}>{error instanceof ApiError && error.body.fieldErrors?.map((f) => <p key={f.path}>{f.message}</p>)}</Alert></div>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PartiesPanel lease={lease} canWrite={canWrite} />
          <TermsPanel lease={lease} canWrite={canWrite} />
          <ChargesPanel lease={lease} canWrite={canWrite} />
          <CompliancePanel leaseId={lease.id} />
        </div>
        <div className="space-y-6">
          <EnvelopesPanel lease={lease} canSend={canSend} />
          <DocumentsPanel lease={lease} />
          <TimelinePanel leaseId={lease.id} />
        </div>
      </div>

      <TransitionModal lease={lease} option={pending} onClose={() => setPending(null)} onSubmit={(body) => transition.mutate(body, { onSuccess: () => setPending(null) })} pending={transition.isPending} error={transition.error} />
    </>
  );
}

function TransitionModal({ lease, option, onClose, onSubmit, pending, error }: { lease: LeaseDetailDto; option: LeaseTransitionOptionDto | null; onClose: () => void; onSubmit: (body: { to: LeaseState; note?: string; signedAt?: string; activate?: boolean }) => void; pending: boolean; error: unknown }) {
  const [note, setNote] = useState('');
  const [signedAt, setSignedAt] = useState(new Date().toISOString().slice(0, 10));
  const [activate, setActivate] = useState(false);
  if (!option) return null;
  const isReject = option.to === 'draft' && lease.status === 'review';
  const needsNote = isReject || NEEDS_NOTE.includes(option.to) || (option.to === 'draft' && lease.status === 'sent');
  const title = isReject ? 'Send back with a counsel review note' : option.to === 'terminated' ? 'Terminate lease' : option.to === 'signed' ? 'Record wet signature' : option.to === 'active' ? 'Activate lease early' : LABEL[option.to];
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={isReject || option.to === 'terminated' ? 'danger' : 'primary'} loading={pending} disabled={(needsNote && note.trim().length < 3) || (option.to === 'active' && !activate)} onClick={() => onSubmit({ to: option.to, ...(needsNote ? { note } : {}), ...(option.to === 'signed' ? { signedAt } : {}), ...(option.to === 'active' ? { activate: true } : {}) })}>{LABEL[option.to]}</Button></>}>
      <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
        {needsNote && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">{isReject ? 'Counsel review note (visible in the audit timeline)' : 'Note'}</span>
            <textarea required minLength={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-28 w-full rounded-lg border border-line bg-surface p-3 text-base" placeholder={isReject ? 'What must change before this lease can be approved?' : 'Reason'} />
          </label>
        )}
        {option.to === 'signed' && <Input label="Signed on" type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} hint="Use this only for ink signatures; e-signatures arrive through the provider webhook." />}
        {option.to === 'active' && (
          <>
            <Alert tone="warning" title="Start date is more than 30 days away">{option.reason}</Alert>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> I confirm explicit early activation; the unit becomes occupied now.</label>
          </>
        )}
        {error ? <Alert tone="danger" title={error instanceof ApiError ? error.message : 'Action failed'} /> : null}
      </form>
    </Modal>
  );
}

function PartiesPanel({ lease, canWrite }: { lease: LeaseDetailDto; canWrite: boolean }) {
  const editable = canWrite && ['draft', 'review', 'renewal'].includes(lease.status);
  const add = useAddLeaseParty(lease.id);
  const [q, setQ] = useState('');
  const [tenantProfileId, setTenantProfileId] = useState('');
  const [role, setRole] = useState<string>('co_tenant');
  const tenants = useTenantProfiles({ q: q || undefined }, editable);
  return (
    <Card title="Parties">
      {lease.parties.length === 0 ? <EmptyState title="No parties yet" description="Add a primary tenant before submitting for review." /> : (
        <Table caption="Lease parties" rows={lease.parties} columns={[
          { key: 'name', header: 'Party', render: (p) => <Link className="font-medium text-cobalt-600 hover:underline" href={`/manager/tenants/${p.tenantProfileId}`}>{p.displayName}</Link> },
          { key: 'role', header: 'Role', render: (p) => <Badge tone="info">{p.role.replace(/_/g, ' ')}</Badge> },
          { key: 'signed', header: 'Signed', render: (p) => (p.signedAt ? <Badge tone="success">{day(p.signedAt)}</Badge> : <Badge>unsigned</Badge>) },
          { key: 'portal', header: 'Portal', render: (p) => (p.userId ? <Badge tone="success">linked</Badge> : <Badge>no login</Badge>) },
        ]} />
      )}
      {editable && (
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]" onSubmit={(e) => { e.preventDefault(); if (tenantProfileId) add.mutate({ tenantProfileId, role }, { onSuccess: () => setTenantProfileId('') }); }}>
          <Input label="Find tenant" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" />
          <Select label="Tenant profile" value={tenantProfileId} onChange={(e) => setTenantProfileId(e.target.value)}>
            <option value="">Select…</option>
            {(tenants.data?.pages.flatMap((p) => p.items) ?? []).map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}
          </Select>
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value)}>{LEASE_PARTY_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</Select>
          <div className="flex items-end"><Button type="submit" variant="secondary" disabled={!tenantProfileId} loading={add.isPending}>Add party</Button></div>
          {add.isError && <div className="sm:col-span-4"><Alert tone="danger" title={add.error instanceof ApiError ? add.error.message : 'Could not add party'} /></div>}
        </form>
      )}
    </Card>
  );
}

function TermsPanel({ lease, canWrite }: { lease: LeaseDetailDto; canWrite: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const version = lease.versions.find((v) => v.id === selected) ?? lease.currentVersion;
  const editable = canWrite && ['draft', 'renewal'].includes(lease.status);
  const add = useAddLeaseVersion(lease.id);
  const [text, setText] = useState('');
  return (
    <Card title="Terms" actions={lease.versions.length > 0 && (
      <div className="flex flex-wrap gap-1" role="group" aria-label="Lease versions">
        {lease.versions.map((v) => <button key={v.id} type="button" onClick={() => setSelected(v.id)} className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', (version?.id === v.id) ? 'bg-cobalt-500 text-white' : 'bg-navy-50 text-navy-700')} aria-pressed={version?.id === v.id}>v{v.version}{v.id === lease.currentVersionId ? ' · current' : ''}</button>)}
      </div>
    )}>
      {!version ? <EmptyState title="No terms yet" description={lease.status === 'draft' ? 'Add a version with the lease terms; it is required before sending for signature.' : 'This lease has no terms version.'} /> : (
        <>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {Object.entries(version.termsJson).map(([k, v]) => <div key={k} className="border-b border-line pb-2"><dt className="text-muted">{k}</dt><dd className="font-medium">{String(v)}</dd></div>)}
          </dl>
          <p className="mt-2 text-xs text-muted">Version {version.version} · {new Date(version.createdAt).toLocaleString()}{version.documentId ? ' · linked document' : ''}</p>
        </>
      )}
      {editable && (
        <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); add.mutate({ termsJson: parseTerms(text) }, { onSuccess: () => setText('') }); }}>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">New version terms (one “key: value” per line)</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-24 w-full rounded-lg border border-line bg-surface p-3 font-mono text-sm" placeholder={'rent: $1,550\nterm: 12 months'} />
          </label>
          {add.isError && <Alert tone="danger" title={add.error instanceof ApiError ? add.error.message : 'Could not add version'} />}
          <Button type="submit" variant="secondary" disabled={Object.keys(parseTerms(text)).length === 0} loading={add.isPending}>Add version {lease.versions.length + 1}</Button>
        </form>
      )}
    </Card>
  );
}

function ChargesPanel({ lease, canWrite }: { lease: LeaseDetailDto; canWrite: boolean }) {
  const editable = canWrite && ['draft', 'review', 'approved', 'active', 'renewal'].includes(lease.status);
  const add = useAddLeaseCharge(lease.id);
  const [type, setType] = useState<string>('parking');
  const [amount, setAmount] = useState('');
  const [cadence, setCadence] = useState<string>('monthly');
  const monthly = lease.charges.filter((c) => c.cadence === 'monthly').reduce((s, c) => s + c.amountCents, 0);
  return (
    <Card title="Recurring charges" actions={<span className="text-sm text-muted">Monthly total {cents(monthly)}</span>}>
      {lease.charges.length === 0 ? <EmptyState title="No charges" /> : (
        <Table caption="Recurring charges" rows={lease.charges} columns={[
          { key: 'type', header: 'Type', render: (c) => c.type },
          { key: 'amount', header: 'Amount', render: (c) => cents(c.amountCents) },
          { key: 'cadence', header: 'Cadence', render: (c) => c.cadence.replace(/_/g, ' ') },
          { key: 'acct', header: 'Account', render: (c) => c.accountCode ?? '—' },
        ]} />
      )}
      {editable && (
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); add.mutate({ type, amountCents: Math.round(Number(amount) * 100), cadence }, { onSuccess: () => setAmount('') }); }}>
          <Select label="Charge type" value={type} onChange={(e) => setType(e.target.value)}>{CHARGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
          <Input label="Amount (USD)" type="number" min={0} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Select label="Cadence" value={cadence} onChange={(e) => setCadence(e.target.value)}>{CHARGE_CADENCES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</Select>
          <div className="flex items-end"><Button type="submit" variant="secondary" loading={add.isPending}>Add charge</Button></div>
          {add.isError && <div className="sm:col-span-4"><Alert tone="danger" title={add.error instanceof ApiError ? add.error.message : 'Could not add charge'} /></div>}
        </form>
      )}
    </Card>
  );
}

function CompliancePanel({ leaseId }: { leaseId: string }) {
  const q = useLeaseRuleEvaluations(leaseId);
  return (
    <Card title="Compliance checks">
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.items.length === 0} onRetry={() => void q.refetch()} empty={{ title: 'No rule evaluations yet', description: 'Compliance rules run when the compliance module evaluates this lease. Nothing has been recorded for it so far.' }}>
        {(d) => (
          <Table caption="Rule evaluations" rows={d.items} columns={[
            { key: 'rule', header: 'Rule', render: (r) => <code className="text-xs">{r.ruleKey} v{r.ruleVersion}</code> },
            { key: 'result', header: 'Result', render: (r) => <Badge tone={statusTone(r.result)}>{r.result}</Badge> },
            { key: 'when', header: 'Evaluated', render: (r) => <span className="text-xs">{new Date(r.createdAt).toLocaleString()}</span> },
          ]} />
        )}
      </StateView>
    </Card>
  );
}

function EnvelopesPanel({ lease, canSend }: { lease: LeaseDetailDto; canSend: boolean }) {
  const q = useLeaseEnvelopes(lease.id);
  const voidEnv = useVoidEnvelope(lease.id);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  return (
    <Card title="E-signature">
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.items.length === 0} onRetry={() => void q.refetch()} empty={{ title: 'No envelopes', description: lease.status === 'approved' ? 'Send this approved lease for e-signature from the lifecycle actions.' : 'Envelopes appear once the lease is sent for signature.' }}>
        {(d) => (
          <ul className="space-y-3 text-sm">
            {d.items.map((e) => (
              <li key={e.id} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2"><Badge tone={statusTone(e.status)}>{e.status}</Badge><span className="text-xs text-muted">{e.provider} · {new Date(e.createdAt).toLocaleDateString()}</span></div>
                <p className="mt-1 text-xs text-muted">{e.recipients.length} recipient{e.recipients.length === 1 ? '' : 's'}: {e.recipients.map((r) => r.name).join(', ')}</p>
                {canSend && ['created', 'sent', 'delivered'].includes(e.status) && (
                  voiding === e.id ? (
                    <form className="mt-2 space-y-2" onSubmit={(ev) => { ev.preventDefault(); voidEnv.mutate({ envelopeId: e.id, reason }, { onSuccess: () => { setVoiding(null); setReason(''); } }); }}>
                      <Input label="Void reason" required minLength={3} value={reason} onChange={(ev) => setReason(ev.target.value)} />
                      <div className="flex gap-2"><Button type="submit" variant="danger" loading={voidEnv.isPending}>Void envelope</Button><Button type="button" variant="secondary" onClick={() => setVoiding(null)}>Keep</Button></div>
                      {voidEnv.isError && <Alert tone="danger" title={voidEnv.error instanceof ApiError ? voidEnv.error.message : 'Could not void'} />}
                    </form>
                  ) : <Button variant="ghost" className="mt-2" onClick={() => setVoiding(e.id)}>Void…</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </StateView>
    </Card>
  );
}

function DocumentsPanel({ lease }: { lease: LeaseDetailDto }) {
  const q = useLeaseDocuments(lease.id);
  return (
    <Card title="Documents">
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.items.length === 0} onRetry={() => void q.refetch()} empty={{ title: 'No documents attached', description: 'Signed copies and disclosures upload through the documents module and are listed here by lease.' }}>
        {(d) => (
          <ul className="space-y-2 text-sm">
            {d.items.map((doc) => <li key={doc.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-3"><span className="font-medium">{doc.title}</span><Badge tone={doc.classification === 'restricted' ? 'danger' : doc.classification === 'confidential' ? 'violet' : 'neutral'}>{doc.classification}</Badge></li>)}
          </ul>
        )}
      </StateView>
      {lease.versions.some((v) => v.documentId) && <p className="mt-3 text-xs text-muted">{lease.versions.filter((v) => v.documentId).length} lease version(s) link a document.</p>}
    </Card>
  );
}

function describe(r: AuditDto): string {
  const meta = (r.metadata ?? {}) as { from?: string; to?: string; note?: string | null; event?: string };
  if (r.action === 'lease.transition') return `${meta.from} → ${meta.to}${meta.note ? ` — “${meta.note}”` : ''}`;
  if (r.action === 'signature.webhook') return `e-sign event ${meta.event ?? ''}`;
  return r.action.replace('lease.', '').replace('signature.', '').replace(/[._]/g, ' ');
}

function TimelinePanel({ leaseId }: { leaseId: string }) {
  const q = useLeaseTimeline(leaseId);
  return (
    <Card title="Audit timeline">
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void q.refetch()} empty={{ title: 'No events yet' }}>
        {(d) => (
          <ol className="space-y-3 text-sm" aria-label="Audit timeline">
            {d.pages.flatMap((p) => p.items).map((r) => (
              <li key={r.id} className="border-l-2 border-cobalt-100 pl-3">
                <p className="font-medium">{describe(r)}</p>
                <p className="text-xs text-muted">{new Date(r.createdAt).toLocaleString()} · {r.actorId ? 'staff' : 'system'} · <code>{r.action}</code></p>
              </li>
            ))}
            {q.hasNextPage && <li><Button variant="ghost" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button></li>}
          </ol>
        )}
      </StateView>
    </Card>
  );
}
