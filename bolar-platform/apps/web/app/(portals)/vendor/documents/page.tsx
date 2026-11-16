'use client';
import { usePagedList } from '@/lib/hooks/iam';
import { Badge, PageHeader, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

interface DocRow { id: string; title: string; classification: string; category: string; createdAt: string; ownerType: string; ownerId: string }

/** Vendor documents: contracts, insurance certificates and warranty files shared with the vendor (blueprint p46). */
export default function VendorDocumentsPage() {
  const q = usePagedList<DocRow>(['documents', 'vendor'], '/documents', { ownerType: 'vendor' });
  return (
    <>
      <PageHeader title="Documents" description="Contracts, insurance certificates and warranty documents your property manager has shared with you. Download links expire after a few minutes." />
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No documents shared yet', description: 'Your manager can attach contracts and insurance certificates to your vendor profile.' }} onRetry={() => void q.refetch()}>
        {(d) => (
          <Table<DocRow> caption="Vendor documents" rows={d.pages.flatMap((p) => p.items)} columns={[
            { key: 'title', header: 'Document', render: (r) => r.title },
            { key: 'category', header: 'Category', render: (r) => <Badge>{r.category.replace(/_/g, ' ')}</Badge> },
            { key: 'class', header: 'Classification', render: (r) => <Badge tone={statusTone(r.classification)}>{r.classification}</Badge> },
            { key: 'created', header: 'Added', render: (r) => new Date(r.createdAt).toLocaleDateString() },
          ]} />
        )}
      </StateView>
    </>
  );
}
