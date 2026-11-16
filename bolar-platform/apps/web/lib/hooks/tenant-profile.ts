'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TenantProfileDto, TenantProfileDetailDto, TenantProfileSensitiveDto, CreateTenantProfileDto, ContactMethodDto, EmergencyContactDto, OccupantDto } from '@bolar/contracts';
import { api } from '../api-client';
import { usePagedList } from './iam';

export type { TenantProfileDto, TenantProfileDetailDto, TenantProfileSensitiveDto, ContactMethodDto, EmergencyContactDto, OccupantDto };

export const useTenantProfiles = (params: { status?: string; kind?: string; q?: string } = {}, enabled = true) => usePagedList<TenantProfileDto>(['tenant-profiles'], '/tenant-profiles', params, enabled);

export const useTenantProfile = (id: string) => useQuery({ queryKey: ['tenant-profile', id], queryFn: () => api<TenantProfileDetailDto>(`/tenant-profiles/${id}`), enabled: !!id });

/** Full sensitive fields; 403 review_required renders the request-access panel via StateView. */
export const useTenantProfileSensitive = (id: string, enabled = true) =>
  useQuery({ queryKey: ['tenant-profile', id, 'sensitive'], queryFn: () => api<TenantProfileSensitiveDto>(`/tenant-profiles/${id}/sensitive`), enabled: !!id && enabled, retry: false });

export function useCreateTenantProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTenantProfileDto) => api<TenantProfileDetailDto>('/tenant-profiles', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-profiles'] }),
  });
}

export function useUpdateTenantProfile(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<CreateTenantProfileDto> & { notes?: string | null }) => api<TenantProfileDetailDto>(`/tenant-profiles/${id}`, { method: 'PATCH', body }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['tenant-profile', id] }); void qc.invalidateQueries({ queryKey: ['tenant-profiles'] }); },
  });
}

export function useAddContactMethod(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { kind: string; value: string; isPrimary?: boolean }) => api<ContactMethodDto>(`/tenant-profiles/${id}/contacts`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-profile', id] }),
  });
}

export function useAddEmergencyContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; relationship: string; phone: string }) => api<EmergencyContactDto>(`/tenant-profiles/${id}/emergency-contacts`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-profile', id] }),
  });
}

export function useAddOccupant(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; relationship: string; isMinor?: boolean }) => api<OccupantDto>(`/tenant-profiles/${id}/occupants`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-profile', id] }),
  });
}

export function useRemoveOccupant(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (occupantId: string) => api<void>(`/tenant-profiles/${id}/occupants/${occupantId}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tenant-profile', id] }),
  });
}
