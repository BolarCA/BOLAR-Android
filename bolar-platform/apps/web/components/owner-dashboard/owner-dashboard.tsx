'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { LeaseDto, PropertyDto } from '@bolar/contracts';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { cents, day } from '@/lib/hooks/lease';
import { humanize } from '@/lib/hooks/property';
import { useOwnerPortfolio, type OwnerPortfolioModel } from '@/lib/hooks/portal-home';
import { Alert, Badge, Button, Card, PageHeader, cn, statusTone } from '@/components/ui';
import { Progress, occupancyTone } from '@/components/ui/progress';
import { EmptyState, StateView } from '@/components/ui/state-view';

/**
 * Landlord portfolio dashboard (blueprint p39, Day 53): KPI cards, property list with occupancy bars, map placeholder,
 * approvals inbox and finance summary. Every list is relationship-scoped by the API (owner_of edges); finance figures
 * render only with `finance:read`. Empty portfolio and denied property states are first-class.
 */
export function OwnerDashboard() {
  const { model, properties, approvals, invoices, payments, workOrders, canApprove, canFinance } = useOwnerPortfolio();
  const canDocuments = useCan('document:read');
  return (
    <div data-testid="owner-dashboard">
      <PageHeader title="Portfolio" description="Occupancy, approvals and income across the properties you own. Figures update as your property manager works; nothing here is editable." />
      <StateView isLoading={properties.isLoading} error={properties.error} data={properties.data} skeleton="cards" onRetry={() => void properties.refetch()} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)}
        empty={{ title: 'No properties in your portfolio yet', description: 'Your dashboard fills in when your property manager records you as the owner of a property or portfolio. Until then there is nothing to report.', action: canDocuments ? <LinkButton href="/owner/documents" variant="secondary">Documents shared with you</LinkButton> : undefined }}>
        {() => (
          <>
            <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="owner-kpis">
              <Kpi id="properties" label="Properties" value={model.properties.length} hint={`${model.properties.filter((p) => p.status === 'active').length} active`} />
              <Kpi id="units" label="Units" value={model.units} hint={`${model.occupied} rented`} />
              <Kpi id="occupancy" label="Occupancy" value={`${model.occupancyPct}%`} raw={model.occupancyPct} hint={model.units ? `${model.units - model.occupied} available` : 'no units yet'} tone={model.occupancyPct >= 85 ? 'success' : model.occupancyPct >= 60 ? 'info' : 'warning'} />
              <Kpi id="approvals" label="Open approvals" value={canApprove ? model.approvals.length : '—'} raw={model.approvals.length} hint={canApprove ? (approvals.isLoading ? 'loading…' : model.approvals.length ? 'waiting on you' : 'queue clear') : 'needs lease:approve'} tone={model.approvals.length ? 'warning' : 'success'} />
              {canFinance ? (
                <>
                  <Kpi id="collected" label="Rent collected this month" value={model.finance ? cents(model.finance.collectedThisMonthCents) : '—'} raw={model.finance?.collectedThisMonthCents} hint={payments.isLoading || invoices.isLoading ? 'loading…' : 'succeeded payments'} tone="success" />
                  <Kpi id="overdue" label="Overdue balance" value={model.finance ? cents(model.finance.overdueCents) : '—'} raw={model.finance?.overdueCents} hint={model.finance ? `${model.finance.overdueInvoices} overdue invoice${model.finance.overdueInvoices === 1 ? '' : 's'}` : undefined} tone={model.finance?.overdueInvoices ? 'danger' : 'success'} />
                </>
              ) : (
                <Card className="sm:col-span-2"><p className="text-sm text-muted">Income and overdue figures need the finance permission on your account.</p></Card>
              )}
              <Kpi id="maintenance" label="Maintenance spend (90 days)" value={cents(model.maintenanceSpend90dCents)} raw={model.maintenanceSpend90dCents} hint={workOrders.isLoading ? 'loading…' : `${model.openWorkOrders} open work order${model.openWorkOrders === 1 ? '' : 's'}`} tone="info" />
            </section>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <PropertyList properties={model.properties} />
                <MapPlaceholder properties={model.properties} />
              </div>
              <div className="space-y-6">
                {canApprove && <ApprovalsInbox leases={model.approvals} query={approvals} />}
                {canFinance && <FinanceSummary model={model} loading={invoices.isLoading || payments.isLoading} error={invoices.error ?? payments.error} onRetry={() => { void invoices.refetch(); void payments.refetch(); }} />}
                {canDocuments && (
                  <Card title="Documents">
                    <p className="text-sm text-ink">Insurance certificates, signed leases and notices for your properties live in one place. Confidential files need an approved purpose.</p>
                    <div className="mt-4"><LinkButton href="/owner/documents" variant="secondary">Open documents</LinkButton></div>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </StateView>
    </div>
  );
}

function Kpi({ id, label, value, raw, hint, tone = 'neutral' }: { id: string; label: string; value: ReactNode; raw?: number; hint?: string; tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }) {
  const tones = { neutral: 'bg-navy-50 text-navy-700', info: 'bg-cobalt-100 text-cobalt-700', success: 'bg-success-100 text-success-700', warning: 'bg-orange-100 text-orange-900', danger: 'bg-danger-100 text-danger-600' };
  return (
    <div className="rounded-[14px] border border-line bg-surface p-5 shadow-sm" data-testid={`kpi-${id}`} data-value={raw ?? (typeof value === 'number' ? value : undefined)}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-navy-900">{value}</p>
      {hint && <p className="mt-2"><span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone])}>{hint}</span></p>}
    </div>
  );
}

