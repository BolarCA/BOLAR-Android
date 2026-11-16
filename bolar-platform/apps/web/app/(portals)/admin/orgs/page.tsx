'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, newIdempotencyKey } from '@/lib/api-client';
import { useOrgs, type OrgDto } from '@/lib/hooks/iam';
import { Alert, Badge, Button, Drawer, Input, PageHeader, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

export default function OrgsPage() {
  const orgs = useOrgs();
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ slug: '', name: '', adminEmail: '', adminName: '' });
  const [key] = useState(() => newIdempotencyKey());
  const create = useMutation({
    mutationFn: () => api<OrgDto & { adminInviteToken: string }>('/orgs', { method: 'POST', body: { ...form, plan: 'pilot' }, idempotencyKey: key }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orgs'] }),
  });
  return (
    <>
      <PageHeader title="Organizations" description="Tenant orgs on the platform. Creating one issues an org-admin invitation." actions={<Button onClick={() => setOpen(true)}>New organization</Button>} />
      <StateView isLoading={orgs.isLoading} error={orgs.error} data={orgs.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No organizations', action: <Button onClick={() => setOpen(true)}>New organization</Button> }} onRetry={() => void orgs.refetch()}>
        {(d) => <Table<OrgDto> caption="Organizations" rows={d.pages.flatMap((p) => p.items)} onRowClick={(o) => router.push(`/admin/orgs/${o.id}`)} columns={[
          { key: 'name', header: 'Name', render: (o) => <div><Link href={`/admin/orgs/${o.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{o.name}</Link><p className="text-xs text-muted">{o.slug}</p></div> },
          { key: 'plan', header: 'Plan', render: (o) => <Badge tone="violet">{o.plan}</Badge> },
          { key: 'status', header: 'Status', render: (o) => <Badge tone={statusTone(o.status)}>{o.status}</Badge> },
          { key: 'created', header: 'Created', render: (o) => new Date(o.createdAt).toLocaleDateString() },
        ]} />}
      </StateView>
      <Drawer open={open} onClose={() => setOpen(false)} title="Create organization">
        {create.isSuccess ? (
          <div className="space-y-4"><Alert tone="success" title={`${create.data.name} created`}>Org admin invitation issued to {form.adminEmail}.</Alert><Button onClick={() => setOpen(false)}>Done</Button></div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Input label="Slug" required pattern="^[a-z0-9][a-z0-9-]{1,62}$" hint="lowercase letters, numbers, dashes" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Admin email" type="email" required value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
            <Input label="Admin name" required value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} />
            {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Failed'} />}
            <Button type="submit" loading={create.isPending}>Create</Button>
          </form>
        )}
      </Drawer>
    </>
  );
}
