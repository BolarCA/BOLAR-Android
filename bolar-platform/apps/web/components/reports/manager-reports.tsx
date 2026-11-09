'use client';
import { useCan } from '@/lib/auth';
import { useReportKpis } from '@/lib/hooks/reporting';
import { Card, PageHeader } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { FreshnessBadge, KpiStrip, Tabs } from './shared';
import { ComplianceHitsTable, MaintenanceSlaTable, OccupancyTable } from './tables';

/** Property manager reports: maintenance SLA by property/priority, occupancy and compliance hits. */
export function ManagerReportsScreen() {
  const canRead = useCan('finance:read');
  const kpis = useReportKpis(canRead);
  return (
    <>
      <PageHeader title="Operations reports" description="SLA compliance, occupancy and compliance hits from governed views; refresh after a busy day to pull the latest work-order and unit changes."
        actions={<FreshnessBadge refreshedAt={kpis.data?.refreshedAt} staleSeconds={kpis.data?.staleSeconds} canRefresh={canRead} />} />
      <StateView isLoading={kpis.isLoading} error={kpis.error} data={kpis.data} skeleton="cards" onRetry={() => void kpis.refetch()}>
        {(k) => <KpiStrip k={k} variant="manager" />}
      </StateView>
      <div className="mt-6">
        <Card>
          <Tabs tabs={[
            { key: 'sla', label: 'Maintenance SLA', content: <MaintenanceSlaTable /> },
            { key: 'occupancy', label: 'Occupancy', content: <OccupancyTable /> },
            { key: 'compliance', label: 'Compliance hits', content: <ComplianceHitsTable /> },
          ]} />
        </Card>
      </div>
    </>
  );
}
