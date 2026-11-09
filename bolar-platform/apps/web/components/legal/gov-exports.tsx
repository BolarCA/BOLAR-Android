'use client';
import { useCan } from '@/lib/auth';
import { useExports, type ExportJobDto } from '@/lib/hooks/packet-export';
import { Alert, Badge, Button, PageHeader, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { ExportSummary } from './case-detail';
import { fmtDateTime, humanize, shortId } from './util';

/** p47 exports list: status, hashed manifest and download once the gate is cleared. */
export function GovExports() {
  const canRequest = useCan('export:request');
  const q = useExports({}, canRequest);
  if (!canRequest) return <Alert tone="info" title="No export access">Your role cannot request or download exports.</Alert>;
  return (
    <>
      <PageHeader title="Exports" description="Each export is a signed manifest (files, hashes, audit events, filters, redaction, reviewer). Downloads are short-lived links and every download is audited." />
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No exports yet', description: 'Exports appear after counsel approves a request and the packet job completes.' }} onRetry={() => void q.refetch()}>
        {(d) => (
          <>
            <Table<ExportJobDto> caption="Exports" rows={d.pages.flatMap((p) => p.items)} columns={[
              { key: 'kind', header: 'Export', render: (j) => <div><p className="font-medium">{humanize(j.kind)}</p><p className="text-xs text-muted">{humanize(j.sourceType)} {shortId(j.sourceId)} · requested {fmtDateTime(j.createdAt)}</p></div> },
              { key: 'status', header: 'Status', render: (j) => <Badge tone={statusTone(j.status)}>{j.status}</Badge> },
              { key: 'redaction', header: 'Redaction', render: (j) => <span className="text-xs">{j.redactionJson.fields?.length ? j.redactionJson.fields.join(', ') : 'none'}</span> },
              { key: 'manifest', header: 'Manifest', render: (j) => (j.status === 'complete' ? <ExportSummary id={j.id} /> : j.status === 'failed' ? <span className="text-xs text-danger-600">{j.error}</span> : <span className="text-xs text-muted">awaiting approval and processing</span>) },
            ]} />
            {q.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
    </>
  );
}
