'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdverseActionDto, ApplicationDetailDto, ApplicationDto, ScreeningOrderDto, ScreeningResultResponseDto } from '@bolar/contracts';
import { api } from '../api-client';
import { usePagedList } from './iam';

export type { ApplicationDto, ApplicationDetailDto, ScreeningOrderDto, AdverseActionDto, ScreeningResultResponseDto };
export interface LookupsDto { properties: { id: string; name: string; city: string; state: string }[]; applicants: { id: string; displayName: string; status: string }[] }

export const useApplications = (filters: { status?: string; propertyId?: string } = {}) => usePagedList<ApplicationDto>(['applications'], '/applications', filters);
export const useApplication = (id: string | null) => useQuery({ queryKey: ['application', id], queryFn: () => api<ApplicationDetailDto>(`/applications/${id}`), enabled: Boolean(id) });
export const useApplicationLookups = (enabled = true) => useQuery({ queryKey: ['application-lookups'], queryFn: () => api<LookupsDto>('/applications/lookups'), enabled });
export const useScreeningResult = (orderId: string | null) => useQuery({ queryKey: ['screening-result', orderId], queryFn: () => api<ScreeningResultResponseDto>(`/screening-orders/${orderId}/result`, { purpose: 'lease_administration' }), enabled: Boolean(orderId), retry: false });
export const useAdverseActions = (filters: { stage?: string } = {}) => usePagedList<AdverseActionDto>(['adverse-actions'], '/adverse-actions', filters);

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['applications'] });
  void qc.invalidateQueries({ queryKey: ['application'] });
  void qc.invalidateQueries({ queryKey: ['adverse-actions'] });
  void qc.invalidateQueries({ queryKey: ['rule-evaluations'] });
}

export function useCreateApplication() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: { propertyId: string; applicantId: string; unitId?: string }) => api<ApplicationDto>('/applications', { method: 'POST', body }), onSuccess: () => invalidateAll(qc) });
}
export function useApplicationAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'submit' | 'withdraw' | 'consent' | 'screening-orders'; body?: Record<string, unknown> }) => api<ApplicationDto | ScreeningOrderDto>(`/applications/${id}/${action}`, { method: 'POST', body: body ?? {} }),
    onSuccess: () => invalidateAll(qc),
  });
}
export function useRunScreening() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (orderId: string) => api<ScreeningOrderDto>(`/screening-orders/${orderId}/run`, { method: 'POST' }), onSuccess: () => invalidateAll(qc) });
}
export function useDecideApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; decision: string; reasonCodes: string[]; note?: string }) => api<{ application: ApplicationDto; adverseAction: AdverseActionDto | null }>(`/applications/${id}/decide`, { method: 'POST', body }),
    onSuccess: () => invalidateAll(qc),
  });
}
export function useAdverseAction() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, action }: { id: string; action: 'advance' | 'dispute' | 'withdraw' }) => api<AdverseActionDto>(`/adverse-actions/${id}/${action}`, { method: 'POST' }), onSuccess: () => invalidateAll(qc) });
}

export const REASON_CODES = ['insufficient_income', 'credit_history', 'eviction_record', 'criminal_record', 'incomplete_application', 'unverifiable_information', 'rental_history', 'other'] as const;
