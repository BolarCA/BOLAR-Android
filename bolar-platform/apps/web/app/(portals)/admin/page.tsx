'use client';
import Link from 'next/link';
import { useHealth, useOrgs } from '@/lib/hooks/iam';
import { useHealthSummary, useSupportSessions } from '@/lib/hooks/platform';
import { useAuth, useCan } from '@/lib/auth';
import { Badge, Card, KpiCard, PageHeader, Button } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/** Master admin overview (blueprint p37, Day 51): health summary, tenant list, support-session shortcuts. */
export default function AdminOverview() {
  const { me } = useAuth();
  const isPlatformAdmin = useCan('platform:admin');
  const canSupport = useCan('support_session:start');
  // Support agents without platform:admin fall back to the public liveness check.
  const summary = useHealthSummary(isPlatformAdmin);
  const health = useHealth();
  const orgs = useOrgs();
  const sessions = useSupportSessions({ active: 'true' });
  const status = summary.data?.status ?? health.data?.status;
  const db = summary.data?.checks.database ?? health.data?.checks.database;
  return (
    <>
      <PageHeader title="Platform overview" description="Health, tenant organizations, and control-plane shortcuts." actions={<>
        {canSupport && <Link href="/admin/support-sessions"><Button variant="secondary">Support sessions</Button></Link>}
        {isPlatformAdmin && <Link href="/admin/orgs"><Button variant="secondary">Organizations</Button></Link>}
      </>} />
      <section aria-label="Platform health" className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6" data-testid="health-summary">
        <KpiCard label="API health" value={status ?? '…'} hint={db ? `db ${db}` : undefined} tone={status === 'ok' ? 'success' : 'warning'} />
        <KpiCard label="Organizations" value={summary.data ? summary.data.counts.orgs : orgs.data ? orgs.data.pages.reduce((n, p) => n + p.items.length, 0) : '…'} hint={summary.data ? `${summary.data.counts.activeOrgs} active` : 'tenant orgs'} />
        <KpiCard label="Active users" value={isPlatformAdmin ? (summary.data?.counts.users ?? '…') : '—'} hint="all orgs" tone="info" />
        <KpiCard label="Live sessions" value={isPlatformAdmin ? (summary.data?.counts.activeSessions ?? '…') : '—'} hint="not expired or revoked" tone="info" />
        <KpiCard label="Support sessions" value={summary.data?.counts.activeSupportSessions ?? (sessions.data ? sessions.data.pages.reduce((n, p) => n + p.items.length, 0) : '…')} hint="active now" tone={(summary.data?.counts.activeSupportSessions ?? 0) > 0 ? 'warning' : 'neutral'} />
        <KpiCard label="Queue" value={isPlatformAdmin ? (summary.data?.queueDriver ?? '…') : '—'} hint={summary.data ? `v${summary.data.version}` : undefined} />
      </section>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Recent organizations">
          <StateView isLoading={orgs.isLoading} error={orgs.error} data={orgs.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No organizations yet', description: 'Create the first tenant org to onboard a customer.' }} onRetry={() => void orgs.refetch()}>
            {(d) => (
              <ul className="divide-y divide-line">
                {d.pages.flatMap((p) => p.items).slice(0, 8).map((o) => (
                  <li key={o.id} className="flex items-center justify-between py-3"><div><Link href={`/admin/orgs/${o.id}`} className="font-medium hover:underline">{o.name}</Link><p className="text-xs text-muted">{o.slug}</p></div><Badge tone={o.status === 'active' ? 'success' : 'warning'}>{o.plan} · {o.status}</Badge></li>
                ))}
              </ul>
            )}
          </StateView>
        </Card>
        <Card title="Your access">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Role</dt><dd className="font-medium capitalize">{me?.roles.map((r) => r.role.replace(/_/g, ' ')).join(', ')}</dd></div>
            <div><dt className="text-muted">Context</dt><dd className="font-medium">{me?.supportSessionId ? 'Support session' : 'Platform scope'}</dd></div>
            <div><dt className="text-muted">Organization</dt><dd className="font-medium">{me?.org.name}</dd></div>
            <div><dt className="text-muted">MFA</dt><dd className="font-medium">{me?.actor.mfaEnabled ? (me.actor.mfaVerified ? 'verified' : 'required') : 'not enrolled'}</dd></div>
          </dl>
          <StateView isLoading={sessions.isLoading} error={sessions.error} data={sessions.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No active support sessions' }} onRetry={() => void sessions.refetch()} skeleton="list">
            {(d) => (
              <ul className="mt-4 divide-y divide-line border-t border-line">
                {d.pages.flatMap((p) => p.items).slice(0, 5).map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2 text-sm"><span>{s.org?.name ?? s.tenantOrgId} · {s.agent?.name ?? s.agentUserId}</span><Badge tone="warning">ends {new Date(s.endsAt).toLocaleTimeString()}</Badge></li>
                ))}
              </ul>
            )}
          </StateView>
        </Card>
      </div>
    </>
  );
}
