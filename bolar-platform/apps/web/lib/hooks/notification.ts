'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { usePagedList } from './iam';

export interface NotificationDto { id: string; channel: 'email' | 'sms' | 'in_app'; recipientId: string; templateKey: string; variables: Record<string, unknown>; status: 'queued' | 'sent' | 'delivered' | 'failed' | 'suppressed'; attempts: number; lastError: string | null; sentAt: string | null; readAt: string | null; createdAt: string; subject?: string | null; body?: string }

export const useNotifications = (params: { status?: string; channel?: string; unread?: string; recipientId?: string } = {}) => usePagedList<NotificationDto>(['notifications'], '/notifications', params);

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api<NotificationDto>(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }) });
}
export function useRetryNotification() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api<NotificationDto>(`/notifications/${id}/retry`, { method: 'POST' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }) });
}
export function useSendNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { recipientUserId: string; channel: 'email' | 'sms' | 'in_app'; templateKey: string; variables: Record<string, string>; idempotencyKey?: string }) => api<NotificationDto>('/notifications', { method: 'POST', body: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
