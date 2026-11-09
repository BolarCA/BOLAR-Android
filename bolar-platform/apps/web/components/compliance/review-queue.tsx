'use client';
import { useMemo, useState } from 'react';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { dueTone, resourceHref, severityTone, useEvaluations, useResolveEvaluation, type RuleEvaluationDto } from '@/lib/hooks/compliance';
import { Alert, Button, Drawer, Modal, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { Pill } from './pill';
import { StateView } from '@/components/ui/state-view';

const SEVERITIES = ['', 'critical', 'high', 'medium', 'low'];
const DOMAINS = ['', 'rent', 'deposit', 'screening', 'notice', 'fair_housing', 'soi', 'privacy', 'maintenance'];
const RESULTS = ['', 'block', 'review', 'warn'];
type Resolution = 'accepted' | 'remediated' | 'overridden' | 'dismissed';

/** Blueprint p51 "Compliance review queue": rule hit, severity, due date, owner, evidence, action. */
export function ReviewQueue() {
  const canWrite = useCan('compliance:write');
  const canApprove = useCan('compliance:approve');
  const [severity, setSeverity] = useState('');
  const [domain, setDomain] = useState('');
  const [result, setResult] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const filters = useMemo(() => ({ severity: severity || undefined, domain: domain || undefined, result: result || undefined, reviewed: showResolved ? undefined : ('false' as const) }), [severity, domain, result, showResolved]);
  const q = useEvaluations(filters);
  const [evidence, setEvidence] = useState<RuleEvaluationDto | null>(null);
  const [resolving, setResolving] = useState<{ item: RuleEvaluationDto; resolution: Resolution } | null>(null);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const exportManifest = () => {
    const manifest = { generatedAt: new Date().toISOString(), filters, count: items.length, items: items.map((e) => ({ id: e.id, ruleKey: e.ruleKey, ruleVersion: e.ruleVersion, severity: e.severity, result: e.result, domain: e.domain, jurisdiction: e.jurisdiction, resourceType: e.resourceType, resourceId: e.resourceId, createdAt: e.createdAt, dueAt: e.dueAt, resolution: e.resolution, reviewedBy: e.reviewedBy, reviewedAt: e.reviewedAt, sourceUrl: e.sourceUrl, evidence: e.evidenceJson })) };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `compliance-manifest-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader title="Compliance review queue" description="Rule hits across leases, notices, screening and listings. Every hit carries source-linked evidence; humans resolve, AI only flags." actions={<Button variant="secondary" onClick={exportManifest} disabled={items.length === 0} data-testid="export-manifest">Export manifest</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>{SEVERITIES.map((s) => <option key={s} value={s}>{s || 'All severities'}</option>)}</Select>
        <Select label="Domain" value={domain} onChange={(e) => setDomain(e.target.value)}>{DOMAINS.map((d) => <option key={d} value={d}>{d ? d.replace(/_/g, ' ') : 'All domains'}</option>)}</Select>
        <Select label="Result" value={result} onChange={(e) => setResult(e.target.value)}>{RESULTS.map((r) => <option key={r} value={r}>{r || 'All results'}</option>)}</Select>
        <Select label="Status" value={showResolved ? 'all' : 'open'} onChange={(e) => setShowResolved(e.target.value === 'all')}><option value="open">Unresolved only</option><option value="all">Include resolved</option></Select>
      </div>
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void q.refetch()}
        empty={{ title: 'Queue is clear', description: 'No unresolved rule hits match these filters. New hits appear when leases, notices or screenings are evaluated.' }}>
        {() => (
          <>
            <Table<RuleEvaluationDto> caption="Compliance review queue" rows={items} columns={[
              { key: 'severity', header: 'Severity', render: (e) => <Pill tone={severityTone(e.severity)}>{e.severity}</Pill> },
              { key: 'rule', header: 'Rule', render: (e) => <div><p className="font-medium">{e.title}</p><p className="text-xs text-muted"><code>{e.ruleKey}</code> v{e.ruleVersion} · {e.jurisdiction} · {e.domain.replace(/_/g, ' ')}</p></div> },
              { key: 'result', header: 'Result', render: (e) => <Pill tone={statusTone(e.result)}>{e.result}</Pill> },
              { key: 'resource', header: 'Resource', render: (e) => { const href = resourceHref(e); const label = `${e.resourceType.replace(/_/g, ' ')} ${e.resourceId.slice(0, 10)}…`; return href ? <a className="text-cobalt-600 underline" href={href}>{label}</a> : <span>{label}</span>; } },
              { key: 'due', header: 'Due', render: (e) => <Pill tone={e.reviewedAt ? 'neutral' : dueTone(e.dueAt)}>{new Date(e.dueAt).toLocaleDateString()}</Pill> },
              { key: 'owner', header: 'Owner', render: (e) => (e.reviewedAt ? <span className="text-xs">{e.resolution} · {new Date(e.reviewedAt).toLocaleDateString()}</span> : <span className="text-xs text-muted">unassigned</span>) },
              { key: 'actions', header: 'Actions', className: 'text-right', render: (e) => (
                <div className="flex flex-wrap justify-end gap-1">
                  <Button variant="ghost" onClick={() => setEvidence(e)} aria-label={`Evidence for ${e.ruleKey}`}>Evidence</Button>
                  {canWrite && !e.reviewedAt && (<>
                    <Button variant="secondary" onClick={() => setResolving({ item: e, resolution: 'accepted' })} aria-label={`Accept ${e.ruleKey}`}>Accept</Button>
                    <Button variant="secondary" onClick={() => setResolving({ item: e, resolution: 'remediated' })} aria-label={`Mark remediated ${e.ruleKey}`}>Remediated</Button>
                    <Button variant="ghost" onClick={() => setResolving({ item: e, resolution: 'dismissed' })} aria-label={`Dismiss ${e.ruleKey}`}>Dismiss</Button>
                    {canApprove && <Button variant="danger" onClick={() => setResolving({ item: e, resolution: 'overridden' })} aria-label={`Override ${e.ruleKey}`}>Override</Button>}
                  </>)}
                </div>
              ) },
            ]} />
            {q.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      <EvidenceDrawer item={evidence} onClose={() => setEvidence(null)} />
      {resolving && <ResolveModal item={resolving.item} resolution={resolving.resolution} onClose={() => setResolving(null)} />}
    </>
  );
}

export function EvidenceDrawer({ item, onClose }: { item: RuleEvaluationDto | null; onClose: () => void }) {
  const ev = (item?.evidenceJson ?? {}) as { conditionsMatched?: string[]; facts?: Record<string, unknown>; matchedTerms?: string[]; description?: string; sourceUrl?: string | null };
  return (
    <Drawer open={Boolean(item)} onClose={onClose} title={item ? `Evidence: ${item.title}` : 'Evidence'}>
      {item && (
        <div className="space-y-5 text-sm" data-testid="evidence-drawer">
          <div className="flex flex-wrap gap-2"><Pill tone={severityTone(item.severity)}>{item.severity}</Pill><Pill tone={statusTone(item.result)}>{item.result}</Pill><Pill>{item.jurisdiction}</Pill><Pill>{item.domain.replace(/_/g, ' ')}</Pill></div>
          <p><code>{item.ruleKey}</code> version {item.ruleVersion}</p>
          {ev.description && <p className="text-ink">{ev.description}</p>}
          <section><h3 className="mb-1 font-semibold">Conditions matched</h3><ul className="list-disc space-y-1 pl-5">{(ev.conditionsMatched ?? []).map((c, i) => <li key={i}><code className="text-xs">{c}</code></li>)}</ul></section>
          {ev.matchedTerms && ev.matchedTerms.length > 0 && <section><h3 className="mb-1 font-semibold">Matched terms</h3><div className="flex flex-wrap gap-1">{ev.matchedTerms.map((t) => <Pill key={t} tone="warning">{t}</Pill>)}</div></section>}
          <section><h3 className="mb-1 font-semibold">Facts used</h3><dl className="grid grid-cols-2 gap-x-4 gap-y-1">{Object.entries(ev.facts ?? {}).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-all font-mono text-xs">{typeof v === 'string' ? v : JSON.stringify(v)}</dd></div>)}</dl></section>
          <section><h3 className="mb-1 font-semibold">Source</h3>{item.sourceUrl ? <a className="break-all text-cobalt-600 underline" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl}</a> : <span className="text-muted">No source linked</span>}</section>
          <p className="text-xs text-muted">Resource: {item.resourceType} {item.resourceId} · Raised {new Date(item.createdAt).toLocaleString()} · Due {new Date(item.dueAt).toLocaleDateString()}</p>
        </div>
      )}
    </Drawer>
  );
}

function ResolveModal({ item, resolution, onClose }: { item: RuleEvaluationDto; resolution: Resolution; onClose: () => void }) {
  const m = useResolveEvaluation();
  const [note, setNote] = useState('');
  const needsNote = resolution === 'overridden';
  const title = resolution === 'overridden' ? 'Override rule hit (approval required)' : `Mark as ${resolution}`;
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={needsNote ? 'danger' : 'primary'} loading={m.isPending} disabled={needsNote && note.trim().length < 10} onClick={() => m.mutate({ id: item.id, resolution, note: note || undefined }, { onSuccess: onClose })}>Confirm</Button></>}>
      <p className="text-sm"><code>{item.ruleKey}</code> v{item.ruleVersion} on {item.resourceType} {item.resourceId.slice(0, 12)}</p>
      {needsNote && <Alert tone="warning" title="Overrides are audited with your name and justification">Use only when a documented exemption applies. The rule stays in force for other records.</Alert>}
      <label className="mt-3 block text-sm">
        <span className="mb-1 block font-medium text-navy-900">Reviewer note {needsNote ? '(required, 10+ characters)' : '(optional)'}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-24 w-full rounded-lg border border-line bg-surface p-3 text-base" data-testid="resolve-note" />
      </label>
      {m.isError && <div className="mt-3"><Alert tone="danger" title={m.error instanceof ApiError ? m.error.message : 'Could not resolve'} /></div>}
    </Modal>
  );
}
