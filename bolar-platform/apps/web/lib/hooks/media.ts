'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client';
import { usePagedList } from './iam';
import { putSigned } from './document';

export interface MediaAssetDto { id: string; ownerType: string; ownerId: string; fileName: string; mimeType: string; sizeBytes: number; classification: string; status: 'uploading' | 'uploaded' | 'processed' | 'failed'; thumbnailKey: string | null; uploadedBy: string; createdAt: string; downloadUrl?: string; downloadExpiresAt?: string }
export interface CreateMediaResponse extends MediaAssetDto { uploadUrl?: string; uploadExpiresAt?: string }

export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_INLINE_MAX_BYTES = 1_000_000;
export const MEDIA_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'] as const;

export const useMedia = (ownerType: string, ownerId: string) => usePagedList<MediaAssetDto>(['media', ownerType, ownerId], '/media', { ownerType, ownerId }, Boolean(ownerType && ownerId));

export function useDeleteMedia() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api<void>(`/media/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['media'] }) });
}

export function validateMediaFile(file: File): string | null {
  if (!(MEDIA_ALLOWED_TYPES as readonly string[]).includes(file.type)) return `Type ${file.type || 'unknown'} is not allowed. Use JPEG, PNG, WebP, MP4 or PDF.`;
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MEDIA_MAX_BYTES) return 'Files are limited to 10 MB.';
  return null;
}

function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read file'));
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.readAsDataURL(file);
  });
}

/**
 * Upload one media file: small files go inline (base64 POST /media); larger ones take the signed PUT
 * URL with progress and are finalized. Rejects before any network call when size/type limits fail.
 */
export async function uploadMedia(file: File, owner: { ownerType: string; ownerId: string }, onProgress: (percent: number) => void): Promise<MediaAssetDto> {
  const problem = validateMediaFile(file);
  if (problem) throw new Error(problem);
  if (file.size <= MEDIA_INLINE_MAX_BYTES) {
    onProgress(10);
    const contentBase64 = await toBase64(file);
    onProgress(40);
    const asset = await api<MediaAssetDto>('/media', { method: 'POST', body: { ...owner, fileName: file.name, mimeType: file.type, contentBase64 } });
    onProgress(100);
    return asset;
  }
  const created = await api<CreateMediaResponse>('/media', { method: 'POST', body: { ...owner, fileName: file.name, mimeType: file.type, sizeBytes: file.size } });
  if (!created.uploadUrl) return created;
  await putSigned(created.uploadUrl, file, (p) => onProgress(Math.min(95, p)));
  const finalized = await api<MediaAssetDto>(`/media/${created.id}/finalize`, { method: 'POST' });
  onProgress(100);
  return finalized;
}
