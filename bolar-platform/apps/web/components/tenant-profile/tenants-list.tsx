'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TENANT_PROFILE_KINDS, TENANT_PROFILE_STATUSES } from '@bolar/contracts';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useCreateTenantProfile, useTenantProfiles, type TenantProfileDto } from '@/lib/hooks/tenant-profile';
import { Alert, Badge, Button, Card, Drawer, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/** Shows a value or a "redacted" badge when the field was withheld by the classification gate. */
export function Redactable({ value, field, redacted }: { value: string | null; field: string; redacted: string[] }) {
  if (redacted.includes(field)) return <Badge tone="violet">redacted</Badge>;
  return <span>{value ?? '—'}</span>;
}

/** Day 21 staff tenant list with restricted fields and a create drawer. */
export function TenantsList() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const canWrite = useCan('tenant_profile:write');
  const list = useTenantProfiles({ q: q || undefined, status: status || undefined });

  return (
    <>
      <PageHeader title="Tenants" description="Tenant profiles with field-level classification. Contact details are confidential; date of birth and SSN last four are restricted and need an approved purpose." actions={canWrite && <Button onClick={() => setOpen(true)}>New tenant profile</Button>} />
      <div className="mb-4 grid max-w-xl gap-3 sm:grid-cols-2">
        <Input label="Search" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {TENANT_PROFILE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <StateView isLoading={list.isLoading} error={list.error} data={list.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void list.refetch()}
        empty={{ title: 'No tenant profiles yet', description: 'Create a profile for a prospect or applicant to start a lease.', action: canWrite && <Button onClick={() => setOpen(true)}>New tenant profile</Button> }}>
        {(d) => (
          <>
            <Table<TenantProfileDto> caption="Tenant profiles" rows={d.pages.flatMap((p) => p.items)} onRowClick={(r) => router.push(`/manager/tenants/${r.id}`)} columns={[
              { key: 'name', header: 'Tenant', render: (t) => <a className="font-medium text-cobalt-600 underline-offset-2 hover:underline" href={`/manager/tenants/${t.id}`} onClick={(e) => e.stopPropagation()}>{t.displayName}</a> },
              { key: 'status', header: 'Status', render: (t) => <Badge tone={statusTone(t.status)}>{t.status}</Badge> },
              { key: 'kind', header: 'Kind', render: (t) => t.kind.replace(/_/g, ' ') },
              { key: 'email', header: 'Email', render: (t) => <Redactable value={t.email} field="email" redacted={t.redactedFields} /> },
              { key: 'phone', header: 'Phone', render: (t) => <Redactable value={t.phone} field="phone" redacted={t.redactedFields} /> },
              { key: 'class', header: 'Classification', render: (t) => <Badge tone={t.classification === 'restricted' ? 'danger' : 'violet'}>{t.classification}</Badge> },
            ]} />
            {list.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      <CreateTenantDrawer open={open} onClose={() => setOpen(false)} onCreated={(id) => router.push(`/manager/tenants/${id}`)} />
    </>
  );
}

export function CreateTenantDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const create = useCreateTenantProfile();
  const [form, setForm] = useState({ displayName: '', email: '', phone: '', dateOfBirth: '', ssnLast4: '', kind: 'individual', status: 'applicant', notes: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fieldError = (path: string) => (create.error instanceof ApiError ? create.error.body.fieldErrors?.find((f) => f.path.endsWith(path))?.message : undefined);
  return (
    <Drawer open={open} onClose={onClose} title="New tenant profile">
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ displayName: form.displayName, kind: form.kind as never, status: form.status as never, ...(form.email ? { email: form.email } : {}), ...(form.phone ? { phone: form.phone } : {}), ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}), ...(form.ssnLast4 ? { ssnLast4: form.ssnLast4 } : {}), ...(form.notes ? { notes: form.notes } : {}) }, {
          onSuccess: (d) => { setForm({ displayName: '', email: '', phone: '', dateOfBirth: '', ssnLast4: '', kind: 'individual', status: 'applicant', notes: '' }); onClose(); onCreated?.(d.id); },
        });
      }}>
        <Input label="Display name" required value={form.displayName} onChange={set('displayName')} error={fieldError('displayName')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Kind" value={form.kind} onChange={set('kind')}>{TENANT_PROFILE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select>
          <Select label="Status" value={form.status} onChange={set('status')}>{TENANT_PROFILE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </div>
        <Card title="Confidential contact details" as="div">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Email" type="email" value={form.email} onChange={set('email')} error={fieldError('email')} />
            <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} error={fieldError('phone')} hint="E.164, e.g. +15125550100" />
          </div>
        </Card>
        <Card title="Restricted identity fields" as="div">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Date of birth" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} error={fieldError('dateOfBirth')} />
            <Input label="SSN last 4" inputMode="numeric" pattern="\d{4}" maxLength={4} value={form.ssnLast4} onChange={set('ssnLast4')} error={fieldError('ssnLast4')} hint="Only the last four digits are ever stored." />
          </div>
        </Card>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-navy-900">Notes</span>
          <textarea value={form.notes} onChange={set('notes')} maxLength={4000} className="min-h-20 w-full rounded-lg border border-line bg-surface p-3 text-base" />
        </label>
        {create.isError && !(create.error instanceof ApiError && create.error.body.fieldErrors?.length) && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not create the profile'} />}
        <div className="flex gap-2"><Button type="submit" loading={create.isPending}>Create profile</Button><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button></div>
      </form>
    </Drawer>
  );
}
