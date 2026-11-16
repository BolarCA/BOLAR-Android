'use client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';

export interface Page<T> { items: T[]; nextCursor: string | null }
export interface UserDto { id: string; email: string; name: string; status: string; mfaEnabled: boolean; lastLoginAt: string | null; createdAt: string; roles: { role: string; scopeType: string; scopeId: string | null }[] }
export interface InvitationDto { id: string; email: string; role: string; scopeType: string; scopeId: string | null; status: string; expiresAt: string; createdAt: string; acceptUrl?: string }
export interface SensitiveAccessDto { id: string; actorId: string; resourceType: string; resourceId: string; classification: string; purpose: string; justification: string; status: string; approvedBy: string | null; expiresAt: string | null; createdAt: string }
export interface AuditDto { id: string; actorId: string | null; action: string; resourceType: string; resourceId: string | null; outcome: string; requestId: string; purpose: string | null; createdAt: string; before: unknown; after: unknown; metadata: unknown }
export interface OrgDto { id: string; slug: string; name: string; plan: string; status: string; createdAt: string }

function qs(params: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function usePagedList<T>(key: unknown[], path: string, params: Record<string, string | number | undefined> = {}, enabled = true) {
  return useInfiniteQuery({
    queryKey: [...key, params],
    queryFn: ({ pageParam }) => api<Page<T>>(`${path}${qs({ ...params, cursor: pageParam as string | undefined, limit: 25 })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
}

export const useUsers = (params: { status?: string; q?: string } = {}) => usePagedList<UserDto>(['users'], '/users', params);
export const useInvitations = () => usePagedList<InvitationDto>(['invitations'], '/invitations');
export const useSensitiveAccessRequests = (params: { status?: string; mine?: string } = {}) => usePagedList<SensitiveAccessDto>(['sensitive-access'], '/sensitive-access/requests', params);
export const useAudit = (params: Record<string, string | undefined> = {}) => usePagedList<AuditDto>(['audit'], '/audit', params);
export const useOrgs = () => usePagedList<OrgDto>(['orgs'], '/orgs');
export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: () => api<{ status: string; checks: Record<string, string>; version: string }>('/health'), refetchInterval: 30_000 });

export function useCreateInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: string; scopeType?: string; scopeId?: string }) => api<InvitationDto>('/invitations', { method: 'POST', body: input }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['invitations'] }); void qc.invalidateQueries({ queryKey: ['users'] }); },
  });
}
export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api<InvitationDto>(`/invitations/${id}/revoke`, { method: 'POST' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['invitations'] }) });
}
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, ...body }: { id: string; name?: string; status?: string }) => api<UserDto>(`/users/${id}`, { method: 'PATCH', body }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }) });
}
export function useDecideAccess() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, decision, ttlHours }: { id: string; decision: 'approved' | 'denied'; ttlHours?: number }) => api<SensitiveAccessDto>(`/sensitive-access/requests/${id}/decide`, { method: 'POST', body: { decision, ttlHours } }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['sensitive-access'] }) });
}
