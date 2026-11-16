'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiAuditRowDto, AiBudgetDto, AiCommandResponseDto, AiContextDto, AiDraftRefDto, AiMessageDto, AiSourceDto, AiThreadDetailDto, AiThreadDto, AiToolCallDto } from '@bolar/contracts';
import { api } from '../api-client';
import { usePagedList } from './iam';

export type { AiAuditRowDto, AiBudgetDto, AiCommandResponseDto, AiContextDto, AiDraftRefDto, AiMessageDto, AiSourceDto, AiThreadDetailDto, AiThreadDto, AiToolCallDto };

export const useAiThreads = (params: { contextType?: string; contextId?: string } = {}, enabled = true) => usePagedList<AiThreadDto>(['ai-threads'], '/ai/threads', params, enabled);
export const useAiThread = (id: string | null) => useQuery({ queryKey: ['ai-thread', id], queryFn: () => api<AiThreadDetailDto>(`/ai/threads/${id}`), enabled: Boolean(id) });
export const useAiToolCalls = (params: { threadId?: string; status?: string; tool?: string } = {}) => usePagedList<AiToolCallDto>(['ai-tool-calls'], '/ai/tool-calls', params);
export const useAiAudit = (params: { actorId?: string; tool?: string; status?: string; action?: string } = {}) => usePagedList<AiAuditRowDto>(['ai-audit'], '/ai/audit', params);
export const useAiBudget = (enabled = true) => useQuery({ queryKey: ['ai-budget'], queryFn: () => api<AiBudgetDto>('/ai/budget'), enabled, staleTime: 30_000 });

export function useAiCommand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { threadId?: string; command: string; context?: AiContextDto }) => api<AiCommandResponseDto>('/ai/commands', { method: 'POST', body }),
    onSuccess: (res) => {
      qc.setQueryData(['ai-budget'], res.budget);
      void qc.invalidateQueries({ queryKey: ['ai-threads'] });
      void qc.invalidateQueries({ queryKey: ['ai-thread', res.thread.id] });
      void qc.invalidateQueries({ queryKey: ['ai-tool-calls'] });
      void qc.invalidateQueries({ queryKey: ['ai-audit'] });
      if (res.drafts.length) void qc.invalidateQueries({ queryKey: ['notices'] });
    },
  });
}

export function useCreateAiThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title?: string; context?: AiContextDto }) => api<AiThreadDto>('/ai/threads', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ai-threads'] }),
  });
}

export function useUpdateAiBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { monthlyLimitCents: number }) => api<AiBudgetDto>('/ai/budget', { method: 'PATCH', body }),
    onSuccess: (b) => qc.setQueryData(['ai-budget'], b),
  });
}

/** Record page for a cited source, or null when the type has no page. Mirrors the portal routes. */
export function sourceHref(source: AiSourceDto): string | null {
  switch (source.type) {
    case 'lease': return `/manager/leases/${source.id}`;
    case 'work_order': return `/manager/maintenance?workOrderId=${source.id}`;
    case 'case': return `/legal/cases/${source.id}`;
    case 'document': return '/manager/documents';
    case 'notice': return `/manager/notices?focus=${source.id}`;
    case 'property': return `/manager/properties/${source.id}`;
    case 'vendor': return '/manager/vendors';
    case 'invoice': return '/finance/invoices';
    case 'rule_evaluation': return '/compliance';
    default: return null;
  }
}

/** Derive the assistant context from the current location (lease / case detail pages, work order deep links). */
export function contextFromLocation(pathname: string, search: string): AiContextDto {
  const lease = pathname.match(/^\/manager\/leases\/([^/]+)/);
  if (lease) return { resourceType: 'lease', resourceId: lease[1] };
  const legalCase = pathname.match(/^\/legal\/cases\/([^/]+)/);
  if (legalCase) return { resourceType: 'case', resourceId: legalCase[1] };
  const property = pathname.match(/^\/(?:manager|owner)\/properties\/([^/]+)/);
  if (property) return { resourceType: 'property', resourceId: property[1] };
  const workOrderId = new URLSearchParams(search).get('workOrderId');
  if (workOrderId && /maintenance|vendor/.test(pathname)) return { resourceType: 'work_order', resourceId: workOrderId };
  return {};
}

export const PROMPT_SUGGESTIONS: Record<string, string[]> = {
  lease: ['Summarize this lease', 'What should I do next with this lease?', 'Draft a late rent notice for this lease', 'Draft an email to the tenant about the upcoming inspection'],
  work_order: ['Summarize this work order', 'What are the next steps?', 'Draft an email to the resident with an update'],
  case: ['Summarize this case', 'Prepare the evidence packet outline', 'What should I do next?'],
  property: ['What is overdue or due this week?', 'Flag anomalies and risks in my portfolio'],
  none: ['What is overdue or due this week?', 'Flag anomalies and risks in my portfolio'],
};
