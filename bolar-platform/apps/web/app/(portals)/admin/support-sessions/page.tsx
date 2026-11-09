'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError, getActAsOrg, setActAsOrg } from '@/lib/api-client';
import { useOrgs } from '@/lib/hooks/iam';
import { relTime, useEndSupportSession, useStartSupportSession, useSupportSessions, type SupportSessionDto } from '@/lib/hooks/platform';
import { Alert, Badge, Button, Drawer, PageHeader, Select, Table } from '@/components/ui';
import { Denied, StateView } from '@/components/ui/state-view';

/** Support sessions (Day 51): time-boxed, reasoned, audited cross-tenant access for platform staff. */
export default function SupportSessionsPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const canStart = useCan('support_session:start');
  const [filter, setFilter] = useState<'true' | 'all'>('true');
  const [open, setOpen] = useState(false);
  const [actAs, setActAs] = useState<string | null>(null);
  useEffect(() => { setActAs(getActAsOrg()); }, []);
  const sessions = useSupportSessions(filter === 'true' ? { active: 'true' } : {});
  const end = useEndSupportSession();
  if (!canStart || !me?.actor.isPlatform) return <Denied />;
  const actOn = (slug: string) => { setActAsOrg(slug); qc.clear(); window.location.assign('/admin'); };
  const stopActing = () => { setActAsOrg(null); qc.clear(); window.location.assign('/admin/support-sessions'); };
  return (
    <>
      <PageHeader title="Support sessions" description="Each session grants time-boxed access to one customer organization. The reason, every cross-tenant request and the end of the session are written to both audit logs." actions={<>
        {actAs && <Button variant="secondary" onClick={stopActing}>Stop acting as {actAs}</Button>}
        <Button onClick={() => setOpen(true)}>Start session</Button>
      </>} />
      <div className="mb-4 max-w-xs">
        <Select label="Show" value={filter} onChange={(e) => setFilter(e.target.value as 'true' | 'all')}><option value="true">Active sessions</option><option value="all">All sessions</option></Select>
      </div>
      {end.isError && <div className="mb-4"><Alert tone="danger" title={end.error instanceof ApiError ? end.error.message : 'Could not end session'} /></div>}
      <StateView isLoading={sessions.isLoading} error={sessions.error} data={sessions.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: filter === 'true' ? 'No active support sessions' : 'No support sessions yet', description: 'Start one from here or from an organization page when a customer ticket needs hands-on investigation.', action: <Button onClick={() => setOpen(true)}>Start session</Button> }} onRetry={() => void sessions.refetch()}>
        {(d) => (
          <>
            <Table<SupportSessionDto> caption="Support sessions" rows={d.pages.flatMap((p) => p.items)} columns={[
              { key: 'org', header: 'Organization', render: (s) => <div><p className="font-medium">{s.org?.name ?? s.tenantOrgId}</p><p className="text-xs text-muted">{s.org?.slug}</p></div> },
              { key: 'agent', header: 'Agent', render: (s) => <span className="text-sm">{s.agent?.name ?? s.agentUserId}{s.agentUserId === me.actor.id ? ' (you)' : ''}</span> },
              { key: 'reason', header: 'Reason', render: (s) => <span className="text-sm">{s.reason}</span> },
              { key: 'window', header: 'Window', render: (s) => <span className="whitespace-nowrap text-xs">{new Date(s.startedAt).toLocaleString()}<br />{s.endedAt ? `ended ${relTime(s.endedAt)}` : `ends ${relTime(s.endsAt)}`}</span> },
              { key: 'state', header: 'State', render: (s) => <Badge tone={s.active ? 'warning' : 'neutral'}>{s.active ? 'active' : s.endedAt ? 'ended' : 'expired'}</Badge> },
              { key: 'actions', header: '', className: 'text-right', render: (s) => s.active ? (
                <div className="flex justify-end gap-2">
                  {s.agentUserId === me.actor.id && s.org && actAs !== s.org.slug && <Button variant="secondary" onClick={() => actOn(s.org!.slug)} aria-label={`Act as ${s.org.name}`}>Act as org</Button>}
                  <Button variant="danger" onClick={() => end.mutate(s.id)} aria-label={`End support session for ${s.org?.name ?? s.tenantOrgId}`} loading={end.isPending && end.variables === s.id}>End</Button>
                </div>
              ) : null },
            ]} />
            {sessions.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void sessions.fetchNextPage()} loading={sessions.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      <StartDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function StartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const orgs = useOrgs();
  const start = useStartSupportSession();
  const [form, setForm] = useState({ tenantOrgId: '', reason: '', durationMinutes: '60' });
  return (
    <Drawer open={open} onClose={onClose} title="Start a support session">
      {start.isSuccess ? (
        <div className="space-y-4"><Alert tone="success" title={`Session started for ${start.data.org?.name ?? 'organization'}`}>Ends {new Date(start.data.endsAt).toLocaleString()}.</Alert><Button onClick={() => { start.reset(); setForm({ tenantOrgId: '', reason: '', durationMinutes: '60' }); onClose(); }}>Done</Button></div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start.mutate({ tenantOrgId: form.tenantOrgId, reason: form.reason, durationMinutes: Number(form.durationMinutes) }); }}>
          <Select label="Organization" required value={form.tenantOrgId} onChange={(e) => setForm({ ...form, tenantOrgId: e.target.value })}>
            <option value="">Choose an organization</option>
            {orgs.data?.pages.flatMap((p) => p.items).map((o) => <option key={o.id} value={o.id}>{o.name} ({o.slug})</option>)}
          </Select>
          <label htmlFor="session-reason" className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Reason (ticket reference)</span>
            <textarea id="session-reason" required minLength={10} maxLength={1000} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="min-h-24 w-full rounded-lg border border-line bg-surface p-3 text-base" placeholder="Ticket #, what the customer reported, what you need to inspect" />
          </label>
          <Select label="Duration" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}>
            <option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option><option value="480">8 hours</option>
          </Select>
          {start.isError && <Alert tone="danger" title={start.error instanceof ApiError ? start.error.message : 'Could not start session'} />}
          <Button type="submit" loading={start.isPending}>Start session</Button>
        </form>
      )}
    </Drawer>
  );
}
