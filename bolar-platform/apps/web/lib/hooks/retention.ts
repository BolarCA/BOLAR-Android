'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { usePagedList } from './iam';

export interface RetentionPolicyDto { id: string; tenantOrgId: string | null; key: string; name: string; resourceType: string; classification: string | null; retainDays: number; disposition: string; requiresApproval: boolean; isPlatformDefault: boolean; createdAt: string }
export interface RetentionAssignmentDto { id: string; policyId: string; policyKey?: string; resourceType: string; resourceId: string; retainUntil: string; state: string; proposedAt: string | null; approvedBy: string | null; disposedAt: string | null; createdAt: string; dispositionNote?: string }
export interface SweepResultDto { scanned: number; proposed: number; held: number; ranAt: string }

export const useRetentionPolicies = () => useQuery({ queryKey: ['retention-policies'], queryFn: () => api<{ items: RetentionPolicyDto[] }>('/retention/policies') });
export const useRetentionAssignments = (params: { state?: string; resourceType?: string; dueBefore?: string } = {}) => usePagedList<RetentionAssignmentDto>(['retention-assignments'], '/retention/assignments', params);

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['retention-assignments'] });
  void qc.invalidateQueries({ queryKey: ['retention-policies'] });
}

export function useCreateRetentionPolicy() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: { key: string; name: string; resourceType: string; retainDays: number; disposition: string; requiresApproval?: boolean }) => api<RetentionPolicyDto>('/retention/policies', { method: 'POST', body: input }), onSuccess: () => invalidate(qc) });
}
export function useAssignRetention() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: { policyKey: string; resourceType: string; resourceId: string; anchorDate?: string }) => api<RetentionAssignmentDto>('/retention/assignments', { method: 'POST', body: input }), onSuccess: () => invalidate(qc) });
}
export function useRetentionSweep() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api<SweepResultDto>('/retention/sweep', { method: 'POST' }), onSuccess: () => invalidate(qc) });
}
export function useRetentionAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'approve' | 'dispose' | 'hold'; note?: string }) => api<RetentionAssignmentDto>(`/retention/assignments/${id}/${action}`, { method: 'POST', body: note !== undefined ? { note } : {} }),
    onSuccess: () => invalidate(qc),
  });
}
