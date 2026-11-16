'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useAgencyRequests, useCreateAgencyRequest, type AgencyRequestDto } from '@/lib/hooks/legal';
import { useExports } from '@/lib/hooks/packet-export';
import { Alert, Badge, Button, Card, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { dueLabel, fmtDate, humanize, shortId } from './util';

const KINDS = ['records', 'law_enforcement', 'inspection', 'subpoena'] as const;

/** p47 government restricted portal: my requests, new request with legal basis, gate notice, exports. */
export function GovRequests() {
  const { me } = useAuth();
  const canWrite = useCan('agency_request:write');
  const requests = useAgencyRequests();
  const exportsQ = useExports({}, useCan('export:request'));
  const completed = exportsQ.data ? exportsQ.data.pages.flatMap((p) => p.items).filter((j) => j.status === 'complete').length : 0;
  return (
    <>
      <PageHeader title="Agency requests" description={`Restricted portal for ${me?.actor.name ?? 'agency users'}. You only see requests you submitted and exports produced for them.`} />
      <Alert tone="warning" title="Stored-data gate">Platform data is never browsed directly. Each request goes through legal review and a data-minimization decision by counsel; approved records are produced as a hashed export manifest with an audit trail. Every access here is logged.</Alert>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="My requests">
            <StateView isLoading={requests.isLoading} error={requests.error} data={requests.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No requests yet', description: 'Submit a records or law-enforcement request with its legal basis.' }} onRetry={() => void requests.refetch()}>
              {(d) => (
                <Table<AgencyRequestDto> caption="My agency requests" rows={d.pages.flatMap((p) => p.items)} columns={[
                  { key: 'agency', header: 'Request', render: (r) => <div><p className="font-medium">{r.agencyName}</p><p className="text-xs text-muted">{humanize(r.kind)}{r.scopeJson.legalReference ? ` · ${r.scopeJson.legalReference}` : ''} · submitted {fmtDate(r.createdAt)}</p></div> },
                  { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge> },
                  { key: 'due', header: 'Due', render: (r) => { const l = dueLabel(r.dueAt); return ['fulfilled', 'closed', 'denied'].includes(r.status) ? <span className="text-xs text-muted">—</span> : <Badge tone={l.tone}>{l.text}</Badge>; } },
                  { key: 'export', header: 'Export', render: (r) => (r.exportJobId ? <Link className="text-xs text-cobalt-600 underline" href="/gov/exports">{shortId(r.exportJobId)}</Link> : <span className="text-xs text-muted">pending review</span>) },
                ]} />
              )}
            </StateView>
          </Card>
          <Card title="Exports" actions={<Link href="/gov/exports"><Button variant="secondary">Open exports</Button></Link>}>
            <p className="text-sm text-muted">{completed} completed export{completed === 1 ? '' : 's'} available for download. Manifests include files, hashes, the audit events and the reviewer who approved production.</p>
          </Card>
        </div>
        {canWrite && <NewRequestForm />}
      </div>
    </>
  );
}

function NewRequestForm() {
  const create = useCreateAgencyRequest();
  const [agencyName, setAgencyName] = useState('');
  const [kind, setKind] = useState<string>('records');
  const [legalBasis, setLegalBasis] = useState('');
  const [legalReference, setLegalReference] = useState('');
  const [description, setDescription] = useState('');
  const [propertyIds, setPropertyIds] = useState('');
  const reset = () => { setAgencyName(''); setKind('records'); setLegalBasis(''); setLegalReference(''); setDescription(''); setPropertyIds(''); };
  return (
    <Card title="New request">
      {create.isSuccess ? (
        <div className="space-y-3"><Alert tone="success" title="Request submitted for legal review">Reference {shortId(create.data.id, 12)}. Counsel will review scope and data minimization before any production.</Alert><Button variant="secondary" onClick={() => { create.reset(); reset(); }}>Submit another</Button></div>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate({ agencyName, kind, legalBasis, legalReference: legalReference || undefined, scopeJson: { description: description || undefined, propertyIds: propertyIds ? propertyIds.split(/[\s,]+/).filter(Boolean) : undefined } }); }}>
          <Input label="Agency name" required minLength={2} value={agencyName} onChange={(e) => setAgencyName(e.target.value)} />
          <Select label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</Select>
          <Input label="Legal basis" required minLength={10} value={legalBasis} onChange={(e) => setLegalBasis(e.target.value)} hint="Statute, ordinance, warrant or court order that authorizes the request." />
          <Input label="Legal reference" required={kind === 'law_enforcement'} value={legalReference} onChange={(e) => setLegalReference(e.target.value)} hint={kind === 'law_enforcement' ? 'Required: warrant, subpoena or court order number.' : 'Optional docket or case number.'} />
          <Input label="Scope description" value={description} onChange={(e) => setDescription(e.target.value)} hint="Describe the records needed as narrowly as possible." />
          <Input label="Property ids" value={propertyIds} onChange={(e) => setPropertyIds(e.target.value)} hint="Optional, comma separated." />
          {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not submit request'}>{create.error instanceof ApiError && create.error.body.fieldErrors?.map((f) => <p key={f.path} className="text-xs">{f.message}</p>)}</Alert>}
          <Button type="submit" loading={create.isPending}>Submit request</Button>
        </form>
      )}
    </Card>
  );
}
