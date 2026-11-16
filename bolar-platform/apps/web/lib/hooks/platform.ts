'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeatureFlagDto, HealthSummaryDto, SupportSessionDto } from '@bolar/contracts';
import { api } from '../api-client';
import { usePagedList, type AuditDto, type OrgDto, type Page, type UserDto } from './iam';

export type { FeatureFlagDto, HealthSummaryDto, SupportSessionDto };
export interface PlatformAuditDto extends AuditDto { tenantOrgId: string | null }
export interface SubaccountDto { id: string; tenantOrgId: string; businessAccountId: string; name: string; status: string; createdAt: string }

/** Day 51 platform control plane hooks. Cross-tenant reads for one org pass X-Tenant-Org explicitly (audited by the API). */
export const useHealthSummary = (enabled = true) =>
  useQuery({ queryKey: ['platform', 'health-summary'], queryFn: () => api<HealthSummaryDto>('/platform/health-summary'), enabled, refetchInterval: 30_000 });

export const useOrg = (id: string) => useQuery({ queryKey: ['org', id], queryFn: () => api<OrgDto>(`/orgs/${id}`), enabled: Boolean(id) });
export const useOrgSubaccounts = (slug: string | undefined) =>
  useQuery({ queryKey: ['org', slug, 'subaccounts'], queryFn: () => api<Page<SubaccountDto>>('/subaccounts?limit=100', { headers: { 'X-Tenant-Org': slug! } }), enabled: Boolean(slug) });
export const useOrgUsers = (slug: string | undefined) =>
  useQuery({ queryKey: ['org', slug, 'users'], queryFn: () => api<Page<UserDto>>('/users?limit=100', { headers: { 'X-Tenant-Org': slug! } }), enabled: Boolean(slug) });
export const useOrgRecentAudit = (slug: string | undefined) =>
  useQuery({ queryKey: ['org', slug, 'audit'], queryFn: () => api<Page<AuditDto>>('/audit?limit=15', { headers: { 'X-Tenant-Org': slug! } }), enabled: Boolean(slug) });

export function useUpdateOrg(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string; plan?: string; status?: string }) => api<OrgDto>(`/orgs/${id}`, { method: 'PATCH', body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['org', id] }); void qc.invalidateQueries({ queryKey: ['orgs'] }); },
  });
}

export const useFeatureFlags = (params: { scope?: string; tenantOrgId?: string; key?: string } = {}) => usePagedList<FeatureFlagDto>(['feature-flags'], '/feature-flags', params);
export function useCreateFeatureFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { key: string; enabled: boolean; rules?: Record<string, unknown>; tenantOrgId?: string }) => api<FeatureFlagDto>('/feature-flags', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['feature-flags'] }),
  });
}
export function useUpdateFeatureFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; enabled?: boolean; rules?: Record<string, unknown> }) => api<FeatureFlagDto>(`/feature-flags/${id}`, { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['feature-flags'] }),
  });
}

export const useSupportSessions = (params: { active?: 'true' | 'false'; tenantOrgId?: string } = {}) => usePagedList<SupportSessionDto>(['support-sessions'], '/support-sessions', params);
export function useStartSupportSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { tenantOrgId: string; reason: string; durationMinutes: number }) => api<SupportSessionDto>('/support-sessions', { method: 'POST', body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['support-sessions'] }); void qc.invalidateQueries({ queryKey: ['platform'] }); },
  });
}
export function useEndSupportSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<SupportSessionDto>(`/support-sessions/${id}/end`, { method: 'POST' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['support-sessions'] }); void qc.invalidateQueries({ queryKey: ['platform'] }); void qc.invalidateQueries({ queryKey: ['me'] }); },
  });
}

export const usePlatformAudit = (params: Record<string, string | undefined> = {}) => usePagedList<PlatformAuditDto>(['platform-audit'], '/platform/audit', params);

export const relTime = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const unit = abs < 3_600_000 ? [60_000, 'min'] as const : abs < 86_400_000 ? [3_600_000, 'h'] as const : [86_400_000, 'd'] as const;
  const n = Math.max(1, Math.round(abs / unit[0]));
  return ms < 0 ? `${n}${unit[1]} ago` : `in ${n}${unit[1]}`;
};
