'use client';
import Link from 'next/link';
import { useCan } from '@/lib/auth';
import { useReportKpis } from '@/lib/hooks/reporting';
import { Card, PageHeader } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { FreshnessBadge, KpiStrip, Tabs } from './shared';
import { ArAgingTable, ComplianceHitsTable, RentRollTable } from './tables';
import { CollectionsChart } from './collections-chart';
import { ScheduledReports } from './scheduled-reports';

/** Bookkeeper reports (blueprint Days 75-90): KPI strip, governed report tables, collections chart, scheduled exports. */
export function FinanceReportsScreen() {
  const canRead = useCan('finance:read');
  const kpis = useReportKpis(canRead);
  return (
    <>
      <PageHeader title="Reports" description="Every number here comes from governed materialized views that reconcile to the ledger and source tables (see docs/metrics-definitions.md). Refresh pulls the latest operational data."
        actions={<FreshnessBadge refreshedAt={kpis.data?.refreshedAt} staleSeconds={kpis.data?.staleSeconds} canRefresh={canRead} />} />
      <StateView isLoading={kpis.isLoading} error={kpis.error} data={kpis.data} skeleton="cards" onRetry={() => void kpis.refetch()}>
        {(k) => <KpiStrip k={k} variant="finance" />}
      </StateView>
      <div className="mt-6">
        <Card>
          <Tabs tabs={[
            { key: 'rent-roll', label: 'Rent roll', content: <RentRollTable /> },
            { key: 'ar-aging', label: 'AR aging', content: <ArAgingTable /> },
            { key: 'collections', label: 'Collections', content: <CollectionsChart /> },
            { key: 'compliance', label: 'Compliance hits', content: <ComplianceHitsTable /> },
          ]} />
        </Card>
      </div>
      <div className="mt-6">
        <ScheduledReports />
      </div>
      <p className="mt-6 text-xs text-muted">Receivables detail lives in <Link className="underline" href="/finance/invoices">Invoices</Link>; the double-entry proof is on the <Link className="underline" href="/finance">Ledger dashboard</Link>.</p>
    </>
  );
}
