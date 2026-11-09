'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE, api } from '../api-client';
import { usePagedList } from './iam';

export interface ExportManifestDto {
  generatedAt: string; tenantOrgId: string; exportJobId: string; kind: string; source: { type: string; id: string };
  filters: Record<string, unknown>; redaction: { fields?: string[]; note?: string | null }; reviewer: { requestedBy: string; approvedBy: string | null };
  files: { documentId: string; versionId: string | null; title: string; category: string; classification: string; fileName: string | null; sha256: string | null; storageKey: string | null }[];
  auditEvents: { id: string; action: string; resourceType: string; resourceId: string | null; createdAt: string }[];
  subjects: Record<string, unknown>[]; counts: Record<string, number>;
}
export interface ExportJobDto {
  id: string; kind: string; sourceType: string; sourceId: string; status: 'requested' | 'approved' | 'running' | 'complete' | 'failed' | 'denied';
  filtersJson: Record<string, unknown>; redactionJson: { fields?: string[]; note?: string }; manifestJson: ExportManifestDto | null; manifestSha256: string | null; storageKey: string | null;
  requestedBy: string; approvedBy: string | null; completedAt: string | null; error: string | null; createdAt: string; updatedAt: string;
  download?: { url: string; expiresAt: string } | null;
}

export const useExports = (params: { status?: string; kind?: string; sourceType?: string; sourceId?: string } = {}, enabled = true) => usePagedList<ExportJobDto>(['exports'], '/exports', params, enabled);
export const useExport = (id: string | undefined) => useQuery({ queryKey: ['exports', id], queryFn: () => api<ExportJobDto>(`/exports/${id}`), enabled: Boolean(id) });

export function useRequestExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: string; sourceType: string; sourceId: string; filters?: Record<string, unknown>; redaction?: { fields: string[]; note?: string } }) => api<ExportJobDto>('/exports', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['exports'] }),
  });
}
export function useExportDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'deny'; note: string }) => api<ExportJobDto>(`/exports/${id}/${decision}`, { method: 'POST', body: { note } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['exports'] }); void qc.invalidateQueries({ queryKey: ['agency-requests'] }); },
  });
}

/** Direct API link for the audit manifest of a resource (audit:read; opens as JSON). */
export const auditManifestUrl = (resourceType: string, resourceId: string) => `${API_BASE}/audit/export?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`;
export const useAuditManifest = (resourceType: string | undefined, resourceId: string | undefined, enabled = false) =>
  useQuery({ queryKey: ['audit-manifest', resourceType, resourceId], queryFn: () => api<{ count: number; sha256: string; rows: unknown[]; generatedAt: string }>(`/audit/export?resourceType=${resourceType}&resourceId=${resourceId}`), enabled: enabled && Boolean(resourceType && resourceId) });
