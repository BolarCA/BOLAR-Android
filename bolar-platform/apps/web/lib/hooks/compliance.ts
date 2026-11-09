'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComplianceRuleDto, EvaluateRulesResponseDto, JurisdictionResolutionDto, RuleEvaluationDto, ScreenTextResponseDto } from '@bolar/contracts';
import { api } from '../api-client';
import { usePagedList } from './iam';

export type { ComplianceRuleDto, RuleEvaluationDto, EvaluateRulesResponseDto, JurisdictionResolutionDto, ScreenTextResponseDto };

export interface EvaluationFilters { severity?: string; domain?: string; result?: string; reviewed?: 'true' | 'false'; resourceType?: string; resourceId?: string }

export const useEvaluations = (filters: EvaluationFilters = {}) => usePagedList<RuleEvaluationDto>(['rule-evaluations'], '/rules/evaluations', filters as Record<string, string | undefined>);
export const useRules = (filters: { jurisdiction?: string; domain?: string; status?: string } = {}) => usePagedList<ComplianceRuleDto>(['compliance-rules'], '/rules', filters);
export const useJurisdiction = (propertyId: string | undefined) =>
  useQuery({ queryKey: ['jurisdiction', propertyId], queryFn: () => api<JurisdictionResolutionDto>(`/jurisdiction/resolve?propertyId=${encodeURIComponent(propertyId!)}`), enabled: Boolean(propertyId) });

export function useResolveEvaluation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolution, note }: { id: string; resolution: 'accepted' | 'remediated' | 'overridden' | 'dismissed'; note?: string }) => api<RuleEvaluationDto>(`/rules/evaluations/${id}/resolve`, { method: 'POST', body: { resolution, note } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rule-evaluations'] }),
  });
}
export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: Record<string, unknown>) => api<ComplianceRuleDto>('/rules', { method: 'POST', body }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['compliance-rules'] }) });
}
export function useNewRuleVersion() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => api<ComplianceRuleDto>(`/rules/${id}/new-version`, { method: 'POST', body }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['compliance-rules'] }) });
}
export function useRuleAction() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, action }: { id: string; action: 'activate' | 'retire' }) => api<ComplianceRuleDto>(`/rules/${id}/${action}`, { method: 'POST' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['compliance-rules'] }) });
}
/** Dry-run preview: nothing is persisted; an unsaved candidate rule can be evaluated alongside the rules in force. */
export function usePreviewEvaluate() {
  return useMutation({
    mutationFn: (body: { domain?: string; facts: Record<string, unknown>; jurisdiction?: string; propertyId?: string; candidate?: { key?: string; action?: string; severity?: string; conditions: unknown; jurisdiction?: string; domain?: string; title?: string } }) =>
      api<EvaluateRulesResponseDto>('/rules/evaluate', { method: 'POST', body: { ...body, dryRun: true, resourceType: 'preview', resourceId: 'rule-editor' } }),
  });
}
export function useScreenText() {
  return useMutation({ mutationFn: (body: { text: string; resourceType?: string; resourceId?: string }) => api<ScreenTextResponseDto>('/compliance/screen-text', { method: 'POST', body }) });
}

export function dueTone(dueAt: string): 'danger' | 'warning' | 'neutral' {
  const ms = new Date(dueAt).getTime() - Date.now();
  if (ms < 0) return 'danger';
  if (ms < 3 * 86_400_000) return 'warning';
  return 'neutral';
}
export function severityTone(sev: string): 'danger' | 'warning' | 'info' | 'neutral' {
  return sev === 'critical' ? 'danger' : sev === 'high' ? 'warning' : sev === 'medium' ? 'info' : 'neutral';
}
export function resourceHref(e: { resourceType: string; resourceId: string }): string | null {
  if (e.resourceType === 'application') return `/manager/applications?focus=${e.resourceId}`;
  if (e.resourceType === 'adverse_action') return `/manager/applications?adverse=${e.resourceId}`;
  if (e.resourceType === 'notice') return `/compliance/notices?focus=${e.resourceId}`;
  return null;
}
