'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError, getActAsOrg, setActAsOrg } from '@/lib/api-client';
import { useOrg, useOrgRecentAudit, useOrgSubaccounts, useOrgUsers, useStartSupportSession, useSupportSessions, useUpdateOrg, type SubaccountDto } from '@/lib/hooks/platform';
import type { AuditDto } from '@/lib/hooks/iam';
import { Alert, Badge, Button, Card, Drawer, Input, KpiCard, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/** Master admin org detail (blueprint p37, Day 51): plan/status, subaccounts, users, recent audit, support session, act-as. */
export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const qc = useQueryClient();
  const canAdmin = useCan('platform:admin');
  const canSupport = useCan('support_session:start');
  const org = useOrg(id);
  const slug = org.data?.slug;
  const subaccounts = useOrgSubaccounts(slug);
  const users = useOrgUsers(slug);
  const recent = useOrgRecentAudit(slug);
  const sessions = useSupportSessions({ active: 'true', tenantOrgId: id });
  const update = useUpdateOrg(id);
  const [form, setForm] = useState<{ name: string; plan: string; status: string } | null>(null);
  const [supportOpen, setSupportOpen] = useState(false);
  const [actAs, setActAs] = useState<string | null>(null);
  useEffect(() => { setActAs(getActAsOrg()); }, []);
  useEffect(() => { if (org.data && !form) setForm({ name: org.data.name, plan: org.data.plan, status: org.data.status }); }, [org.data, form]);

  const activeSession = sessions.data?.pages.flatMap((p) => p.items).find((s) => s.agentUserId === me?.actor.id);
  const startActing = () => { if (!slug) return; setActAsOrg(slug); qc.clear(); window.location.assign('/admin'); };

  return (
    <StateView isLoading={org.isLoading} error={org.error} data={org.data} onRetry={() => void org.refetch()} skeleton="detail">
      {(o) => (
        <>
          <PageHeader title={o.name} description={`${o.slug} · created ${new Date(o.createdAt).toLocaleDateString()}`} actions={<>
            <Link href="/admin/orgs"><Button variant="ghost">All organizations</Button></Link>
            {canSupport && <Button variant="secondary" onClick={() => setSupportOpen(true)} disabled={Boolean(activeSession)}>{activeSession ? 'Support session active' : 'Start support session'}</Button>}
            {canAdmin && (actAs === o.slug
              ? <Badge tone="warning">Acting as this org</Badge>
              : <Button onClick={startActing} aria-label={`Act as ${o.name}`}>Act as org</Button>)}
          </>} />

          <div className="grid gap-4 sm:grid-cols-4">
            <KpiCard label="Plan" value={<span className="capitalize">{o.plan}</span>} hint={o.status} tone={statusTone(o.status)} />
            <KpiCard label="Subaccounts" value={subaccounts.data ? subaccounts.data.items.length : '…'} hint="in this org" />
            <KpiCard label="Users" value={users.data ? `${users.data.items.length}${users.data.nextCursor ? '+' : ''}` : '…'} hint={users.data ? `${users.data.items.filter((u) => u.status === 'active').length} active` : undefined} tone="info" />
            <KpiCard label="Support" value={activeSession ? 'Active' : 'None'} hint={activeSession ? `ends ${new Date(activeSession.endsAt).toLocaleTimeString()}` : 'no session for you'} tone={activeSession ? 'warning' : 'neutral'} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title="Plan and status">
              {form && (
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); update.mutate({ name: form.name !== o.name ? form.name : undefined, plan: form.plan !== o.plan ? form.plan : undefined, status: form.status !== o.status ? form.status : undefined }); }}>
                  <Input label="Organization name" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={!canAdmin} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select label="Plan" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} disabled={!canAdmin}>
                      {['pilot', 'standard', 'enterprise'].map((p) => <option key={p} value={p}>{p}</option>)}
                      {!['pilot', 'standard', 'enterprise'].includes(form.plan) && <option value={form.plan}>{form.plan}</option>}
                    </Select>
                    <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} disabled={!canAdmin} aria-describedby="status-hint">
                      <option value="active">active</option><option value="suspended">suspended</option>
                    </Select>
                  </div>
                  <p id="status-hint" className="text-xs text-muted">Suspending an org blocks every sign-in for its users; the change is audited in both the org and the platform log.</p>
                  {update.isSuccess && <Alert tone="success" title="Organization updated" />}
                  {update.isError && <Alert tone="danger" title={update.error instanceof ApiError ? update.error.message : 'Update failed'} />}
                  {canAdmin && <Button type="submit" loading={update.isPending}>Save changes</Button>}
                </form>
              )}
            </Card>

            <Card title="Subaccounts">
              <StateView isLoading={subaccounts.isLoading} error={subaccounts.error} data={subaccounts.data} isEmpty={(d) => d.items.length === 0} empty={{ title: 'No subaccounts', description: 'The org admin creates subaccounts from the subaccount portal.' }} onRetry={() => void subaccounts.refetch()}>
                {(d) => <Table<SubaccountDto> caption="Subaccounts" rows={d.items} columns={[
                  { key: 'name', header: 'Name', render: (s) => <span className="font-medium">{s.name}</span> },
                  { key: 'status', header: 'Status', render: (s) => <Badge tone={statusTone(s.status)}>{s.status}</Badge> },
                  { key: 'created', header: 'Created', render: (s) => new Date(s.createdAt).toLocaleDateString() },
                ]} />}
              </StateView>
            </Card>
          </div>

          <Card title="Recent audit activity" className="mt-6" actions={<Link href="/admin/support-sessions" className="text-sm text-cobalt-600 underline">Support sessions</Link>}>
            <StateView isLoading={recent.isLoading} error={recent.error} data={recent.data} isEmpty={(d) => d.items.length === 0} empty={{ title: 'No audit events yet' }} onRetry={() => void recent.refetch()}>
              {(d) => <Table<AuditDto> caption="Recent audit events" rows={d.items} columns={[
                { key: 'time', header: 'When', render: (r) => <span className="whitespace-nowrap text-xs">{new Date(r.createdAt).toLocaleString()}</span> },
                { key: 'action', header: 'Action', render: (r) => <code className="text-xs">{r.action}</code> },
                { key: 'resource', header: 'Resource', render: (r) => <span className="text-xs">{r.resourceType}</span> },
                { key: 'outcome', header: 'Outcome', render: (r) => <Badge tone={statusTone(r.outcome)}>{r.outcome}</Badge> },
              ]} />}
            </StateView>
          </Card>

          <SupportDrawer open={supportOpen} onClose={() => setSupportOpen(false)} org={o} />
        </>
      )}
    </StateView>
  );
}

