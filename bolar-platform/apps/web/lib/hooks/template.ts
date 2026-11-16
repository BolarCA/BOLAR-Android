'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { usePagedList } from './iam';

export type TemplateVersionStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'retired';
export interface TemplateDto { id: string; tenantOrgId: string | null; key: string; channel: string; name: string; riskLevel: 'low' | 'high'; jurisdiction: string | null; currentVersion: number; scope: 'platform' | 'org'; latestStatus: TemplateVersionStatus | null; createdAt: string; updatedAt: string }
export interface TemplateVersionDto { id: string; templateId: string; version: number; subject: string | null; body: string; variables: string[]; status: TemplateVersionStatus; approvedBy: string | null; approvedAt: string | null; createdBy: string; createdAt: string }
export interface TemplateDetailDto extends TemplateDto { versions: TemplateVersionDto[] }
export interface RenderedTemplateDto { templateId: string; versionId: string; version: number; key: string; channel: string; subject: string | null; body: string }
export interface CreateTemplateInput { key: string; channel: string; name: string; riskLevel: 'low' | 'high'; jurisdiction?: string; subject?: string; body: string; variables?: string[] }

export const useTemplates = (params: { channel?: string; riskLevel?: string; scope?: string; q?: string } = {}) => usePagedList<TemplateDto>(['templates'], '/templates', params);
export const useTemplate = (id: string | null) => useQuery({ queryKey: ['templates', id], queryFn: () => api<TemplateDetailDto>(`/templates/${id}`), enabled: !!id });

function invalidateTemplates(qc: ReturnType<typeof useQueryClient>) {
  return () => { void qc.invalidateQueries({ queryKey: ['templates'] }); };
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (input: CreateTemplateInput) => api<TemplateDetailDto>('/templates', { method: 'POST', body: input }), onSuccess: invalidateTemplates(qc) });
}
export function useCreateTemplateVersion() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...body }: { id: string; subject?: string; body: string; variables?: string[] }) => api<TemplateDetailDto>(`/templates/${id}/versions`, { method: 'POST', body }), onSuccess: invalidateTemplates(qc) });
}
export function useTemplateTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, versionId, action, note }: { id: string; versionId: string; action: 'submit' | 'approve' | 'reject'; note?: string }) =>
      api<TemplateDetailDto>(`/templates/${id}/versions/${versionId}/${action}`, { method: 'POST', body: action === 'submit' ? undefined : { note } }),
    onSuccess: invalidateTemplates(qc),
  });
}
export function useRenderTemplate() {
  return useMutation({ mutationFn: ({ key, variables }: { key: string; variables: Record<string, string> }) => api<RenderedTemplateDto>(`/templates/${key}/render`, { method: 'POST', body: { variables } }) });
}

/** Variables referenced by a version: declared list plus {{placeholders}} found in subject/body. */
export function variablesOf(v: { subject: string | null; body: string; variables: string[] }): string[] {
  const found = new Set<string>(v.variables);
  for (const text of [v.subject ?? '', v.body]) for (const m of text.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)) found.add(m[1]!);
  return [...found];
}
