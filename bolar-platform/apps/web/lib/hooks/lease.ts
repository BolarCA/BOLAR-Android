'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeaseDto, LeaseDetailDto, CreateLeaseDto, TransitionLeaseDto, LeaseTransitionOptionDto, LeaseFormOptionsDto, LeaseVersionDto, LeasePartyDto, RecurringChargeDto, SignatureEnvelopeDto } from '@bolar/contracts';
import { api, ApiError } from '../api-client';
import { usePagedList, type AuditDto, type Page } from './iam';

export type { LeaseDto, LeaseDetailDto, CreateLeaseDto, TransitionLeaseDto, LeaseTransitionOptionDto, LeaseFormOptionsDto, LeaseVersionDto, LeasePartyDto, RecurringChargeDto, SignatureEnvelopeDto, AuditDto };

export interface RuleEvaluationDto { id: string; ruleKey: string; ruleVersion: number; result: string; evidenceJson: unknown; createdAt: string }
export interface DocumentSummaryDto { id: string; title: string; classification: string; category: string; currentVersionId: string | null; createdAt: string }

export const useLeases = (params: { status?: string; propertyId?: string; unitId?: string; tenantProfileId?: string } = {}, enabled = true) => usePagedList<LeaseDto>(['leases'], '/leases', params, enabled);
export const useLease = (id: string) => useQuery({ queryKey: ['lease', id], queryFn: () => api<LeaseDetailDto>(`/leases/${id}`), enabled: !!id });
export const useLeaseTimeline = (id: string) => usePagedList<AuditDto>(['lease', id, 'timeline'], `/leases/${id}/timeline`, {}, !!id);
export const useLeaseFormOptions = (enabled = true) => useQuery({ queryKey: ['lease-form-options'], queryFn: () => api<LeaseFormOptionsDto>('/leases/form-options'), enabled });
export const useLeaseEnvelopes = (id: string) => useQuery({ queryKey: ['lease', id, 'envelopes'], queryFn: () => api<{ items: SignatureEnvelopeDto[] }>(`/leases/${id}/envelopes`), enabled: !!id });

/** Cross-module panels (compliance, documents) are optional in this slice: 404/403 render as "not available" empty states. */
const optional = <T,>(fn: () => Promise<T>, empty: T) => async () => {
  try { return await fn(); } catch (err) {
    if (err instanceof ApiError && (err.isNotFound || err.isDenied)) return empty;
    throw err;
  }
};
export const useLeaseRuleEvaluations = (id: string) =>
  useQuery({ queryKey: ['lease', id, 'rule-evaluations'], queryFn: optional(() => api<Page<RuleEvaluationDto>>(`/rules/evaluations?resourceType=lease&resourceId=${id}&limit=50`), { items: [], nextCursor: null }), enabled: !!id, retry: false });
export const useLeaseDocuments = (id: string) =>
  useQuery({ queryKey: ['lease', id, 'documents'], queryFn: optional(() => api<Page<DocumentSummaryDto>>(`/documents?ownerType=lease&ownerId=${id}&limit=50`), { items: [], nextCursor: null }), enabled: !!id, retry: false });

function invalidateLease(qc: ReturnType<typeof useQueryClient>, id?: string) {
  void qc.invalidateQueries({ queryKey: ['leases'] });
  if (id) void qc.invalidateQueries({ queryKey: ['lease', id] });
}

export function useCreateLease() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateLeaseDto) => api<LeaseDetailDto>('/leases', { method: 'POST', body: input }), onSuccess: () => invalidateLease(qc) });
}
export function useTransitionLease(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: TransitionLeaseDto) => api<LeaseDetailDto>(`/leases/${id}/transition`, { method: 'POST', body }), onSuccess: () => invalidateLease(qc, id) });
}
/** Approvals queue acts on many leases, so the id travels with the call. */
export function useTransitionAnyLease() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...body }: TransitionLeaseDto & { id: string }) => api<LeaseDetailDto>(`/leases/${id}/transition`, { method: 'POST', body }), onSuccess: (_d, v) => invalidateLease(qc, v.id) });
}
export function useAddLeaseVersion(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: { termsJson: Record<string, string | number | boolean | null>; documentId?: string }) => api<LeaseVersionDto>(`/leases/${id}/versions`, { method: 'POST', body }), onSuccess: () => invalidateLease(qc, id) });
}
export function useAddLeaseParty(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: { tenantProfileId: string; role: string }) => api<LeasePartyDto>(`/leases/${id}/parties`, { method: 'POST', body }), onSuccess: () => invalidateLease(qc, id) });
}
export function useAddLeaseCharge(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: { type: string; amountCents: number; cadence: string; accountCode?: string }) => api<RecurringChargeDto>(`/leases/${id}/charges`, { method: 'POST', body }), onSuccess: () => invalidateLease(qc, id) });
}
export function useCreateEnvelope(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<SignatureEnvelopeDto>(`/leases/${id}/envelopes`, { method: 'POST', body: {} }), onSuccess: () => invalidateLease(qc, id) });
}
export function useVoidEnvelope(leaseId: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ envelopeId, reason }: { envelopeId: string; reason: string }) => api<SignatureEnvelopeDto>(`/envelopes/${envelopeId}/void`, { method: 'POST', body: { reason } }), onSuccess: () => invalidateLease(qc, leaseId) });
}

export const cents = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
export const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
