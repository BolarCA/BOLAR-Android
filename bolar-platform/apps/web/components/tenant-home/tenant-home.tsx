'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { LeaseDto, WorkOrderDto } from '@bolar/contracts';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { cents, day } from '@/lib/hooks/lease';
import { fmtDate } from '@/lib/hooks/finance';
import type { DocumentDto } from '@/lib/hooks/document';
import type { NotificationDto } from '@/lib/hooks/notification';
import { useOnline, useTenantHome, type TenantHomeModel } from '@/lib/hooks/portal-home';
import { Alert, Badge, Button, Card, PageHeader, cn, statusTone } from '@/components/ui';
import { EmptyState, StateView } from '@/components/ui/state-view';

/**
 * Resident mobile home (blueprint p48, Day 52): property card, rent balance with pay CTA, maintenance CTA, documents,
 * notices, messages and profile. Mobile-first single column, large tap targets, BOLAR palette, synthetic data only.
 * States: zero balance, overdue, restricted document, pending maintenance, no active lease, offline / loading skeleton.
 */
export function TenantHome() {
  const { me } = useAuth();
  const online = useOnline();
  const home = useTenantHome();
  const firstName = me?.actor.name.split(' ')[0] ?? 'there';
  return (
    <div data-testid="tenant-home">
      <PageHeader title={`Hi, ${firstName}`} description={home.model.lease ? `${home.model.lease.property.name} · Unit ${home.model.lease.unit.unitNumber}` : 'Your rent, requests, documents and notices in one place.'} />
      {!online && (
        <div className="mb-4" data-testid="offline-banner">
          <Alert tone="warning" title="You're offline">{home.model.lease ? 'Showing the last information we loaded. Payments and new requests need a connection.' : 'We will load your home as soon as the connection returns.'}</Alert>
        </div>
      )}
      <StateView isLoading={home.isLoading} error={home.error} data={home.queries.leases.data} onRetry={home.refetchAll} skeleton="cards" isEmpty={() => home.model.lease === null}
        empty={{ title: 'No active lease yet', description: 'Your home screen fills in once your property manager links a signed lease to this login. You can still update your profile and read messages.', action: <div className="flex flex-wrap justify-center gap-2"><LinkButton href="/tenant/profile">Open profile</LinkButton><LinkButton href="/tenant/documents" variant="secondary">Messages</LinkButton></div> }}>
        {() => <HomeBody model={home.model} queries={home.queries} />}
      </StateView>
    </div>
  );
}

function HomeBody({ model, queries }: { model: TenantHomeModel; queries: ReturnType<typeof useTenantHome>['queries'] }) {
  const lease = model.lease!;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <PropertyCard lease={lease} />
      <Panel query={queries.invoices} label="balance"><BalanceCard model={model} /></Panel>
      <QuickActions model={model} />
      <Panel query={queries.workOrders} label="maintenance requests"><MaintenanceCard model={model} /></Panel>
      <Panel query={queries.documents} label="documents"><DocumentsCard docs={model.documents} /></Panel>
      <Panel query={queries.notifications} label="notices"><NoticesCard notices={model.notices} /></Panel>
      <Panel query={queries.notifications} label="messages"><MessagesCard messages={model.messages} /></Panel>
      <ProfileCard />
    </div>
  );
}

/** Secondary panels degrade on their own: a failed invoice call must not hide the property card. */
function Panel({ query, label, children }: { query: { isLoading: boolean; error: unknown; refetch: () => unknown }; label: string; children: ReactNode }) {
  if (query.isLoading) return <div role="status" aria-busy="true" className="h-40 animate-pulse rounded-[14px] bg-navy-100"><span className="sr-only">Loading {label}</span></div>;
  if (query.error) {
    return (
      <Card title={label[0]!.toUpperCase() + label.slice(1)}>
        <Alert tone="danger" title={`We couldn't load your ${label}`}>{query.error instanceof ApiError ? query.error.message : 'Check your connection and try again.'}</Alert>
        <Button variant="secondary" className="mt-3" onClick={() => void query.refetch()}>Try again</Button>
      </Card>
    );
  }
  return <>{children}</>;
}

function LinkButton({ href, children, variant = 'primary', className, ...rest }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' | 'ghost'; className?: string; 'aria-label'?: string; 'data-testid'?: string }) {
  const styles = { primary: 'bg-cobalt-500 text-white hover:bg-cobalt-600', secondary: 'bg-surface text-navy-900 border border-line hover:bg-navy-50', ghost: 'bg-transparent text-cobalt-700 hover:bg-cobalt-100' };
  return <Link href={href} className={cn('inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-5 text-base font-semibold transition', styles[variant], className)} {...rest}>{children}</Link>;
}

