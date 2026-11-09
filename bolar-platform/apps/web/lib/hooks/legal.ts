'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { usePagedList } from './iam';

export interface CaseDeadlineDto { id: string; title: string; dueAt: string; done: boolean }
export interface CaseDto {
  id: string; title: string; kind: 'eviction' | 'dispute' | 'compliance' | 'agency' | 'other'; status: 'open' | 'active' | 'on_hold' | 'closed';
  leaseId: string | null; propertyId: string | null; tenantProfileId: string | null; leadLawyerId: string | null; privileged: boolean;
  deadlines: CaseDeadlineDto[]; createdBy: string; createdAt: string; updatedAt: string; activeHoldIds?: string[];
}
export interface TimelineEntryDto { id: string; actorId: string | null; action: string; resourceType: string; resourceId: string | null; outcome: string; metadata: unknown; createdAt: string }
export interface AgencyRequestDto {
  id: string; agencyName: string; requesterUserId: string | null; kind: 'records' | 'law_enforcement' | 'inspection' | 'subpoena'; legalBasis: string;
  scopeJson: Record<string, unknown> & { legalReference?: string; description?: string }; status: 'received' | 'legal_review' | 'approved' | 'denied' | 'fulfilled' | 'closed';
  minimizationNotes: string | null; approvedBy: string | null; decidedAt: string | null; dueAt: string | null; exportJobId: string | null; createdAt: string; updatedAt: string;
}

export const useCases = (params: { status?: string; kind?: string } = {}) => usePagedList<CaseDto>(['cases'], '/cases', params);
export const useCase = (id: string | undefined) => useQuery({ queryKey: ['cases', id], queryFn: () => api<CaseDto>(`/cases/${id}`), enabled: Boolean(id) });
export const useCaseTimeline = (id: string | undefined) => usePagedList<TimelineEntryDto>(['case-timeline', id], `/cases/${id}/timeline`, {}, Boolean(id));
export const useAgencyRequests = (params: { status?: string; kind?: string } = {}) => usePagedList<AgencyRequestDto>(['agency-requests'], '/agency-requests', params);

export function useCreateCase() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: { title: string; kind: string; leaseId?: string; propertyId?: string; tenantProfileId?: string; privileged?: boolean }) => api<CaseDto>('/cases', { method: 'POST', body: input }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['cases'] }) });
}
export function useUpdateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; deadlines?: Partial<CaseDeadlineDto>[]; note?: string }) => api<CaseDto>(`/cases/${id}`, { method: 'PATCH', body }),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ['cases'] }); void qc.invalidateQueries({ queryKey: ['case-timeline', v.id] }); },
  });
}
export function useAddDeadline() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, title, dueAt }: { id: string; title: string; dueAt: string }) => api<CaseDto>(`/cases/${id}/deadlines`, { method: 'POST', body: { title, dueAt } }), onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ['cases'] }); void qc.invalidateQueries({ queryKey: ['case-timeline', v.id] }); } });
}
export function useCaseLegalHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason, note }: { id: string; reason: string; note: string }) => api<{ id: string }>(`/cases/${id}/legal-hold`, { method: 'POST', body: { reason, note } }),
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ['cases'] }); void qc.invalidateQueries({ queryKey: ['legal-holds'] }); void qc.invalidateQueries({ queryKey: ['legal-hold-check'] }); void qc.invalidateQueries({ queryKey: ['case-timeline', v.id] }); },
  });
}
export function useCreateAgencyRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { agencyName: string; kind: string; legalBasis: string; legalReference?: string; scopeJson: Record<string, unknown> }) => api<AgencyRequestDto>('/agency-requests', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['agency-requests'] }),
  });
}
export function useAgencyAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'legal-review' | 'decide' | 'fulfill'; body: Record<string, unknown> }) => api<AgencyRequestDto>(`/agency-requests/${id}/${action}`, { method: 'POST', body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['agency-requests'] }); void qc.invalidateQueries({ queryKey: ['exports'] }); },
  });
}
