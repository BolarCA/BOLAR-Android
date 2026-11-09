'use client';
import { useCan } from '@/lib/auth';
import { useReportKpis } from '@/lib/hooks/reporting';
import { Card, PageHeader } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { FreshnessBadge, KpiStrip } from './shared';
import { OccupancyTable, RentRollTable } from './tables';
import { CollectionsChart } from './collections-chart';

/** Landlord reports: occupancy, rent roll and collections for the properties the owner holds (API narrows by owner_of). */
export function OwnerReportsScreen() {
  const canRead = useCan('finance:read');
  const kpis = useReportKpis(canRead);
  return (
    <>
      <PageHeader title="Portfolio reports" description="Occupancy, rent roll and collections for your properties. Figures come from the same governed views the bookkeeper sees, limited to what you own."
        actions={<FreshnessBadge refreshedAt={kpis.data?.refreshedAt} staleSeconds={kpis.data?.staleSeconds} canRefresh={false} />} />
      <StateView isLoading={kpis.isLoading} error={kpis.error} data={kpis.data} skeleton="cards" onRetry={() => void kpis.refetch()}>
        {(k) => <KpiStrip k={k} variant="owner" />}
      </StateView>
      <div className="mt-6 grid gap-6">
        <Card title="Occupancy by property"><OccupancyTable /></Card>
        <Card title="Rent roll"><RentRollTable /></Card>
        <Card title="Collections"><CollectionsChart /></Card>
      </div>
    </>
  );
}