// ───────── cards ─────────
function PropertyCard({ lease }: { lease: LeaseDto }) {
  return (
    <Card as="article" className="relative overflow-hidden bg-gradient-to-br from-navy-900 via-navy-700 to-cobalt-700 text-white md:col-span-2" title={undefined}>
      <div data-testid="property-card">
        <p className="text-xs font-semibold uppercase tracking-wide text-navy-100">Your home</p>
        <h2 id="property-card-title" className="mt-1 text-2xl font-semibold tracking-tight">{lease.property.name}</h2>
        <p className="mt-1 text-base text-navy-100">Unit {lease.unit.unitNumber} · {lease.property.city}, {lease.property.state}</p>
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div><dt className="text-navy-100">Lease</dt><dd className="mt-0.5 font-semibold capitalize">{lease.status}</dd></div>
          <div><dt className="text-navy-100">Monthly rent</dt><dd className="mt-0.5 font-semibold">{cents(lease.rentCents)}</dd></div>
          <div><dt className="text-navy-100">Starts</dt><dd className="mt-0.5 font-semibold">{day(lease.startDate)}</dd></div>
          <div><dt className="text-navy-100">Ends</dt><dd className="mt-0.5 font-semibold">{day(lease.endDate)}</dd></div>
        </dl>
      </div>
    </Card>
  );
}

function BalanceCard({ model }: { model: TenantHomeModel }) {
  const b = model.balance;
  const tone = b.state === 'overdue' ? 'danger' : b.state === 'due' ? 'info' : 'success';
  return (
    <Card as="section" title="Rent balance" className={cn(b.state === 'overdue' && 'border-danger-600')} actions={<Badge tone={tone}>{b.state === 'overdue' ? 'Overdue' : b.state === 'due' ? 'Due' : 'Paid up'}</Badge>}>
      <div data-testid="home-balance" data-state={b.state} data-cents={b.cents}>
        <p className={cn('text-4xl font-semibold tracking-tight', b.state === 'overdue' ? 'text-danger-600' : 'text-navy-900')}>{cents(b.cents)}</p>
        {b.state === 'zero' && <p className="mt-1 text-sm text-muted">Nothing due right now. Your next invoice appears here when it is issued.</p>}
        {b.state === 'due' && b.nextDue && <p className="mt-1 text-sm text-muted">Due {fmtDate(b.nextDue)} · {b.openCount} open invoice{b.openCount === 1 ? '' : 's'}</p>}
        {b.state === 'overdue' && (
          <div className="mt-2" role="alert">
            <p className="text-sm font-semibold text-danger-600">{b.overdueCount} invoice{b.overdueCount === 1 ? ' is' : 's are'} past due{b.nextDue ? ` (oldest due ${fmtDate(b.nextDue)})` : ''}.</p>
            <p className="mt-1 text-sm text-ink">Pay today to avoid late fees. If you need a plan, message your property manager.</p>
          </div>
        )}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {b.state === 'zero' ? <LinkButton href="/tenant/pay" variant="secondary">Payment history</LinkButton> : <LinkButton href="/tenant/pay" data-testid="pay-cta">Pay {cents(b.cents)}</LinkButton>}
        </div>
      </div>
    </Card>
  );
}

function QuickActions({ model }: { model: TenantHomeModel }) {
  return (
    <section aria-label="Quick actions" className="grid grid-cols-2 gap-3 md:col-span-2 md:grid-cols-4">
      <Action href="/tenant/pay" label="Pay rent" hint={model.balance.state === 'zero' ? 'Paid up' : cents(model.balance.cents)} tone="cobalt" />
      <Action href="/tenant/maintenance" label="Request repair" hint={model.maintenance.pending ? `${model.maintenance.pending} open` : 'Something broken?'} tone="teal" testId="maintenance-cta" />
      <Action href="/tenant/documents" label="Documents" hint={`${model.documents.length} file${model.documents.length === 1 ? '' : 's'}`} tone="violet" />
      <Action href="/tenant/profile" label="Profile" hint="Contacts & security" tone="orange" />
    </section>
  );
}
function Action({ href, label, hint, tone, testId }: { href: string; label: string; hint: string; tone: 'cobalt' | 'teal' | 'violet' | 'orange'; testId?: string }) {
  const tones = { cobalt: 'border-cobalt-100 bg-cobalt-100/50 text-cobalt-700', teal: 'border-teal-100 bg-teal-100/60 text-teal-700', violet: 'border-violet-100 bg-violet-100/60 text-violet-700', orange: 'border-orange-100 bg-orange-100/60 text-orange-900' };
  return (
    <Link href={href} data-testid={testId} className={cn('flex min-h-[72px] flex-col justify-center rounded-[14px] border px-4 py-3 shadow-sm transition hover:shadow', tones[tone])}>
      <span className="text-base font-semibold">{label}</span>
      <span className="text-xs text-ink">{hint}</span>
    </Link>
  );
}

