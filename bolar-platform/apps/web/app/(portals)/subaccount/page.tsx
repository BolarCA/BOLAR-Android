'use client';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useUsers, useInvitations, useSensitiveAccessRequests } from '@/lib/hooks/iam';
import { Button, Card, KpiCard, PageHeader } from '@/components/ui';

export default function SubaccountOverview() {
  const { me } = useAuth();
  const users = useUsers();
  const invites = useInvitations();
  const access = useSensitiveAccessRequests({ status: 'pending' });
  const count = (d: { pages: { items: unknown[] }[] } | undefined) => (d ? d.pages.reduce((n, p) => n + p.items.length, 0) : '…');
  return (
    <>
      <PageHeader title={`${me?.org.name ?? 'Organization'} administration`} description="Staff, roles, access approvals and scoped audit for your organization." />
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Active staff" value={count(users.data)} hint="users" />
        <KpiCard label="Open invitations" value={invites.data ? invites.data.pages.flatMap((p) => p.items).filter((i) => i.status === 'pending').length : '…'} hint="pending" tone="info" />
        <KpiCard label="Access approvals" value={count(access.data)} hint="awaiting decision" tone="violet" />
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card title="Staff and roles"><p className="text-sm text-muted">Invite staff and assign scoped roles.</p><Link href="/subaccount/users" className="mt-4 inline-block"><Button variant="secondary">Manage staff</Button></Link></Card>
        <Card title="Audit"><p className="text-sm text-muted">Review allow, deny and review-required events.</p><Link href="/subaccount/audit" className="mt-4 inline-block"><Button variant="secondary">Open audit log</Button></Link></Card>
      </div>
    </>
  );
}
