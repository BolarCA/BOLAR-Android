'use client';
import { useId, useRef, useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { MEDIA_ALLOWED_TYPES, MEDIA_MAX_BYTES, uploadMedia, validateMediaFile, type MediaAssetDto } from '@/lib/hooks/media';
import { formatBytes } from '@/lib/hooks/document';
import { Badge, Button, cn } from '@/components/ui';

interface Item { id: string; file: File; percent: number; status: 'queued' | 'uploading' | 'done' | 'error'; error?: string; asset?: MediaAssetDto }

/**
 * Media upload (Day 27): drag/drop or pick files, per-file progress, retry, client-side size/type
 * limits mirrored by the API (10 MB; JPEG/PNG/WebP/MP4/PDF). Access is enforced server side by the
 * relationship gate; a 404 here means the caller is not related to the owner.
 */
export function MediaUpload({ ownerType, ownerId, onUploaded, label = 'Add photos or files' }: { ownerType: string; ownerId: string; onUploaded?: (asset: MediaAssetDto) => void; label?: string }) {
  const qc = useQueryClient();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);

  const patch = (id: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)));

  async function upload(item: Item) {
    patch(item.id, { status: 'uploading', percent: 0, error: undefined });
    try {
      const asset = await uploadMedia(item.file, { ownerType, ownerId }, (percent) => patch(item.id, { percent }));
      patch(item.id, { status: 'done', percent: 100, asset });
      void qc.invalidateQueries({ queryKey: ['media', ownerType, ownerId] });
      onUploaded?.(asset);
    } catch (err) {
      const message = err instanceof ApiError ? (err.isNotFound ? 'You are not linked to this record, so uploads are not allowed.' : err.message) : err instanceof Error ? err.message : 'Upload failed';
      patch(item.id, { status: 'error', error: message });
    }
  }

  function add(files: FileList | File[]) {
    const next: Item[] = Array.from(files).map((file) => {
      const problem = validateMediaFile(file);
      return { id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, file, percent: 0, status: problem ? 'error' : 'queued', error: problem ?? undefined };
    });
    setItems((list) => [...list, ...next]);
    for (const item of next) if (item.status === 'queued') void upload(item);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files?.length) add(e.dataTransfer.files);
  }

  return (
    <div className="space-y-3">
      <div role="group" aria-labelledby={`${inputId}-label`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        className={cn('rounded-[14px] border-2 border-dashed p-6 text-center transition', dragging ? 'border-cobalt-500 bg-cobalt-100/40' : 'border-line bg-surface')}>
        <p id={`${inputId}-label`} className="font-medium text-navy-900">{label}</p>
        <p className="mt-1 text-xs text-muted">Drag and drop, or choose files. JPEG, PNG, WebP, MP4 or PDF up to {formatBytes(MEDIA_MAX_BYTES)}.</p>
        <input ref={inputRef} id={inputId} type="file" multiple accept={MEDIA_ALLOWED_TYPES.join(',')} className="sr-only" aria-label={label} onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.target.value = ''; }} />
        <Button type="button" variant="secondary" className="mt-3" onClick={() => inputRef.current?.click()}>Choose files</Button>
      </div>
      {items.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {items.map((i) => (
            <li key={i.id} className="rounded-lg border border-line bg-surface p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{i.file.name} <span className="text-xs text-muted">({formatBytes(i.file.size)})</span></span>
                <Badge tone={i.status === 'done' ? 'success' : i.status === 'error' ? 'danger' : 'info'}>{i.status}</Badge>
                {i.status === 'error' && !validateMediaFile(i.file) && <Button type="button" variant="ghost" onClick={() => void upload(i)} aria-label={`Retry ${i.file.name}`}>Retry</Button>}
                <Button type="button" variant="ghost" onClick={() => setItems((l) => l.filter((x) => x.id !== i.id))} aria-label={`Remove ${i.file.name} from the list`}>✕</Button>
              </div>
              {i.status === 'uploading' && (
                <div role="progressbar" aria-label={`Uploading ${i.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={i.percent} className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-navy-100">
                  <div className="h-full bg-cobalt-500 transition-all" style={{ width: `${i.percent}%` }} />
                </div>
              )}
              {i.error && <p role="alert" className="mt-1 text-xs text-danger-600">{i.error}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