function LinkButton({ href, children, variant = 'primary', className }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary'; className?: string }) {
  const styles = { primary: 'bg-cobalt-500 text-white hover:bg-cobalt-600', secondary: 'bg-surface text-navy-900 border border-line hover:bg-navy-50' };
  return <Link href={href} className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition', styles[variant], className)}>{children}</Link>;
}

function PropertyList({ properties }: { properties: PropertyDto[] }) {
  return (
    <Card title="Properties" actions={<Link href="/owner/properties" className="inline-flex min-h-11 items-center text-sm font-semibold text-cobalt-700 hover:underline">All properties</Link>}>
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Owned properties" data-testid="portfolio-properties">
        {properties.map((p) => {
          const total = p.unitCounts?.total ?? 0;
          const rented = p.unitCounts ? p.unitCounts.occupied + p.unitCounts.notice : 0;
          const pct = total ? Math.round((rented / total) * 100) : 0;
          return (
            <li key={p.id} className="rounded-[14px] border border-line p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/owner/properties/${p.id}`} className="block min-h-11 font-semibold leading-[44px] text-navy-900 hover:text-cobalt-700 hover:underline">{p.name}</Link>
                  <p className="text-xs text-muted">{p.addressLine1}, {p.city}, {p.state} {p.postalCode}</p>
                </div>
                <Badge tone={statusTone(p.status)}>{humanize(p.status)}</Badge>
              </div>
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-xs text-muted"><span>Occupancy</span><span className="font-semibold text-navy-900">{rented}/{total} · {pct}%</span></div>
                <Progress value={rented} max={total} label={`Occupancy of ${p.name}`} valueText={`${rented} of ${total} units rented`} tone={occupancyTone(pct)} />
              </div>
              {p.unitCounts && (
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-muted">Vacant</dt><dd className="font-semibold text-navy-900">{p.unitCounts.vacant}</dd></div>
                  <div><dt className="text-muted">On notice</dt><dd className="font-semibold text-navy-900">{p.unitCounts.notice}</dd></div>
                  <div><dt className="text-muted">Make-ready / down</dt><dd className="font-semibold text-navy-900">{p.unitCounts.make_ready + p.unitCounts.down}</dd></div>
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Map tiles ship with the reporting phase; until then the card explains what will appear here instead of loading a map library. */
function MapPlaceholder({ properties }: { properties: PropertyDto[] }) {
  const cities = [...new Set(properties.map((p) => `${p.city}, ${p.state}`))];
  return (
    <Card title="Map" as="section">
      <div data-testid="map-placeholder" className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-line bg-[linear-gradient(90deg,rgba(219,226,238,.6)_1px,transparent_1px),linear-gradient(rgba(219,226,238,.6)_1px,transparent_1px)] bg-[size:24px_24px] p-6 text-center">
        <p className="font-semibold text-navy-900">Map view arrives with the reporting phase</p>
        <p className="mt-1 max-w-md text-sm text-muted">Your {properties.length} propert{properties.length === 1 ? 'y' : 'ies'} span {cities.length} location{cities.length === 1 ? '' : 's'}: {cities.join(' · ')}. Pins with occupancy and open work orders will appear here once map tiles are approved for the platform.</p>
      </div>
    </Card>
  );
}

function ApprovalsInbox({ leases, query }: { leases: LeaseDto[]; query: { isLoading: boolean; error: unknown; refetch: () => unknown } }) {
  return (
    <Card title="Approvals inbox" actions={<Badge tone={leases.length ? 'warning' : 'success'}>{leases.length}</Badge>}>
      <div data-testid="approvals-inbox">
        {query.isLoading ? <div role="status" aria-busy="true" className="h-24 animate-pulse rounded-lg bg-navy-100"><span className="sr-only">Loading approvals</span></div>
          : query.error ? <><Alert tone="danger" title="Approvals could not be loaded">{query.error instanceof ApiError ? query.error.message : ''}</Alert><Button variant="secondary" className="mt-3" onClick={() => void query.refetch()}>Try again</Button></>
          : leases.length === 0 ? <EmptyState title="Nothing awaiting approval" description="Leases your manager submits for review appear here." />
          : (
            <ul className="divide-y divide-line">
              {leases.slice(0, 5).map((l) => (
                <li key={l.id} className="py-3">
                  <p className="font-medium text-navy-900">{l.property.name} · Unit {l.unit.unitNumber}</p>
                  <p className="text-sm text-ink">{l.parties.length ? l.parties.map((p) => p.displayName).join(', ') : 'No parties yet'}</p>
                  <p className="mt-1 text-xs text-muted">{day(l.startDate)} – {day(l.endDate)} · {cents(l.rentCents)}/mo · <Badge tone={statusTone(l.status)}>{l.status}</Badge></p>
                </li>
              ))}
            </ul>
          )}
      </div>
      <div className="mt-4"><LinkButton href="/owner/approvals">{leases.length ? 'Review and approve' : 'Open approvals queue'}</LinkButton></div>
      <p className="mt-2 text-xs text-muted">Approving is a human gate; you cannot approve a lease you drafted.</p>
    </Card>
  );
}

function FinanceSummary({ model, loading, error, onRetry }: { model: OwnerPortfolioModel; loading: boolean; error: unknown; onRetry: () => void }) {
  const f = model.finance;
  return (
    <Card title="Finance summary">
      <div data-testid="finance-summary">
        {error ? <><Alert tone="danger" title="Finance figures could not be loaded">{error instanceof ApiError ? error.message : ''}</Alert><Button variant="secondary" className="mt-3" onClick={onRetry}>Try again</Button></>
          : loading && !f ? <div role="status" aria-busy="true" className="h-24 animate-pulse rounded-lg bg-navy-100"><span className="sr-only">Loading finance summary</span></div>
          : f ? (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-muted">Collected this month</dt><dd className="mt-0.5 text-lg font-semibold text-success-700">{cents(f.collectedThisMonthCents)}</dd></div>
              <div><dt className="text-muted">Open receivables</dt><dd className="mt-0.5 text-lg font-semibold text-navy-900">{cents(f.openArCents)}</dd><dd className="text-xs text-muted">{f.openInvoices} open invoice{f.openInvoices === 1 ? '' : 's'}</dd></div>
              <div><dt className="text-muted">Overdue</dt><dd className={cn('mt-0.5 text-lg font-semibold', f.overdueCents ? 'text-danger-600' : 'text-navy-900')}>{cents(f.overdueCents)}</dd></div>
              <div><dt className="text-muted">Source</dt><dd className="mt-0.5 text-xs text-ink">{f.source === 'summary' ? 'Ledger summary' : 'Issued invoices and payments for your properties'}</dd></div>
            </dl>
          ) : null}
      </div>
      <p className="mt-3 text-xs text-muted">Statements and the full ledger are prepared by your bookkeeper.</p>
    </Card>
  );
}
