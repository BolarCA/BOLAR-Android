'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { usePagedList } from './iam';

export interface LegalHoldScope { propertyIds?: string[]; leaseIds?: string[]; caseIds?: string[]; userIds?: string[]; documentIds?: string[]; tenantProfileIds?: string[] }
export interface LegalHoldDto { id: string; name: string; reason: string; scopeJson: LegalHoldScope; status: 'active' | 'released'; approvedBy: string; releasedBy: string | null; releasedAt: string | null; createdBy: string; createdAt: string }
export interface HoldCheckDto { held: boolean; holdIds: string[] }

export const useLegalHolds = (params: { status?: string; caseId?: string } = {}) => usePagedList<LegalHoldDto>(['legal-holds'], '/legal-holds', params);
export const useLegalHoldCheck = (resourceType: string | undefined, resourceId: string | undefined) =>
  useQuery({ queryKey: ['legal-hold-check', resourceType, resourceId], queryFn: () => api<HoldCheckDto>(`/legal-holds/check?resourceType=${resourceType}&resourceId=${resourceId}`), enabled: Boolean(resourceType && resourceId) });

export function useCreateLegalHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; reason: string; scopeJson: LegalHoldScope; note: string }) => api<LegalHoldDto>('/legal-holds', { method: 'POST', body: input }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['legal-holds'] }); void qc.invalidateQueries({ queryKey: ['legal-hold-check'] }); void qc.invalidateQueries({ queryKey: ['cases'] }); },
  });
}
export function useReleaseLegalHold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => api<LegalHoldDto>(`/legal-holds/${id}/release`, { method: 'POST', body: { note } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['legal-holds'] }); void qc.invalidateQueries({ queryKey: ['legal-hold-check'] }); void qc.invalidateQueries({ queryKey: ['cases'] }); },
  });
}
