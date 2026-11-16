'use client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateWorkOrderInput, WorkOrderDetailDto, WorkOrderDto, WorkOrderEventDto } from '@bolar/contracts';
import { api } from '../api-client';
import type { Page } from './iam';

export type { WorkOrderDto, WorkOrderDetailDto, WorkOrderEventDto, CreateWorkOrderInput };

/** Media contract owned by docs-comms (agent brief "Cross-module contracts"). */
export interface MediaItemDto { id: string; fileName: string; mimeType: string; sizeBytes: number; status: string; thumbnailKey: string | null; createdAt: string; downloadUrl?: string | null }

export interface WorkOrderFilters { status?: string; priority?: string; category?: string; propertyId?: string; assignedVendorId?: string; assignedUserId?: string; mine?: 'true'; overdue?: 'true'; includeCanceled?: 'true'; q?: string }

function qs(params: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function useWorkOrders(params: WorkOrderFilters = {}, opts: { limit?: number; enabled?: boolean } = {}) {
  const limit = opts.limit ?? 100;
  return useInfiniteQuery({
    queryKey: ['work-orders', params, limit],
    queryFn: ({ pageParam }) => api<Page<WorkOrderDto>>(`/work-orders${qs({ ...params, cursor: pageParam as string | undefined, limit })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: opts.enabled ?? true,
  });
}

export const useWorkOrder = (id: string | null | undefined) =>
  useQuery({ queryKey: ['work-order', id], queryFn: () => api<WorkOrderDetailDto>(`/work-orders/${id}`), enabled: Boolean(id) });

/** Photo evidence for a work order. The media endpoint belongs to another slice; a 404 renders as "not available" rather than an error. */
export const useWorkOrderMedia = (id: string | null | undefined) =>
  useQuery({ queryKey: ['work-order-media', id], queryFn: () => api<Page<MediaItemDto>>(`/media${qs({ ownerType: 'work_order', ownerId: id!, limit: 50 })}`), enabled: Boolean(id), retry: false });

function useInvalidateWorkOrders() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ['work-orders'] });
    void qc.invalidateQueries({ queryKey: ['vendor-work-orders'] });
    if (id) void qc.invalidateQueries({ queryKey: ['work-order', id] });
  };
}

export function useCreateWorkOrder() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({ mutationFn: (input: CreateWorkOrderInput) => api<WorkOrderDto & { possibleDuplicateId: string | null }>('/work-orders', { method: 'POST', body: input }), onSuccess: () => invalidate() });
}

export function useTransitionWorkOrder() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; to: string; note?: string; scheduledFor?: string; actualCents?: number }) => api<WorkOrderDetailDto>(`/work-orders/${id}/transition`, { method: 'POST', body }),
    onSuccess: (_d, v) => invalidate(v.id),
  });
}

export function useAssignWorkOrder() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({ mutationFn: ({ id, ...body }: { id: string; vendorId?: string; userId?: string }) => api<WorkOrderDto>(`/work-orders/${id}/assign`, { method: 'POST', body }), onSuccess: (_d, v) => invalidate(v.id) });
}

export function useUpdateWorkOrder() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({ mutationFn: ({ id, ...body }: { id: string; priority?: string; estimateCents?: number | null; title?: string; description?: string }) => api<WorkOrderDto>(`/work-orders/${id}`, { method: 'PATCH', body }), onSuccess: (_d, v) => invalidate(v.id) });
}

export function useAddWorkOrderNote() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ id, body, kind = 'note' }: { id: string; body: string; kind?: 'note' | 'message' }) => api<WorkOrderEventDto>(`/work-orders/${id}/notes`, { method: 'POST', body: { body, kind } }), onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: ['work-order', v.id] }) });
}

export function useMarkDuplicate() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({ mutationFn: ({ id, duplicateOfId }: { id: string; duplicateOfId: string }) => api<WorkOrderDto>(`/work-orders/${id}/mark-duplicate`, { method: 'POST', body: { duplicateOfId } }), onSuccess: (_d, v) => invalidate(v.id) });
}

export function useSlaScan() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({ mutationFn: () => api<{ scanned: number; breached: string[] }>('/work-orders/sla/scan', { method: 'POST' }), onSuccess: () => invalidate() });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Uploads a photo through the docs-comms media contract after the request exists. */
export function useUploadWorkOrderMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workOrderId, file }: { workOrderId: string; file: File }) => {
      const contentBase64 = await fileToBase64(file);
      return api<MediaItemDto>('/media', { method: 'POST', body: { ownerType: 'work_order', ownerId: workOrderId, fileName: file.name, mimeType: file.type || 'application/octet-stream', contentBase64 } });
    },
    onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: ['work-order-media', v.workOrderId] }),
  });
}