function SupportDrawer({ open, onClose, org }: { open: boolean; onClose: () => void; org: { id: string; slug: string; name: string } }) {
  const start = useStartSupportSession();
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('60');
  return (
    <Drawer open={open} onClose={onClose} title={`Support session: ${org.name}`}>
      {start.isSuccess ? (
        <div className="space-y-4">
          <Alert tone="success" title="Support session started">Time-boxed until {new Date(start.data.endsAt).toLocaleString()}. Use "Act as org" to work inside {org.name}; every request is audited against this session.</Alert>
          <Button onClick={() => { start.reset(); setReason(''); onClose(); }}>Done</Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start.mutate({ tenantOrgId: org.id, reason, durationMinutes: Number(duration) }); }}>
          <label htmlFor="support-reason" className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Reason (ticket reference)</span>
            <textarea id="support-reason" required minLength={10} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-24 w-full rounded-lg border border-line bg-surface p-3 text-base" placeholder="Ticket #, what the customer reported, what you need to inspect" />
          </label>
          <Select label="Duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
            <option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option><option value="480">8 hours</option>
          </Select>
          {start.isError && <Alert tone="danger" title={start.error instanceof ApiError ? start.error.message : 'Could not start session'} />}
          <Button type="submit" loading={start.isPending}>Start session</Button>
        </form>
      )}
    </Drawer>
  );
}
