'use client';
import Link from 'next/link';
import { useHealth, useOrgs } from '@/lib/hooks/iam';
import { useAuth } from '@/lib/auth';
import { Badge, Card, KpiCard, PageHeader, Button } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

export default function AdminOverview() {
  const { me } = useAuth();
  const health = useHealth();
  const orgs = useOrgs();
  return (
    <>
      <PageHeader title="Platform overview" description="Health, tenant organizations, and control-plane shortcuts." actions={<Link href="/admin/orgs"><Button variant="secondary">Organizations</Button></Link>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="API health" value={health.data?.status ?? '…'} hint={health.data ? `db ${health.data.checks.database}` : undefined} tone={health.data?.status === 'ok' ? 'success' : 'warning'} />
        <KpiCard label="Organizations" value={orgs.data ? orgs.data.pages.reduce((n, p) => n + p.items.length, 0) : '…'} hint="tenant orgs" />
        <KpiCard label="Your access" value={me?.roles[0]?.role.replace(/_/g, ' ') ?? ''} hint={me?.supportSessionId ? 'support session' : 'platform scope'} tone={me?.supportSessionId ? 'warning' : 'info'} />
      </div>
      <Card title="Recent organizations" className="mt-6">
        <StateView isLoading={orgs.isLoading} error={orgs.error} data={orgs.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No organizations yet', description: 'Create the first tenant org to onboard a customer.' }} onRetry={() => void orgs.refetch()}>
          {(d) => (
            <ul className="divide-y divide-line">
              {d.pages.flatMap((p) => p.items).slice(0, 8).map((o) => (
                <li key={o.id} className="flex items-center justify-between py-3"><div><p className="font-medium">{o.name}</p><p className="text-xs text-muted">{o.slug}</p></div><Badge tone={o.status === 'active' ? 'success' : 'warning'}>{o.plan} · {o.status}</Badge></li>
              ))}
            </ul>
          )}
        </StateView>
      </Card>
    </>
  );
}
