'use client';
import { useState } from 'react';
import { Badge, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import {
  fmtCents, fmtDate, fmtPct, useArAging, useArAgingTotals, useComplianceHits, useComplianceHitsTotals, useMaintenanceSla, useMaintenanceSlaTotals, useOccupancy, useOccupancyTotals, useRentRoll, useRentRollTotals,
  type ArAgingReportDto, type ComplianceHitsReportDto, type MaintenanceSlaReportDto, type OccupancyReportDto, type RentRollReportDto, type ReportFilterParams,
} from '@/lib/hooks/reporting';
import { LoadMore, PropertyFilter, flatItems } from './shared';

type Row<T extends { items: unknown[] }> = T['items'][number];
const BUCKET_LABEL: Record<string, string> = { current: 'Current', '1_30': '1-30 days', '31_60': '31-60 days', '61_90': '61-90 days', '90_plus': '90+ days' };

function Totals({ children }: { children: React.ReactNode }) {
  return <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="report-totals">{children}</dl>;
}
function Tot({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex gap-1"><dt className="text-muted">{label}</dt><dd className="font-semibold text-navy-900">{value}</dd></div>;
}

/** Rent roll: active leases with rent, unit and tenant. */
export function RentRollTable({ showPropertyFilter = true }: { showPropertyFilter?: boolean }) {
  const [propertyId, setPropertyId] = useState('');
  const f: ReportFilterParams = { propertyId: propertyId || undefined };
  const list = useRentRoll(f);
  const totals = useRentRollTotals(f);
  return (
    <div>
      {showPropertyFilter && <div className="mb-4 max-w-xs"><PropertyFilter value={propertyId} onChange={setPropertyId} /></div>}
      <StateView isLoading={list.isLoading} error={list.error} data={list.data} isEmpty={(d) => flatItems(d).length === 0} empty={{ title: 'No active leases', description: 'The rent roll lists leases in status active. Refresh the data if leases were activated recently.' }} onRetry={() => void list.refetch()}>
        {(d) => (
          <>
            {totals.data && <Totals><Tot label="Active leases" value={totals.data.totals.leases} /><Tot label="Monthly rent" value={fmtCents(totals.data.totals.rentCents)} /></Totals>}
            <Table<Row<RentRollReportDto>> caption="Rent roll" rows={flatItems(d)} columns={[
              { key: 'property', header: 'Property / unit', render: (r) => <div><p className="font-medium">{r.propertyName}</p><p className="text-xs text-muted">Unit {r.unitNumber}</p></div> },
              { key: 'tenant', header: 'Tenant', render: (r) => r.tenantName ?? '—' },
              { key: 'term', header: 'Term', render: (r) => `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` },
              { key: 'rent', header: 'Rent', className: 'text-right', render: (r) => fmtCents(r.rentCents) },
              { key: 'target', header: 'Target', className: 'text-right', render: (r) => fmtCents(r.targetRentCents) },
              { key: 'deposit', header: 'Deposit', className: 'text-right', render: (r) => fmtCents(r.depositCents) },
            ]} />
            <LoadMore list={list} />
          </>
        )}
      </StateView>
    </div>
  );
}

/** AR aging: outstanding invoices by days past due (staff only). */
export function ArAgingTable() {
  const [propertyId, setPropertyId] = useState('');
  const [bucket, setBucket] = useState('');
  const f: ReportFilterParams = { propertyId: propertyId || undefined, bucket: bucket || undefined };
  const list = useArAging(f);
  const totals = useArAgingTotals(f);
  return (
    <div>
      <div className="mb-4 grid max-w-xl gap-3 sm:grid-cols-2">
        <PropertyFilter value={propertyId} onChange={setPropertyId} />
        <Select label="Bucket" value={bucket} onChange={(e) => setBucket(e.target.value)}><option value="">All buckets</option>{Object.entries(BUCKET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </div>
      <StateView isLoading={list.isLoading} error={list.error} data={list.data} isEmpty={(d) => flatItems(d).length === 0} empty={{ title: 'Nothing outstanding', description: 'All issued invoices are paid.' }} onRetry={() => void list.refetch()}>
        {(d) => (
          <>
            {totals.data && (
              <Totals>
                <Tot label="Total" value={fmtCents(totals.data.totals.totalCents)} /><Tot label="Current" value={fmtCents(totals.data.totals.currentCents)} /><Tot label="1-30" value={fmtCents(totals.data.totals.d1to30Cents)} />
                <Tot label="31-60" value={fmtCents(totals.data.totals.d31to60Cents)} /><Tot label="61-90" value={fmtCents(totals.data.totals.d61to90Cents)} /><Tot label="90+" value={fmtCents(totals.data.totals.d90PlusCents)} />
              </Totals>
            )}
            <Table<Row<ArAgingReportDto>> caption="Receivables aging" rows={flatItems(d)} columns={[
              { key: 'number', header: 'Invoice', render: (r) => <span className="font-medium">{r.number}</span> },
              { key: 'tenant', header: 'Tenant / unit', render: (r) => <div><p>{r.tenantName ?? '—'}</p><p className="text-xs text-muted">{r.propertyName} · {r.unitNumber}</p></div> },
              { key: 'due', header: 'Due', render: (r) => fmtDate(r.dueDate) },
              { key: 'bucket', header: 'Bucket', render: (r) => <Badge tone={r.bucket === 'current' ? 'info' : r.bucket === '1_30' ? 'warning' : 'danger'}>{BUCKET_LABEL[r.bucket] ?? r.bucket}</Badge> },
              { key: 'balance', header: 'Balance', className: 'text-right font-semibold', render: (r) => fmtCents(r.balanceCents) },
              { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status) === 'warning' ? 'danger' : statusTone(r.status)}>{r.status.replace('_', ' ')}</Badge> },
            ]} />
            <LoadMore list={list} />
          </>
        )}
      </StateView>
    </div>
  );
}

/** Occupancy by property. */
export function OccupancyTable() {
  const list = useOccupancy();
  const totals = useOccupancyTotals();
  return (
    <StateView isLoading={list.isLoading} error={list.error} data={list.data} isEmpty={(d) => flatItems(d).length === 0} empty={{ title: 'No properties yet', description: 'Occupancy appears once properties and units exist.' }} onRetry={() => void list.refetch()}>
      {(d) => (
        <>
          {totals.data && <Totals><Tot label="Properties" value={totals.data.totals.properties} /><Tot label="Units" value={totals.data.totals.totalUnits} /><Tot label="Occupied" value={totals.data.totals.occupiedUnits} /><Tot label="Occupancy" value={fmtPct(totals.data.totals.occupancyPct)} /><Tot label="Scheduled rent" value={fmtCents(totals.data.totals.scheduledRentCents)} /></Totals>}
          <Table<Row<OccupancyReportDto>> caption="Occupancy by property" rows={flatItems(d)} columns={[
            { key: 'property', header: 'Property', render: (r) => <div><p className="font-medium">{r.propertyName}</p><p className="text-xs text-muted">{r.city}, {r.state} · {r.propertyStatus}</p></div> },
            { key: 'units', header: 'Units', className: 'text-right', render: (r) => r.totalUnits },
            { key: 'occupied', header: 'Occupied', className: 'text-right', render: (r) => r.occupiedUnits },
            { key: 'vacant', header: 'Vacant', className: 'text-right', render: (r) => r.vacantUnits },
            { key: 'notice', header: 'Notice', className: 'text-right', render: (r) => r.noticeUnits },
            { key: 'pct', header: 'Occupancy', className: 'text-right', render: (r) => <Badge tone={r.occupancyPct >= 90 ? 'success' : r.occupancyPct >= 50 ? 'info' : 'warning'}>{fmtPct(r.occupancyPct)}</Badge> },
            { key: 'rent', header: 'Scheduled rent', className: 'text-right', render: (r) => fmtCents(r.scheduledRentCents) },
          ]} />
          <LoadMore list={list} />
        </>
      )}
    </StateView>
  );
}

/** Maintenance SLA by property and priority. */
export function MaintenanceSlaTable() {
  const [propertyId, setPropertyId] = useState('');
  const [priority, setPriority] = useState('');
  const f: ReportFilterParams = { propertyId: propertyId || undefined, priority: priority || undefined };
  const list = useMaintenanceSla(f);
  const totals = useMaintenanceSlaTotals(f);
  return (
    <div>
      <div className="mb-4 grid max-w-xl gap-3 sm:grid-cols-2">
        <PropertyFilter value={propertyId} onChange={setPropertyId} />
        <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">All priorities</option>{['emergency', 'high', 'normal', 'low'].map((p) => <option key={p} value={p}>{p}</option>)}</Select>
      </div>
      <StateView isLoading={list.isLoading} error={list.error} data={list.data} isEmpty={(d) => flatItems(d).length === 0} empty={{ title: 'No work orders', description: 'SLA compliance appears once work orders exist for the selected filters.' }} onRetry={() => void list.refetch()}>
        {(d) => (
          <>
            {totals.data && <Totals><Tot label="Completed" value={totals.data.totals.completedOrders} /><Tot label="Within SLA" value={totals.data.totals.completedWithinSla} /><Tot label="Compliance" value={fmtPct(totals.data.totals.slaCompliancePct)} /><Tot label="Open" value={totals.data.totals.openOrders} /><Tot label="Breached open" value={totals.data.totals.breachedOpen} /></Totals>}
            <Table<Row<MaintenanceSlaReportDto>> caption="Maintenance SLA by property and priority" rows={flatItems(d)} columns={[
              { key: 'property', header: 'Property', render: (r) => <span className="font-medium">{r.propertyName}</span> },
              { key: 'priority', header: 'Priority', render: (r) => <Badge tone={statusTone(r.priority)}>{r.priority}</Badge> },
              { key: 'open', header: 'Open', className: 'text-right', render: (r) => r.openOrders },
              { key: 'completed', header: 'Completed', className: 'text-right', render: (r) => r.completedOrders },
              { key: 'within', header: 'On time', className: 'text-right', render: (r) => r.completedWithinSla },
              { key: 'late', header: 'Late', className: 'text-right', render: (r) => r.completedLate },
              { key: 'breached', header: 'Breached open', className: 'text-right', render: (r) => <span className={r.breachedOpen ? 'font-semibold text-danger-600' : ''}>{r.breachedOpen}</span> },
              { key: 'pct', header: 'Compliance', className: 'text-right', render: (r) => r.completedOrders ? fmtPct(r.slaCompliancePct) : '—' },
              { key: 'hours', header: 'Avg hours', className: 'text-right', render: (r) => r.avgHoursToComplete ?? '—' },
            ]} />
            <LoadMore list={list} />
          </>
        )}
      </StateView>
    </div>
  );
}

/** Compliance hits by severity, result, resolution and domain (staff only). */
export function ComplianceHitsTable() {
  const [severity, setSeverity] = useState('');
  const f: ReportFilterParams = { severity: severity || undefined };
  const list = useComplianceHits(f);
  const totals = useComplianceHitsTotals(f);
  return (
    <div>
      <div className="mb-4 max-w-xs"><Select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="">All severities</option>{['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
      <StateView isLoading={list.isLoading} error={list.error} data={list.data} isEmpty={(d) => flatItems(d).length === 0} empty={{ title: 'No compliance hits', description: 'Rule evaluations that warn, block or require review appear here.' }} onRetry={() => void list.refetch()}>
        {(d) => (
          <>
            {totals.data && <Totals><Tot label="Hits" value={totals.data.totals.hits} /><Tot label="Open" value={totals.data.totals.open} />{Object.entries(totals.data.totals.bySeverity).map(([s, n]) => <Tot key={s} label={s} value={n} />)}</Totals>}
            <Table<Row<ComplianceHitsReportDto>> caption="Compliance hits" rows={flatItems(d)} columns={[
              { key: 'severity', header: 'Severity', render: (r) => <Badge tone={statusTone(r.severity)}>{r.severity}</Badge> },
              { key: 'result', header: 'Result', render: (r) => <Badge tone={statusTone(r.result) === 'warning' ? 'danger' : statusTone(r.result)}>{r.result}</Badge> },
              { key: 'resolution', header: 'Resolution', render: (r) => r.resolution },
              { key: 'domain', header: 'Domain', render: (r) => r.domain },
              { key: 'hits', header: 'Hits', className: 'text-right font-semibold', render: (r) => r.hits },
              { key: 'last', header: 'Last hit', render: (r) => fmtDate(r.lastHitAt) },
            ]} />
            <LoadMore list={list} />
          </>
        )}
      </StateView>
    </div>
  );
}
