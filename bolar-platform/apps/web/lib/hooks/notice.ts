'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { NoticeDto, NoticeWithGuardDto } from '@bolar/contracts';
import { api } from '../api-client';
import { usePagedList } from './iam';

export type { NoticeDto, NoticeWithGuardDto };

export const useNotices = (filters: { status?: string; kind?: string } = {}) => usePagedList<NoticeDto>(['notices'], '/notices', filters);

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['notices'] });
  void qc.invalidateQueries({ queryKey: ['rule-evaluations'] });
}

export function useCreateNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { kind: string; templateKey: string; recipientId: string; leaseId?: string; variables: Record<string, string | number | boolean | null>; body?: string; facts?: Record<string, string | number | boolean | null>; propertyId?: string }) => api<NoticeWithGuardDto>('/notices', { method: 'POST', body }),
    onSuccess: () => invalidate(qc),
  });
}
export function useNoticeAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'submit' | 'approve' | 'reject' | 'send' | 'cancel' | 'reopen'; note?: string }) => api<NoticeDto>(`/notices/${id}/${action}`, { method: 'POST', body: action === 'reject' ? { note } : undefined }),
    onSuccess: () => invalidate(qc),
  });
}

export const NOTICE_TEMPLATES: { key: string; kind: string; label: string; variables: string[] }[] = [
  { key: 'notice.late_rent', kind: 'late_rent', label: 'Late rent notice', variables: ['amount', 'period', 'dueDate', 'cureDate', 'jurisdictionClause'] },
  { key: 'notice.entry', kind: 'entry', label: 'Entry notice', variables: ['entryAt', 'reason'] },
  { key: 'notice.general', kind: 'general', label: 'General notice (free text)', variables: ['body'] },
];
