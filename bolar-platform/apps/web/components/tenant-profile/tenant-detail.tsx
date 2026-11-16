'use client';
import { useState } from 'react';
import Link from 'next/link';
import { OCCUPANT_RELATIONSHIPS, TENANT_PROFILE_STATUSES } from '@bolar/contracts';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useAddEmergencyContact, useAddOccupant, useRemoveOccupant, useTenantProfile, useTenantProfileSensitive, useUpdateTenantProfile, type TenantProfileDetailDto } from '@/lib/hooks/tenant-profile';
import { useLeases, cents, day, type LeaseDto } from '@/lib/hooks/lease';
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { EmptyState, StateView } from '@/components/ui/state-view';
import { Redactable } from './tenants-list';

/** Day 21 tenant detail: internal fields, redacted confidential fields, restricted section behind the sensitive gate. */
export function TenantDetail({ id }: { id: string }) {
  const q = useTenantProfile(id);
  return (
    <StateView isLoading={q.isLoading} error={q.error} data={q.data} skeleton="detail" onRetry={() => void q.refetch()} resource={{ type: 'tenant_profile', id, classification: 'confidential' }}>
      {(p) => <TenantDetailBody profile={p} />}
    </StateView>
  );
}

function TenantDetailBody({ profile: p }: { profile: TenantProfileDetailDto }) {
  const canWrite = useCan('tenant_profile:write');
  const canLeases = useCan('lease:read');
  const update = useUpdateTenantProfile(p.id);
  const redactedEmergency = p.redactedFields.includes('emergencyContacts');
  return (
    <>
      <PageHeader title={p.displayName} description={`${p.kind.replace(/_/g, ' ')} · created ${day(p.createdAt)}`} actions={
        <div className="flex items-center gap-2">
          <Badge tone={statusTone(p.status)}>{p.status}</Badge>
          <Badge tone={p.classification === 'restricted' ? 'danger' : 'violet'}>{p.classification}</Badge>
          <Badge tone="info">cleared: {p.clearedClassification}</Badge>
        </div>
      } />
      <p className="mb-4"><Link href="/manager/tenants" className="text-sm text-cobalt-600 hover:underline">← All tenants</Link></p>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Profile">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Status</dt><dd className="mt-1">{canWrite ? (
                <Select label="Change status" value={p.status} onChange={(e) => update.mutate({ status: e.target.value as never })}>
                  {TENANT_PROFILE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              ) : <Badge tone={statusTone(p.status)}>{p.status}</Badge>}</dd></div>
              <div><dt className="text-muted">Active leases</dt><dd className="mt-1 font-medium">{p.activeLeaseCount}</dd></div>
              <div><dt className="text-muted">Email <Badge tone="violet">confidential</Badge></dt><dd className="mt-1"><Redactable value={p.email} field="email" redacted={p.redactedFields} /></dd></div>
              <div><dt className="text-muted">Phone <Badge tone="violet">confidential</Badge></dt><dd className="mt-1"><Redactable value={p.phone} field="phone" redacted={p.redactedFields} /></dd></div>
              <div><dt className="text-muted">Portal login</dt><dd className="mt-1">{p.userId ? <Badge tone="success">linked</Badge> : <Badge>not invited</Badge>}</dd></div>
              <div><dt className="text-muted">Occupants</dt><dd className="mt-1">{p.occupants.length}</dd></div>
              {p.notes && <div className="sm:col-span-2"><dt className="text-muted">Notes</dt><dd className="mt-1 whitespace-pre-wrap">{p.notes}</dd></div>}
            </dl>
            {update.isError && <div className="mt-3"><Alert tone="danger" title={update.error instanceof ApiError ? update.error.message : 'Update failed'} /></div>}
          </Card>

          <SensitiveSection profile={p} />

          <Card title="Occupants">
            {p.occupants.length === 0 ? <EmptyState title="No occupants listed" description="Add household members or employees who live in the unit but are not leaseholders." /> : (
              <Table caption="Occupants" rows={p.occupants} columns={[
                { key: 'name', header: 'Name', render: (o) => o.name },
                { key: 'rel', header: 'Relationship', render: (o) => o.relationship },
                { key: 'minor', header: 'Minor', render: (o) => (o.isMinor ? <Badge tone="info">minor</Badge> : '—') },
                { key: 'actions', header: '', className: 'text-right', render: (o) => (canWrite ? <RemoveOccupant profileId={p.id} occupantId={o.id} name={o.name} /> : null) },
              ]} />
            )}
            {canWrite && <AddOccupantForm profileId={p.id} />}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Emergency contacts">
            {p.emergencyContacts.length === 0 ? <p className="text-sm text-muted">None recorded.</p> : (
              <ul className="space-y-3 text-sm">
                {p.emergencyContacts.map((e) => (
                  <li key={e.id} className="rounded-lg border border-line p-3">
                    <p className="font-medium"><Redactable value={e.name} field="name" redacted={e.redactedFields} /></p>
                    <p className="text-muted">{e.relationship}</p>
                    <p><Redactable value={e.phone} field="phone" redacted={e.redactedFields} /></p>
                  </li>
                ))}
              </ul>
            )}
            {redactedEmergency && <p className="mt-3 text-xs text-muted">Names and phones are confidential. Request access in the sensitive section to reveal them.</p>}
            {canWrite && <AddEmergencyForm profileId={p.id} />}
          </Card>
          <Card title="Leases">
            {canLeases ? <TenantLeases tenantProfileId={p.id} /> : <p className="text-sm text-muted">Your role cannot view leases.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}

/** Restricted fields: fetched separately so a 403 review_required renders the request-access panel instead of hiding the page. */
function SensitiveSection({ profile: p }: { profile: TenantProfileDetailDto }) {
  const [revealed, setRevealed] = useState(p.clearedClassification === 'restricted');
  const q = useTenantProfileSensitive(p.id, revealed);
  return (
    <Card title="Restricted identity fields" actions={<Badge tone="danger">restricted</Badge>}>
      {!revealed ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">Date of birth and SSN last four are hidden. Reveal only with an approved purpose; every reveal is audited.</p>
          <Button variant="secondary" onClick={() => setRevealed(true)}>Reveal sensitive fields</Button>
        </div>
      ) : (
        <StateView isLoading={q.isLoading} error={q.error} data={q.data} skeleton="detail" resource={{ type: 'tenant_profile', id: p.id, classification: 'restricted' }} onRetry={() => void q.refetch()}>
          {(s) => (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2" data-state="sensitive-revealed">
              <div><dt className="text-muted">Date of birth</dt><dd className="mt-1 font-medium">{s.dateOfBirth ? day(s.dateOfBirth) : '—'}</dd></div>
              <div><dt className="text-muted">SSN last 4</dt><dd className="mt-1 font-medium">{s.ssnLast4 ? `•••-••-${s.ssnLast4}` : '—'}</dd></div>
              <div><dt className="text-muted">Email</dt><dd className="mt-1">{s.email ?? '—'}</dd></div>
              <div><dt className="text-muted">Phone</dt><dd className="mt-1">{s.phone ?? '—'}</dd></div>
            </dl>
          )}
        </StateView>
      )}
    </Card>
  );
}

