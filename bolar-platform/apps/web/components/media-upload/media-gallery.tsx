'use client';
import { useAuth, useCan } from '@/lib/auth';
import { useDeleteMedia, useMedia, type MediaAssetDto } from '@/lib/hooks/media';
import { formatBytes } from '@/lib/hooks/document';
import { Badge, Button } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

/** Media gallery (Day 27): signed-URL previews for images, typed placeholders for video/PDF (thumbnails arrive with the media worker). */
export function MediaGallery({ ownerType, ownerId }: { ownerType: string; ownerId: string }) {
  const { me } = useAuth();
  const canWrite = useCan('media:write');
  const q = useMedia(ownerType, ownerId);
  const remove = useDeleteMedia();
  return (
    <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No media yet', description: 'Photos and files attached to this record will appear here.' }} onRetry={() => void q.refetch()} skeleton="cards">
      {(d) => (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Media">
            {d.pages.flatMap((p) => p.items).map((m: MediaAssetDto) => (
              <li key={m.id} className="overflow-hidden rounded-[14px] border border-line bg-surface">
                <Preview asset={m} />
                <div className="space-y-1 p-3 text-sm">
                  <p className="truncate font-medium" title={m.fileName}>{m.fileName}</p>
                  <p className="text-xs text-muted">{m.mimeType} · {formatBytes(m.sizeBytes)} · <Badge tone={m.status === 'uploaded' || m.status === 'processed' ? 'success' : m.status === 'failed' ? 'danger' : 'info'}>{m.status}</Badge></p>
                  <div className="flex gap-2 pt-1">
                    {m.downloadUrl && <a className="text-xs font-medium text-cobalt-600 underline" href={m.downloadUrl} target="_blank" rel="noopener noreferrer">Open</a>}
                    {canWrite && m.uploadedBy === me?.actor.id && <Button variant="ghost" onClick={() => remove.mutate(m.id)} aria-label={`Delete ${m.fileName}`}>Delete</Button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {q.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button></div>}
        </>
      )}
    </StateView>
  );
}

function Preview({ asset }: { asset: MediaAssetDto }) {
  if (asset.mimeType.startsWith('image/') && asset.downloadUrl) {
    return <img src={asset.downloadUrl} alt={asset.fileName} className="h-36 w-full object-cover" />;
  }
  const label = asset.mimeType === 'application/pdf' ? 'PDF' : asset.mimeType.startsWith('video/') ? 'Video' : 'File';
  return <div aria-hidden className="flex h-36 w-full items-center justify-center bg-navy-50 text-sm font-semibold uppercase tracking-wide text-muted">{label}</div>;
}
