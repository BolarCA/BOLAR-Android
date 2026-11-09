'use client';
import { useState } from 'react';
import { VENDOR_CONTRACT_KINDS } from '@bolar/contracts';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useAddVendorContract, useInviteVendor, useSetVendorStatus, useVendor, useVendorContracts, useVendorWorkOrders, type VendorContractDto, type VendorProfileDto } from '@/lib/hooks/vendor';
import type { WorkOrderDto } from '@/lib/hooks/maintenance';
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { insuranceTone } from './vendors-admin';
import { Chip, Field, LinkButton, PriorityBadge, SlaChip, StatusBadge, fmtDate, fmtMoney } from './labels';

/** Vendor detail (Day 33): approve/suspend, contracts list + add, portal invitation, assigned work orders. */
export function VendorDetail({ id }: { id: string }) {
  const q = useVendor(id);
  return (
    <StateView isLoading={q.isLoading} error={q.error} data={q.data} onRetry={() => void q.refetch()} skeleton="detail">
      {(v) => <Body v={v} />}
    </StateView>
  );
}

function Body({ v }: { v: VendorProfileDto }) {
  const canWrite = useCan('vendor:write');
  const setStatus = useSetVendorStatus();
  return (
    <>
      <PageHeader title={v.name} description={`${v.trades.join(', ')} · ${v.coverageJson.propertyIds.length ? `${v.coverageJson.propertyIds.length} covered propert${v.coverageJson.propertyIds.length === 1 ? 'y' : 'ies'}` : 'covers all properties'}`}
        actions={<>
          <LinkButton href="/manager/vendors" variant="ghost">All vendors</LinkButton>
          {canWrite && v.status !== 'approved' && v.status !== 'archived' && <Button onClick={() => setStatus.mutate({ id: v.id, action: 'approve' })} loading={setStatus.isPending}>Approve</Button>}
          {canWrite && v.status === 'approved' && <Button variant="danger" onClick={() => setStatus.mutate({ id: v.id, action: 'suspend' })} loading={setStatus.isPending}>Suspend</Button>}
        </>} />
      {setStatus.isError && <div className="mb-4"><Alert tone="danger" title={setStatus.error instanceof ApiError ? setStatus.error.message : 'Status change failed'} /></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Profile">
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Status"><Chip tone={statusTone(v.status)}>{v.status}</Chip></Field>
            <Field label="Insurance"><Chip tone={insuranceTone(v.insuranceStatus)}>{v.insuranceStatus}</Chip> <span className="text-xs text-muted">{v.insuranceExpiresAt ? new Date(v.insuranceExpiresAt).toLocaleDateString() : ''}</span></Field>
            <Field label="Email">{v.email ?? '—'}</Field>
            <Field label="Phone">{v.phone ?? '—'}</Field>
            <Field label="License">{v.licenseNumber ?? '—'}</Field>
            <Field label="Budget limit">{fmtMoney(v.budgetLimitCents)}</Field>
            <Field label="Portal login">{v.userId ? <Badge tone="success">linked</Badge> : <Badge>not linked</Badge>}</Field>
            <Field label="Open jobs">{v.openWorkOrders}</Field>
          </dl>
          {v.insuranceStatus !== 'valid' && v.status === 'approved' && <div className="mt-3"><Alert tone="warning" title={v.insuranceStatus === 'expired' ? 'Insurance expired: assignment is blocked' : v.insuranceStatus === 'missing' ? 'No insurance on file: assignment is blocked' : 'Insurance expires within 30 days'}>Add an insurance certificate contract with an end date to update the expiry.</Alert></div>}
        </Card>
        <Contracts vendorId={v.id} canWrite={canWrite} />
        <Invite v={v} canWrite={canWrite} />
      </div>
      <div className="mt-6"><AssignedJobs vendorId={v.id} /></div>
    </>
  );
}

function Contracts({ vendorId, canWrite }: { vendorId: string; canWrite: boolean }) {
  const q = useVendorContracts(vendorId);
  const add = useAddVendorContract();
  const [kind, setKind] = useState<string>('msa');
  const [storageKey, setStorageKey] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  return (
    <Card title="Contracts and certificates">
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.items.length === 0} empty={{ title: 'No documents on file', description: 'Add the MSA, warranty terms, insurance certificate and W-9.' }} onRetry={() => void q.refetch()}>
        {(d) => (
          <Table<VendorContractDto> caption="Vendor contracts" rows={d.items} columns={[
            { key: 'kind', header: 'Kind', render: (c) => <Badge tone="info">{c.kind.replace(/_/g, ' ')}</Badge> },
            { key: 'ref', header: 'Reference', render: (c) => <span className="break-all text-xs">{c.documentId ?? c.storageKey}</span> },
            { key: 'valid', header: 'Valid', render: (c) => `${c.startsAt ? new Date(c.startsAt).toLocaleDateString() : '—'} – ${c.endsAt ? new Date(c.endsAt).toLocaleDateString() : 'open'}` },
          ]} />
        )}
      </StateView>
      {canWrite && (
        <form className="mt-4 space-y-3 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); add.mutate({ id: vendorId, kind, storageKey: storageKey || undefined, documentId: documentId || undefined, startsAt: startsAt ? new Date(startsAt).toISOString() : undefined, endsAt: endsAt ? new Date(endsAt).toISOString() : undefined }, { onSuccess: () => { setStorageKey(''); setDocumentId(''); setStartsAt(''); setEndsAt(''); } }); }}>
          <Select label="Document kind" value={kind} onChange={(e) => setKind(e.target.value)}>{VENDOR_CONTRACT_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}</Select>
          <Input label="Storage key" value={storageKey} onChange={(e) => setStorageKey(e.target.value)} hint="Path of the uploaded file, or give a documents module id below." />
          <Input label="Document id" value={documentId} onChange={(e) => setDocumentId(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="Starts" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            <Input label="Ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} hint={kind === 'insurance_certificate' ? 'Sets the insurance expiry.' : undefined} />
          </div>
          {add.isError && <Alert tone="danger" title={add.error instanceof ApiError ? add.error.message : 'Could not add contract'}>{add.error instanceof ApiError && add.error.body.fieldErrors?.map((f) => <p key={f.path}>{f.message}</p>)}</Alert>}
          <Button type="submit" variant="secondary" loading={add.isPending} disabled={!storageKey && !documentId}>Add document</Button>
        </form>
      )}
    </Card>
  );
}

function Invite({ v, canWrite }: { v: VendorProfileDto; canWrite: boolean }) {
  const invite = useInviteVendor();
  const [email, setEmail] = useState(v.email ?? '');
  return (
    <Card title="Vendor portal access">
      {v.userId ? (
        <p className="text-sm text-ink">This vendor has a portal login and sees only the jobs assigned to them.</p>
      ) : invite.isSuccess ? (
        <Alert tone="success" title={`Invitation sent to ${invite.data.email}`}>
          <p className="text-xs">Expires {fmtDate(invite.data.expiresAt)}. Once accepted, link the new login here so the vendor sees their jobs.</p>
          {invite.data.acceptUrl && <p className="mt-2 break-all text-xs">Local accept link: <a className="underline" href={invite.data.acceptUrl}>{invite.data.acceptUrl}</a></p>}
        </Alert>
      ) : canWrite ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); invite.mutate({ id: v.id, email }); }}>
          <p className="text-sm text-muted">Invite the vendor to the vendor portal. They get the vendor role and can update only their assigned jobs.</p>
          <Input label="Vendor email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {invite.isError && <Alert tone="danger" title={invite.error instanceof ApiError ? invite.error.message : 'Could not send invitation'} />}
          <Button type="submit" loading={invite.isPending}>Send invitation</Button>
        </form>
      ) : (
        <p className="text-sm text-muted">No portal login yet.</p>
      )}
    </Card>
  );
}

