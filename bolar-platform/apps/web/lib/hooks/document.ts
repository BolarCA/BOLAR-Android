'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api-client';
import { usePagedList } from './iam';

export interface DocumentDto { id: string; ownerType: string; ownerId: string; title: string; classification: 'public' | 'internal' | 'confidential' | 'restricted'; category: string; currentVersionId: string | null; legalHold: boolean; createdBy: string; createdAt: string; updatedAt: string; gated: boolean }
export interface DocumentVersionDto { id: string; documentId: string; version: number; fileName: string; mimeType: string; sizeBytes: number; sha256: string; scanStatus: string; createdBy: string; createdAt: string }
export interface DocumentDetailDto extends DocumentDto { versions: DocumentVersionDto[] }
export interface CreateDocumentInput { ownerType: string; ownerId: string; title: string; classification: string; category: string; fileName: string; mimeType: string; contentBase64?: string }
export interface CreateDocumentResponse extends DocumentDto { version: DocumentVersionDto; uploadUrl?: string; uploadExpiresAt?: string }
export interface DownloadUrlDto { url: string; expiresAt: string }

export type DocumentFilters = { ownerType?: string; ownerId?: string; classification?: string; category?: string; q?: string };

export const useDocuments = (params: DocumentFilters = {}) => usePagedList<DocumentDto>(['documents'], '/documents', params);
export const useDocument = (id: string | null) => useQuery({ queryKey: ['documents', id], queryFn: () => api<DocumentDetailDto>(`/documents/${id}`), enabled: !!id });

export function useDownloadUrl() {
  return useMutation({ mutationFn: ({ id, versionId }: { id: string; versionId: string }) => api<DownloadUrlDto>(`/documents/${id}/versions/${versionId}/download`) });
}
export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => api<void>(`/documents/${id}`, { method: 'DELETE' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['documents'] }) });
}

export type UploadPhase = 'creating' | 'uploading' | 'finalizing' | 'done';
export interface UploadProgress { phase: UploadPhase; percent: number }

/** PUT raw bytes to a signed URL with upload progress (XHR is the only browser API exposing it). */
export function putSigned(url: string, file: Blob, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    xhr.onerror = () => reject(new Error('Network error while uploading'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress?.(100); resolve(); }
      else if (xhr.status === 404) reject(new Error('Upload link expired. Start the upload again.'));
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.send(file);
  });
}

export interface PendingUpload { documentId: string; versionId: string; uploadUrl: string }

/** Full document upload: metadata -> signed PUT (progress) -> finalize. Returns the pending handle on PUT failure so the caller can retry without creating a duplicate. */
export async function uploadDocument(input: Omit<CreateDocumentInput, 'fileName' | 'mimeType'>, file: File, onProgress: (p: UploadProgress) => void, resume?: PendingUpload): Promise<{ document: DocumentDetailDto }> {
  let pending = resume;
  if (!pending) {
    onProgress({ phase: 'creating', percent: 0 });
    const created = await api<CreateDocumentResponse>('/documents', { method: 'POST', body: { ...input, fileName: file.name, mimeType: file.type || 'application/octet-stream' } });
    if (!created.uploadUrl) {
      onProgress({ phase: 'done', percent: 100 });
      return { document: await api<DocumentDetailDto>(`/documents/${created.id}`) };
    }
    pending = { documentId: created.id, versionId: created.version.id, uploadUrl: created.uploadUrl };
  }
  onProgress({ phase: 'uploading', percent: 0 });
  try {
    await putSigned(pending.uploadUrl, file, (percent) => onProgress({ phase: 'uploading', percent }));
  } catch (err) {
    throw new UploadError(err instanceof Error ? err.message : 'Upload failed', pending);
  }
  onProgress({ phase: 'finalizing', percent: 100 });
  const sha256 = await sha256Hex(file).catch(() => undefined);
  try {
    const doc = await api<DocumentDetailDto>(`/documents/${pending.documentId}/versions/${pending.versionId}/finalize`, { method: 'POST', body: sha256 ? { sha256 } : {} });
    onProgress({ phase: 'done', percent: 100 });
    return { document: doc };
  } catch (err) {
    throw new UploadError(err instanceof ApiError ? err.message : 'Could not finalize the upload', pending);
  }
}

export class UploadError extends Error {
  constructor(message: string, public readonly pending: PendingUpload) { super(message); this.name = 'UploadError'; }
}

export async function sha256Hex(file: Blob): Promise<string | undefined> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return undefined;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
