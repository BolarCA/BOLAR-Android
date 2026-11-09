'use client';
import { useState } from 'react';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useCreateLegalHold, useLegalHolds, useReleaseLegalHold, type LegalHoldDto, type LegalHoldScope } from '@/lib/hooks/legal-hold';
import { useCases } from '@/lib/hooks/legal';
import { Alert, Badge, Button, Drawer, Input, Modal, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { fmtDate, shortId, splitIds } from './util';

const SCOPE_LABELS: Record<keyof LegalHoldScope, string> = { caseIds: 'cases', leaseIds: 'leases', propertyIds: 'properties', tenantProfileIds: 'tenant profiles', documentIds: 'documents', userIds: 'users' };

function scopeSummary(scope: LegalHoldScope) {
  return (Object.keys(SCOPE_LABELS) as (keyof LegalHoldScope)[]).filter((k) => (scope[k]?.length ?? 0) > 0).map((k) => `${scope[k]!.length} ${SCOPE_LABELS[k]}`).join(' · ') || 'empty scope';
}

/** Day 49: legal hold register with scoped creation and counsel-approved release. */
export function LegalHolds() {
  const { me } = useAuth();
  const [status, setStatus] = useState('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [release, setRelease] = useState<LegalHoldDto | null>(null);
  const holds = useLegalHolds({ status: status || undefined });
  const canWrite = useCan('legal_hold:write');
  const canRelease = useCan('legal_hold:release');
  return (
    <>
      <PageHeader title="Legal holds" description="Holds block deletion and retention actions for everything in scope, including documents owned by held leases, properties and cases. Release needs different counsel than the creator." actions={canWrite && <Button onClick={() => setCreateOpen(true)}>New legal hold</Button>} />
      <div className="mb-4 max-w-xs"><Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="active">active</option><option value="released">released</option></Select></div>
      <StateView isLoading={holds.isLoading} error={holds.error} data={holds.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void holds.refetch()}
        empty={{ title: 'No legal holds', description: 'Create a hold when litigation, an investigation or an agency request requires preservation.', action: canWrite && <Button onClick={() => setCreateOpen(true)}>New legal hold</Button> }}>
        {(d) => (
          <Table<LegalHoldDto> caption="Legal holds" rows={d.pages.flatMap((p) => p.items)} columns={[
            { key: 'name', header: 'Hold', render: (h) => <div><p className="font-medium">{h.name}</p><p className="max-w-md truncate text-xs text-muted" title={h.reason}>{h.reason}</p></div> },
            { key: 'scope', header: 'Scope', render: (h) => <span className="text-xs">{scopeSummary(h.scopeJson)}</span> },
            { key: 'status', header: 'Status', render: (h) => <Badge tone={statusTone(h.status)}>{h.status}</Badge> },
            { key: 'created', header: 'Created', render: (h) => <span className="text-xs">{fmtDate(h.createdAt)} by {shortId(h.createdBy, 8)}</span> },
            { key: 'actions', header: '', className: 'text-right', render: (h) => (h.status === 'active' && canRelease && h.createdBy !== me?.actor.id ? <Button variant="secondary" aria-label={`Release ${h.name}`} onClick={() => setRelease(h)}>Release</Button> : h.status === 'active' && h.createdBy === me?.actor.id ? <span className="text-xs text-muted">needs other counsel</span> : null) },
          ]} />
        )}
      </StateView>
      <CreateHoldDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
      <ReleaseModal hold={release} onClose={() => setRelease(null)} />
    </>
  );
}

function CreateHoldDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateLegalHold();
  const cases = useCases();
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [caseId, setCaseId] = useState('');
  const [leases, setLeases] = useState('');
  const [properties, setProperties] = useState('');
  const [tenants, setTenants] = useState('');
  const [documents, setDocuments] = useState('');
  const reset = () => { setName(''); setReason(''); setNote(''); setCaseId(''); setLeases(''); setProperties(''); setTenants(''); setDocuments(''); create.reset(); };
  const submit = () => {
    const scopeJson: LegalHoldScope = {};
    if (caseId) scopeJson.caseIds = [caseId];
    if (splitIds(leases).length) scopeJson.leaseIds = splitIds(leases);
    if (splitIds(properties).length) scopeJson.propertyIds = splitIds(properties);
    if (splitIds(tenants).length) scopeJson.tenantProfileIds = splitIds(tenants);
    if (splitIds(documents).length) scopeJson.documentIds = splitIds(documents);
    create.mutate({ name, reason, scopeJson, note });
  };
  return (
    <Drawer open={open} onClose={() => { reset(); onClose(); }} title="New legal hold">
      {create.isSuccess ? (
        <div className="space-y-4"><Alert tone="success" title={`Hold "${create.data.name}" is active`}>Records in scope are now protected from deletion and retention disposal.</Alert><Button onClick={() => { reset(); onClose(); }}>Done</Button></div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Input label="Name" required minLength={3} value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Reason" required minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} hint="Litigation, investigation or agency request that requires preservation." />
          <fieldset className="space-y-3 rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-medium">Scope (at least one)</legend>
            <Select label="Case" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">None</option>
              {cases.data?.pages.flatMap((p) => p.items).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Select>
            <Input label="Lease ids" value={leases} onChange={(e) => setLeases(e.target.value)} hint="Comma or space separated." />
            <Input label="Property ids" value={properties} onChange={(e) => setProperties(e.target.value)} />
            <Input label="Tenant profile ids" value={tenants} onChange={(e) => setTenants(e.target.value)} />
            <Input label="Document ids" value={documents} onChange={(e) => setDocuments(e.target.value)} />
          </fieldset>
          <Input label="Counsel approval note" required minLength={5} value={note} onChange={(e) => setNote(e.target.value)} hint="Recorded in the audit trail with your approval." />
          {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not create hold'}>{create.error instanceof ApiError && create.error.body.fieldErrors?.map((f) => <p key={f.path} className="text-xs">{f.path}: {f.message}</p>)}</Alert>}
          <div className="flex gap-2"><Button type="submit" loading={create.isPending}>Create hold</Button><Button type="button" variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button></div>
        </form>
      )}
    </Drawer>
  );
}

function ReleaseModal({ hold, onClose }: { hold: LegalHoldDto | null; onClose: () => void }) {
  const release = useReleaseLegalHold();
  const [note, setNote] = useState('');
  return (
    <Modal open={!!hold} onClose={onClose} title={`Release ${hold?.name ?? ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={release.isPending} onClick={() => hold && release.mutate({ id: hold.id, note }, { onSuccess: () => { setNote(''); onClose(); } })}>Release hold</Button></>}>
      <p className="text-sm text-muted">Releasing lets retention proposals and deletions proceed for the scope. Your counsel note is required and audited.</p>
      <div className="mt-3"><Input label="Release note" required minLength={5} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {release.isError && <div className="mt-3"><Alert tone="danger" title={release.error instanceof ApiError ? release.error.message : 'Release failed'} /></div>}
    </Modal>
  );
}