function AssignedJobs({ vendorId }: { vendorId: string }) {
  const q = useVendorWorkOrders(vendorId);
  return (
    <Card title="Assigned work orders">
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.items.length === 0} empty={{ title: 'No work orders assigned', description: 'Assign jobs from the maintenance board; only eligible vendors appear there.' }} onRetry={() => void q.refetch()}>
        {(d) => (
          <Table<WorkOrderDto> caption="Vendor work orders" rows={d.items} columns={[
            { key: 'job', header: 'Job', render: (w) => <div><p className="font-medium">{w.title}</p><p className="text-xs text-muted">{w.number} · {w.property?.name}{w.unit ? ` · ${w.unit.unitNumber}` : ''}</p></div> },
            { key: 'status', header: 'Status', render: (w) => <StatusBadge status={w.status} /> },
            { key: 'priority', header: 'Priority', render: (w) => <PriorityBadge priority={w.priority} /> },
            { key: 'sla', header: 'SLA', render: (w) => <SlaChip slaDueAt={w.slaDueAt} overdue={w.overdue} status={w.status} completedAt={w.completedAt} /> },
            { key: 'cost', header: 'Estimate / actual', render: (w) => `${fmtMoney(w.estimateCents)} / ${fmtMoney(w.actualCents)}` },
          ]} />
        )}
      </StateView>
    </Card>
  );
}
