'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ArAgingReportDto, CollectionsReportDto, ComplianceHitsReportDto, CreateReportDefinitionDto, MaintenanceSlaReportDto, OccupancyReportDto, RentRollReportDto, ReportDefinitionDto, ReportKpisDto, ReportRunDetailDto, ReportRunDto,
} from '@bolar/contracts';
import { api } from '../api-client';
import { usePagedList } from './iam';

export type { ArAgingReportDto, CollectionsReportDto, ComplianceHitsReportDto, MaintenanceSlaReportDto, OccupancyReportDto, RentRollReportDto, ReportDefinitionDto, ReportKpisDto, ReportRunDetailDto, ReportRunDto };
export { fmtCents, fmtDate } from './finance';

/** Filters shared by every report screen; undefined values are dropped from the query string. */
export interface ReportFilterParams { propertyId?: string; from?: string; to?: string; months?: number; priority?: string; bucket?: string; severity?: string }

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
}
const toParams = (f: ReportFilterParams): Record<string, string | number | undefined> => ({ ...f });

export const REPORT_KIND_LABELS: Record<string, string> = {
  rent_roll: 'Rent roll', ar_aging: 'AR aging', occupancy: 'Occupancy', maintenance_sla: 'Maintenance SLA', collections: 'Collections', compliance_hits: 'Compliance hits',
};
export const fmtPct = (v: number) => `${v.toFixed(v % 1 === 0 ? 0 : 1)}%`;
export const fmtMonth = (iso: string) => new Date(`${iso.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// ───────── KPIs and freshness ─────────
export const useReportKpis = (enabled = true) => useQuery({ queryKey: ['reports', 'kpis'], queryFn: () => api<ReportKpisDto>('/reports/kpis'), enabled });
export function useRefreshReports() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<{ refreshedAt: string; durationMs: number }>('/reports/refresh', { method: 'POST' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['reports'] }) });
}

// ───────── report tables (cursor-paginated) ─────────
export const useRentRoll = (f: ReportFilterParams = {}, enabled = true) => usePagedList<RentRollReportDto['items'][number]>(['reports', 'rent-roll'], '/reports/rent-roll', toParams(f), enabled);
export const useArAging = (f: ReportFilterParams = {}, enabled = true) => usePagedList<ArAgingReportDto['items'][number]>(['reports', 'ar-aging'], '/reports/ar-aging', toParams(f), enabled);
export const useOccupancy = (f: ReportFilterParams = {}, enabled = true) => usePagedList<OccupancyReportDto['items'][number]>(['reports', 'occupancy'], '/reports/occupancy', toParams(f), enabled);
export const useMaintenanceSla = (f: ReportFilterParams = {}, enabled = true) => usePagedList<MaintenanceSlaReportDto['items'][number]>(['reports', 'maintenance-sla'], '/reports/maintenance-sla', toParams(f), enabled);
export const useComplianceHits = (f: ReportFilterParams = {}, enabled = true) => usePagedList<ComplianceHitsReportDto['items'][number]>(['reports', 'compliance-hits'], '/reports/compliance-hits', toParams(f), enabled);

/** Totals travel with the first page of every report; expose them next to the infinite list. */
export const useRentRollTotals = (f: ReportFilterParams = {}, enabled = true) => useQuery({ queryKey: ['reports', 'rent-roll', 'totals', f], queryFn: () => api<RentRollReportDto>(`/reports/rent-roll${qs({ ...toParams(f), limit: 1 })}`), enabled });
export const useArAgingTotals = (f: ReportFilterParams = {}, enabled = true) => useQuery({ queryKey: ['reports', 'ar-aging', 'totals', f], queryFn: () => api<ArAgingReportDto>(`/reports/ar-aging${qs({ ...toParams(f), limit: 1 })}`), enabled });
export const useOccupancyTotals = (f: ReportFilterParams = {}, enabled = true) => useQuery({ queryKey: ['reports', 'occupancy', 'totals', f], queryFn: () => api<OccupancyReportDto>(`/reports/occupancy${qs({ ...toParams(f), limit: 1 })}`), enabled });
export const useMaintenanceSlaTotals = (f: ReportFilterParams = {}, enabled = true) => useQuery({ queryKey: ['reports', 'maintenance-sla', 'totals', f], queryFn: () => api<MaintenanceSlaReportDto>(`/reports/maintenance-sla${qs({ ...toParams(f), limit: 1 })}`), enabled });
export const useComplianceHitsTotals = (f: ReportFilterParams = {}, enabled = true) => useQuery({ queryKey: ['reports', 'compliance-hits', 'totals', f], queryFn: () => api<ComplianceHitsReportDto>(`/reports/compliance-hits${qs({ ...toParams(f), limit: 1 })}`), enabled });
/** Collections: the chart needs the month series, which comes with the page. */
export const useCollections = (f: ReportFilterParams = { months: 12 }, enabled = true) => useQuery({ queryKey: ['reports', 'collections', f], queryFn: () => api<CollectionsReportDto>(`/reports/collections${qs({ ...toParams(f), limit: 100 })}`), enabled });

// ───────── scheduled reports ─────────
export const useReportDefinitions = (params: { kind?: string; status?: string } = {}, enabled = true) => usePagedList<ReportDefinitionDto>(['reports', 'definitions'], '/reports/definitions', params, enabled);
export const useReportRuns = (params: { definitionId?: string; status?: string } = {}, enabled = true) => usePagedList<ReportRunDto>(['reports', 'runs'], '/reports/runs', params, enabled);
export const useReportRun = (id: string | null) => useQuery({ queryKey: ['reports', 'run', id], queryFn: () => api<ReportRunDetailDto>(`/reports/runs/${id}`), enabled: !!id });

function useReportMutation<TVars, TOut>(fn: (vars: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ['reports'] }) });
}
export const useCreateReportDefinition = () => useReportMutation((body: CreateReportDefinitionDto) => api<ReportDefinitionDto>('/reports/definitions', { method: 'POST', body }));
export const useRunReportDefinition = () => useReportMutation((id: string) => api<ReportRunDto>(`/reports/definitions/${id}/run`, { method: 'POST' }));