function TenantLeases({ tenantProfileId }: { tenantProfileId: string }) {
  const q = useLeases({ tenantProfileId });
  return (
    <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No leases', description: 'This tenant is not a party to any lease yet.' }} onRetry={() => void q.refetch()}>
      {(d) => (
        <ul className="space-y-2 text-sm">
          {d.pages.flatMap((p) => p.items).map((l: LeaseDto) => (
            <li key={l.id} className="rounded-lg border border-line p-3">
              <Link href={`/manager/leases/${l.id}`} className="font-medium text-cobalt-600 hover:underline">{l.property.name} · Unit {l.unit.unitNumber}</Link>
              <p className="text-muted">{day(l.startDate)} – {day(l.endDate)} · {cents(l.rentCents)}/mo</p>
              <Badge tone={statusTone(l.status)}>{l.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </StateView>
  );
}

function AddOccupantForm({ profileId }: { profileId: string }) {
  const add = useAddOccupant(profileId);
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState<string>('roommate');
  const [isMinor, setIsMinor] = useState(false);
  return (
    <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(e) => { e.preventDefault(); add.mutate({ name, relationship, isMinor }, { onSuccess: () => { setName(''); setIsMinor(false); } }); }}>
      <Input label="Occupant name" required value={name} onChange={(e) => setName(e.target.value)} />
      <Select label="Relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)}>{OCCUPANT_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
      <div className="flex items-end gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={isMinor} onChange={(e) => setIsMinor(e.target.checked)} /> Minor</label>
        <Button type="submit" variant="secondary" loading={add.isPending}>Add occupant</Button>
      </div>
      {add.isError && <div className="sm:col-span-3"><Alert tone="danger" title={add.error instanceof ApiError ? add.error.message : 'Could not add occupant'} /></div>}
    </form>
  );
}

function RemoveOccupant({ profileId, occupantId, name }: { profileId: string; occupantId: string; name: string }) {
  const remove = useRemoveOccupant(profileId);
  return <Button variant="ghost" aria-label={`Remove occupant ${name}`} onClick={() => remove.mutate(occupantId)} loading={remove.isPending}>Remove</Button>;
}

function AddEmergencyForm({ profileId }: { profileId: string }) {
  const add = useAddEmergencyContact(profileId);
  const [form, setForm] = useState({ name: '', relationship: '', phone: '' });
  return (
    <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); add.mutate(form, { onSuccess: () => setForm({ name: '', relationship: '', phone: '' }) }); }}>
      <Input label="Contact name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Relationship to tenant" required value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} />
        <Input label="Contact phone" type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      {add.isError && <Alert tone="danger" title={add.error instanceof ApiError ? add.error.message : 'Could not add contact'} />}
      <Button type="submit" variant="secondary" loading={add.isPending}>Add emergency contact</Button>
    </form>
  );
}
