'use client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BuildingDto, PortfolioDto, PropertyDetailDto, PropertyDto, PropertyHierarchyDto, UnitDto, UnitStatusHistoryDto, UnitCountsDto } from '@bolar/contracts';
import { api } from '../api-client';

export type { BuildingDto, PortfolioDto, PropertyDetailDto, PropertyDto, PropertyHierarchyDto, UnitDto, UnitStatusHistoryDto, UnitCountsDto };
export interface Page<T> { items: T[]; nextCursor: string | null }

export type PropertyFilters = { status?: string; city?: string; state?: string; portfolioId?: string; subaccountId?: string; q?: string; includeArchived?: string };
export type UnitFilters = { status?: string; buildingId?: string; q?: string };
export interface CreatePropertyInput { name: string; addressLine1: string; addressLine2?: string; city: string; state: string; postalCode: string; county?: string; propertyType?: string; status?: string; portfolioId?: string; subaccountId?: string; ownerUserId?: string }
export interface CreateUnitInput { unitNumber: string; buildingId?: string; bedrooms?: number; bathrooms?: number; squareFeet?: number; targetRentCents?: number; status?: string }

function qs(params: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

function usePaged<T>(key: unknown[], path: string, params: Record<string, string | number | undefined> = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...key, params],
    queryFn: ({ pageParam }) => api<Page<T>>(`${path}${qs({ ...params, cursor: pageParam as string | undefined, limit: 25 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export const propertyKeys = {
  portfolios: ['portfolios'] as const,
  properties: ['properties'] as const,
  property: (id: string) => ['property', id] as const,
  hierarchy: (id: string) => ['property', id, 'hierarchy'] as const,
  buildings: (id: string) => ['property', id, 'buildings'] as const,
  units: (id: string) => ['property', id, 'units'] as const,
  unit: (id: string) => ['unit', id] as const,
  unitHistory: (id: string) => ['unit', id, 'history'] as const,
};

export const usePortfolios = (params: { q?: string } = {}) => usePaged<PortfolioDto>([...propertyKeys.portfolios], '/portfolios', params);
export const useProperties = (params: PropertyFilters = {}) => usePaged<PropertyDto>([...propertyKeys.properties], '/properties', params);
export const useProperty = (id: string) => useQuery({ queryKey: propertyKeys.property(id), queryFn: () => api<PropertyDetailDto>(`/properties/${id}`), enabled: Boolean(id) });
export const usePropertyHierarchy = (id: string, enabled = true) => useQuery({ queryKey: propertyKeys.hierarchy(id), queryFn: () => api<PropertyHierarchyDto>(`/properties/${id}/hierarchy`), enabled: Boolean(id) && enabled });
export const useBuildings = (propertyId: string) => usePaged<BuildingDto>([...propertyKeys.buildings(propertyId)], `/properties/${propertyId}/buildings`, {}, Boolean(propertyId));
export const useUnits = (propertyId: string, params: UnitFilters = {}) => usePaged<UnitDto>([...propertyKeys.units(propertyId)], `/properties/${propertyId}/units`, params, Boolean(propertyId));
export const useUnit = (id: string) => useQuery({ queryKey: propertyKeys.unit(id), queryFn: () => api<UnitDto>(`/units/${id}`), enabled: Boolean(id) });
export const useUnitHistory = (id: string, enabled = true) => usePaged<UnitStatusHistoryDto>([...propertyKeys.unitHistory(id)], `/units/${id}/history`, {}, Boolean(id) && enabled);

function invalidateProperty(qc: ReturnType<typeof useQueryClient>, propertyId: string) {
  void qc.invalidateQueries({ queryKey: propertyKeys.properties });
  void qc.invalidateQueries({ queryKey: propertyKeys.property(propertyId) });
}

export function useCreatePortfolio() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: { name: string; ownerUserId?: string }) => api<PortfolioDto>('/portfolios', { method: 'POST', body: input }), onSuccess: () => void qc.invalidateQueries({ queryKey: propertyKeys.portfolios }) });
}
export function useCreateProperty() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreatePropertyInput) => api<PropertyDto>('/properties', { method: 'POST', body: input }), onSuccess: () => { void qc.invalidateQueries({ queryKey: propertyKeys.properties }); void qc.invalidateQueries({ queryKey: propertyKeys.portfolios }); } });
}
export function useUpdateProperty(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: Partial<CreatePropertyInput> & { addressLine2?: string | null; county?: string | null; portfolioId?: string | null; subaccountId?: string | null; ownerUserId?: string | null }) => api<PropertyDetailDto>(`/properties/${propertyId}`, { method: 'PATCH', body }), onSuccess: () => invalidateProperty(qc, propertyId) });
}
export function useArchiveProperty(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<PropertyDetailDto>(`/properties/${propertyId}/archive`, { method: 'POST' }), onSuccess: () => invalidateProperty(qc, propertyId) });
}
export function useCreateBuilding(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: { name?: string; floors?: number }) => api<BuildingDto>(`/properties/${propertyId}/buildings`, { method: 'POST', body: input }), onSuccess: () => { invalidateProperty(qc, propertyId); void qc.invalidateQueries({ queryKey: propertyKeys.buildings(propertyId) }); } });
}
export function useCreateUnit(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateUnitInput) => api<UnitDto>(`/properties/${propertyId}/units`, { method: 'POST', body: input }), onSuccess: () => { invalidateProperty(qc, propertyId); void qc.invalidateQueries({ queryKey: propertyKeys.units(propertyId) }); } });
}
export function useUpdateUnit(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...body }: { id: string } & Partial<CreateUnitInput> & { buildingId?: string | null }) => api<UnitDto>(`/units/${id}`, { method: 'PATCH', body }), onSuccess: (u) => { void qc.invalidateQueries({ queryKey: propertyKeys.units(propertyId) }); void qc.invalidateQueries({ queryKey: propertyKeys.unit(u.id) }); } });
}
export function useChangeUnitStatus(propertyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, toStatus, reason }: { id: string; toStatus: string; reason: string }) => api<UnitDto>(`/units/${id}/status`, { method: 'POST', body: { toStatus, reason } }),
    onSuccess: (u) => { invalidateProperty(qc, propertyId); void qc.invalidateQueries({ queryKey: propertyKeys.units(propertyId) }); void qc.invalidateQueries({ queryKey: propertyKeys.unit(u.id) }); void qc.invalidateQueries({ queryKey: propertyKeys.unitHistory(u.id) }); void qc.invalidateQueries({ queryKey: propertyKeys.hierarchy(propertyId) }); },
  });
}

export const formatCents = (cents: number) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const humanize = (s: string) => s.replace(/_/g, ' ');