function MaintenanceCard({ model }: { model: TenantHomeModel }) {
  const m = model.maintenance;
  return (
    <Card title="Maintenance" actions={<Badge tone={m.pending ? 'info' : 'success'}><span data-testid="maintenance-pending-count" data-count={m.pending}>{m.pending}</span>&nbsp;pending</Badge>}>
      {m.recent.length === 0 ? <EmptyState title="No requests yet" description="Report a problem and track it here." action={<LinkButton href="/tenant/maintenance">Request repair</LinkButton>} /> : (
        <ul className="divide-y divide-line">
          {m.recent.map((w: WorkOrderDto) => (
            <li key={w.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0"><p className="truncate font-medium text-navy-900">{w.title}</p><p className="text-xs text-muted">{w.number} · {w.priority}</p></div>
              <Badge tone={statusTone(w.status)}>{w.status.replace(/_/g, ' ')}</Badge>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <LinkButton href="/tenant/maintenance">Request repair</LinkButton>
        {m.recent.length > 0 && <LinkButton href="/tenant/maintenance" variant="secondary">All requests</LinkButton>}
      </div>
    </Card>
  );
}

function DocumentsCard({ docs }: { docs: DocumentDto[] }) {
  return (
    <Card title="Documents">
      <div data-testid="home-documents">
        {docs.length === 0 ? <EmptyState title="No documents yet" description="Your lease and shared files appear here once your manager uploads them." /> : (
          <ul className="divide-y divide-line">
            {docs.map((d) => (
              <li key={d.id} data-testid="home-document" data-gated={d.gated} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium text-navy-900">{d.gated && <LockIcon />}<span className="truncate">{d.title}</span></p>
                  <p className="text-xs text-muted">{d.category.replace(/_/g, ' ')} · {d.classification}{d.legalHold ? ' · legal hold' : ''}</p>
                </div>
                {d.gated ? (
                  <div className="text-right text-xs">
                    <Badge tone="violet">Approval required</Badge>
                    <Link href="/tenant/documents" className="mt-1 block min-h-11 font-semibold leading-[44px] text-cobalt-700 underline" aria-label={`Request access to ${d.title}`}>Request access</Link>
                  </div>
                ) : <LinkButton href="/tenant/documents" variant="secondary" aria-label={`Open ${d.title}`}>Open</LinkButton>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">Confidential files open only with an approved purpose; every download is audited.</p>
    </Card>
  );
}
function LockIcon() {
  return <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-violet-700"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
}

function NoticesCard({ notices }: { notices: NotificationDto[] }) {
  return (
    <Card title="Notices" actions={notices.some((n) => !n.readAt) ? <Badge tone="warning">{notices.filter((n) => !n.readAt).length} new</Badge> : undefined}>
      <div data-testid="home-notices">
        {notices.length === 0 ? <EmptyState title="No notices" description="Formal notices from your property manager (late rent, entry, lease changes) appear here with their delivery date." /> : (
          <ul className="divide-y divide-line">
            {notices.slice(0, 3).map((n) => <NotificationRow key={n.id} n={n} />)}
          </ul>
        )}
      </div>
    </Card>
  );
}

function MessagesCard({ messages }: { messages: NotificationDto[] }) {
  return (
    <Card title="Messages" actions={<Link href="/tenant/documents" className="inline-flex min-h-11 items-center text-sm font-semibold text-cobalt-700 hover:underline">All messages</Link>}>
      <div data-testid="home-messages">
        {messages.length === 0 ? <EmptyState title="No messages" description="Updates about requests, invoices and your lease arrive here." /> : (
          <ul className="divide-y divide-line">{messages.slice(0, 3).map((n) => <NotificationRow key={n.id} n={n} />)}</ul>
        )}
      </div>
    </Card>
  );
}
function NotificationRow({ n }: { n: NotificationDto }) {
  return (
    <li className="py-3">
      <p className="flex items-start justify-between gap-2 font-medium text-navy-900"><span>{n.subject ?? n.templateKey}</span>{!n.readAt && <Badge tone="info">new</Badge>}</p>
      {n.body && <p className="mt-1 line-clamp-2 text-sm text-ink">{n.body}</p>}
      <p className="mt-1 text-xs text-muted">{new Date(n.createdAt).toLocaleString()}</p>
    </li>
  );
}

function ProfileCard() {
  const { me } = useAuth();
  return (
    <Card title="Profile">
      <p className="font-medium text-navy-900">{me?.actor.name}</p>
      <p className="text-sm text-muted">{me?.actor.email}</p>
      <p className="mt-2 text-sm">Two-step verification: {me?.actor.mfaEnabled ? <Badge tone="success">on</Badge> : <Badge tone="warning">off</Badge>}</p>
      <div className="mt-4"><LinkButton href="/tenant/profile" variant="secondary">Manage profile</LinkButton></div>
    </Card>
  );
}
