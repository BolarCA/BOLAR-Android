'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { usePagedList } from './iam';

export interface PrivacyExceptionDto { type: string; resourceType?: string; ids?: string[]; policyKey?: string; holdIds?: string[]; processors?: { name: string; mode: string }[]; note: string }
export interface PrivacyRequestDto {
  id: string; kind: 'access' | 'deletion' | 'correction' | 'portability'; subjectEmail: string; subjectProfileId: string | null;
  status: 'received' | 'identity_verification' | 'discovery' | 'exception_review' | 'approved' | 'denied' | 'fulfilled' | 'closed';
  identityVerifiedAt: string | null; identityMethod: string | null;
  discoveryJson: { identity?: { provider: string; mode: string; externalId: string; status?: string }; counts?: Record<string, number>; ids?: Record<string, string[]>; subjects?: Record<string, string[]> };
  exceptionsJson: PrivacyExceptionDto[]; decision: string | null; decidedBy: string | null; decidedAt: string | null; dueAt: string;
  confirmationDraft: string | null; manifestJson: Record<string, unknown> | null; createdBy: string | null; createdAt: string; updatedAt: string;
}

export const usePrivacyRequests = (params: { status?: string; kind?: string } = {}) => usePagedList<PrivacyRequestDto>(['privacy-requests'], '/privacy-requests', params);
export const usePrivacyRequest = (id: string | undefined) => useQuery({ queryKey: ['privacy-requests', id], queryFn: () => api<PrivacyRequestDto>(`/privacy-requests/${id}`), enabled: Boolean(id) });

export function usePrivacyAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: 'discover' | 'review-exceptions' | 'decide' | 'fulfill' | 'close'; body?: Record<string, unknown> }) =>
      api<PrivacyRequestDto>(`/privacy-requests/${id}/${action}`, { method: 'POST', body: body ?? {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['privacy-requests'] }),
  });
}

/** Public intake (no session); used by the resident-facing privacy form and e2e. */
export const privacyIntake = (input: { orgSlug: string; kind: string; email: string }) =>
  api<{ id: string; status: string; kind: string; dueAt: string; verificationUrl: string | null }>('/privacy-requests/intake', { method: 'POST', body: input });
