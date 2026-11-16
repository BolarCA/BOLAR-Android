'use client';
import { useState } from 'react';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useDeleteDocument, useDocuments, useDownloadUrl, type DocumentDto } from '@/lib/hooks/document';
import { Alert, Badge, Button, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView, ReviewRequired } from '@/components/ui/state-view';
import { UploadDrawer } from './upload-drawer';

const CATEGORIES = ['lease', 'id', 'screening_report', 'insurance', 'notice', 'invoice', 'general'];
const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'];

type RowState = { kind: 'link'; url: string; expiresAt: string } | { kind: 'review' } | { kind: 'error'; message: string };

const COPY = {
  manager: { title: 'Documents', description: 'Leases, certificates, notices and reports linked to properties, units, leases and tenants. Confidential and restricted files require an approved purpose to open; every download is audited.' },
  tenant: { title: 'My documents', description: 'Your lease and the documents shared with you. Download links expire after a few minutes; request access when a file is marked confidential.' },
  owner: { title: 'Documents', description: 'Documents for the properties you own. Confidential files need an approved purpose before they can be opened.' },
} as const;

/** Documents screen (Days 26/30) shared by manager, tenant and owner portals; the API scopes what each role sees. */
export function DocumentsList({ scope }: { scope: keyof typeof COPY }) {
  const { me } = useAuth();
  const canUpload = useCan('document:write') && scope === 'manager';
  const [category, setCategory] = useState('');
  const [classification, setClassification] = useState('');
  const [q, setQ] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const docs = useDocuments({ category: category || undefined, classification: classification || undefined, q: q || undefined });
  const download = useDownloadUrl();
  const remove = useDeleteDocument();

  async function onDownload(d: DocumentDto) {
    if (!d.currentVersionId) return;
    try {
      const r = await download.mutateAsync({ id: d.id, versionId: d.currentVersionId });
      setRowState((s) => ({ ...s, [d.id]: { kind: 'link', url: r.url, expiresAt: r.expiresAt } }));
    } catch (err) {
      if (err instanceof ApiError && err.isReviewRequired) setRowState((s) => ({ ...s, [d.id]: { kind: 'review' } }));
      else setRowState((s) => ({ ...s, [d.id]: { kind: 'error', message: err instanceof ApiError ? err.message : 'Could not create a download link' } }));
    }
  }

  return (
    <>
      <PageHeader title={COPY[scope].title} description={COPY[scope].description} actions={canUpload && <Button onClick={() => setUploadOpen(true)}>Upload document</Button>} />
      <div className="mb-4 grid max-w-3xl gap-3 sm:grid-cols-3">
        <Input id="documents-search" label="Search" placeholder="Title" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select id="documents-category" label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Any</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
        </Select>
        <Select id="documents-classification" label="Classification" value={classification} onChange={(e) => setClassification(e.target.value)}>
          <option value="">Any</option>{CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>
      <StateView isLoading={docs.isLoading} error={docs.error} data={docs.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void docs.refetch()}
        empty={{ title: 'No documents yet', description: scope === 'manager' ? 'Upload a lease, certificate or notice to get started.' : 'Documents shared with you will appear here.', action: canUpload && <Button onClick={() => setUploadOpen(true)}>Upload document</Button> }}>
        {(d) => (
          <>
            <Table<DocumentDto> caption="Documents" rows={d.pages.flatMap((p) => p.items)} columns={[
              { key: 'title', header: 'Document', render: (r) => <div><p className="font-medium">{r.title}</p><p className="text-xs text-muted">{r.ownerType.replace(/_/g, ' ')} · {r.ownerId.slice(0, 10)}…</p></div> },
              { key: 'category', header: 'Category', render: (r) => <Badge>{r.category.replace(/_/g, ' ')}</Badge> },
              { key: 'class', header: 'Classification', render: (r) => <div className="flex flex-col gap-1"><Badge tone={r.classification === 'restricted' ? 'danger' : r.classification === 'confidential' ? 'violet' : 'neutral'}>{r.classification}</Badge>{r.gated && <span className="text-xs text-muted">Approval required to open</span>}</div> },
              { key: 'status', header: 'Status', render: (r) => (r.legalHold ? <Badge tone="danger">legal hold</Badge> : r.currentVersionId ? <Badge tone={statusTone('clean')}>ready</Badge> : <Badge tone="info">upload pending</Badge>) },
              { key: 'updated', header: 'Updated', render: (r) => <span className="whitespace-nowrap text-xs">{new Date(r.updatedAt).toLocaleDateString()}</span> },
              { key: 'actions', header: '', className: 'text-right', render: (r) => (
                <div className="flex flex-col items-end gap-2">
                  <div className="flex gap-2">
                    {r.currentVersionId && <Button variant="secondary" onClick={() => void onDownload(r)} loading={download.isPending && download.variables?.id === r.id} aria-label={`Download ${r.title}`}>Download</Button>}
                    {canUpload && (r.createdBy === me?.actor.id || isStaffUser(me)) && <Button variant="ghost" onClick={() => { if (window.confirm(`Delete "${r.title}"?`)) remove.mutate(r.id, { onError: (err) => setRowState((s) => ({ ...s, [r.id]: { kind: 'error', message: err instanceof ApiError ? err.message : 'Delete failed' } })) }); }} aria-label={`Delete ${r.title}`}>Delete</Button>}
                  </div>
                  <RowFeedback state={rowState[r.id]} doc={r} />
                </div>
              ) },
            ]} />
            {docs.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void docs.fetchNextPage()} loading={docs.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      {canUpload && <UploadDrawer open={uploadOpen} onClose={() => setUploadOpen(false)} />}
    </>
  );
}

function isStaffUser(me: ReturnType<typeof useAuth>['me']): boolean {
  return Boolean(me?.roles.some((r) => ['org_admin', 'subaccount_admin', 'property_manager'].includes(r.role as string)));
}

function RowFeedback({ state, doc }: { state: RowState | undefined; doc: DocumentDto }) {
  if (!state) return null;
  if (state.kind === 'link') {
    return (
      <p className="max-w-xs text-right text-xs" data-testid={`download-link-${doc.id}`}>
        <a className="font-medium text-cobalt-600 underline" href={state.url} target="_blank" rel="noopener noreferrer">Open signed link</a>
        <span className="block text-muted">Expires {new Date(state.expiresAt).toLocaleTimeString()}</span>
      </p>
    );
  }
  if (state.kind === 'review') return <div className="w-full max-w-md text-left"><ReviewRequired resource={{ type: 'document', id: doc.id, classification: doc.classification === 'restricted' ? 'restricted' : 'confidential' }} /></div>;
  return <div className="w-full max-w-md text-left"><Alert tone="danger" title={state.message} /></div>;
}
