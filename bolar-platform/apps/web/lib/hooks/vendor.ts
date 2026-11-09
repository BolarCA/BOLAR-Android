'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EligibleVendorDto, VendorContractDto, VendorProfileDto, WorkOrderDto } from '@bolar/contracts';
import { api } from '../api-client';
import { usePagedList, type Page } from './iam';

export type { VendorProfileDto, VendorContractDto, EligibleVendorDto };

export interface VendorFilters { status?: string; trade?: string; q?: string }

export const useVendors = (params: VendorFilters = {}, enabled = true) => usePagedList<VendorProfileDto>(['vendors'], '/vendors', { ...params }, enabled);
export const useVendor = (id: string | null | undefined) => useQuery({ queryKey: ['vendor', id], queryFn: () => api<VendorProfileDto>(`/vendors/${id}`), enabled: Boolean(id) });
export const useVendorContracts = (id: string | null | undefined) => useQuery({ queryKey: ['vendor-contracts', id], queryFn: () => api<Page<VendorContractDto>>(`/vendors/${id}/contracts?limit=100`), enabled: Boolean(id) });
export const useVendorWorkOrders = (id: string | null | undefined) => useQuery({ queryKey: ['vendor-work-orders', id], queryFn: () => api<Page<WorkOrderDto>>(`/vendors/${id}/work-orders?limit=100`), enabled: Boolean(id) });
export const useEligibleVendors = (workOrderId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: ['eligible-vendors', workOrderId], queryFn: () => api<{ workOrderId: string; category: string; items: EligibleVendorDto[] }>(`/vendors/eligible?workOrderId=${workOrderId}`), enabled: Boolean(workOrderId) && enabled });

export interface VendorInput { name: string; trades: string[]; email?: string; phone?: string; insuranceExpiresAt?: string; licenseNumber?: string; coverage?: { propertyIds: string[]; regions: string[] }; budgetLimitCents?: number; userId?: string }

export function useCreateVendor() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: VendorInput) => api<VendorProfileDto>('/vendors', { method: 'POST', body: input }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['vendors'] }) });
}
export function useUpdateVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<Record<keyof VendorInput, unknown>>) => api<VendorProfileDto>(`/vendors/${id}`, { method: 'PATCH', body }),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ['vendors'] }); void qc.invalidateQueries({ queryKey: ['vendor', v.id] }); void qc.invalidateQueries({ queryKey: ['eligible-vendors'] }); },
  });
}
export function useSetVendorStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'suspend' }) => api<VendorProfileDto>(`/vendors/${id}/${action}`, { method: 'POST' }),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ['vendors'] }); void qc.invalidateQueries({ queryKey: ['vendor', v.id] }); void qc.invalidateQueries({ queryKey: ['eligible-vendors'] }); },
  });
}
export function useAddVendorContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; kind: string; storageKey?: string; documentId?: string; startsAt?: string; endsAt?: string }) => api<VendorContractDto>(`/vendors/${id}/contracts`, { method: 'POST', body }),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ['vendor-contracts', v.id] }); void qc.invalidateQueries({ queryKey: ['vendor', v.id] }); },
  });
}
export function useInviteVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) => api<{ invitationId: string; email: string; status: string; expiresAt: string; acceptUrl?: string }>(`/vendors/${id}/invite`, { method: 'POST', body: { email } }),
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: ['vendor', v.id] }),
  });
}
