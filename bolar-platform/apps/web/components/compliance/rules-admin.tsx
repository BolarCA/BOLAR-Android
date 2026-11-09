'use client';
import { useMemo, useState } from 'react';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { severityTone, useCreateRule, useNewRuleVersion, usePreviewEvaluate, useRuleAction, useRules, type ComplianceRuleDto } from '@/lib/hooks/compliance';
import { Alert, Button, Card, Drawer, Input, PageHeader, Select, statusTone } from '@/components/ui';
import { Pill } from './pill';
import { StateView } from '@/components/ui/state-view';

const DOMAINS = ['rent', 'deposit', 'screening', 'notice', 'fair_housing', 'soi', 'privacy', 'maintenance'];
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const ACTIONS = ['allow', 'warn', 'block', 'review'];

/** /compliance/rules: catalog grouped by jurisdiction and domain with versions, activate/retire and a new-version editor. */
export function RulesAdmin() {
  const canApprove = useCan('compliance:approve');
  const q = useRules();
  const act = useRuleAction();
  const [editing, setEditing] = useState<ComplianceRuleDto | 'new' | null>(null);
  const grouped = useMemo(() => {
    const rules = q.data?.pages.flatMap((p) => p.items) ?? [];
    const byJur = new Map<string, Map<string, ComplianceRuleDto[]>>();
    for (const r of rules) {
      const dom = byJur.get(r.jurisdiction) ?? new Map<string, ComplianceRuleDto[]>();
      dom.set(r.domain, [...(dom.get(r.domain) ?? []), r]);
      byJur.set(r.jurisdiction, dom);
    }
    return [...byJur.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [q.data]);

  return (
    <>
      <PageHeader title="Compliance rules" description="Versioned, source-linked rule catalog. Drafts need a second accountable approver before they take effect; counsel review is required before production." actions={canApprove && <Button onClick={() => setEditing('new')}>New rule</Button>} />
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void q.refetch()} empty={{ title: 'No rules in the catalog', description: 'Seed the starter rules or create the first rule.' }}>
        {() => (
          <div className="space-y-6">
            {grouped.map(([jurisdiction, domains]) => (
              <Card key={jurisdiction} title={jurisdiction}>
                <div className="space-y-4">
                  {[...domains.entries()].map(([domain, rules]) => (
                    <section key={domain}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{domain.replace(/_/g, ' ')}</h3>
                      <ul className="divide-y divide-line rounded-lg border border-line">
                        {rules.map((r) => (
                          <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium">{r.title} <span className="text-muted">v{r.version}</span></p>
                              <p className="text-xs text-muted"><code>{r.key}</code> · effective {new Date(r.effectiveFrom).toLocaleDateString()}{r.effectiveTo ? ` to ${new Date(r.effectiveTo).toLocaleDateString()}` : ''}{r.sourceUrl && <> · <a className="text-cobalt-600 underline" href={r.sourceUrl} target="_blank" rel="noreferrer">source</a></>}</p>
                              <div className="mt-1 flex flex-wrap gap-1"><Pill tone={statusTone(r.status)}>{r.status}</Pill><Pill tone={severityTone(r.severity)}>{r.severity}</Pill><Pill tone={statusTone(r.action)}>{r.action}</Pill></div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {canApprove && <Button variant="secondary" onClick={() => setEditing(r)} aria-label={`New version of ${r.key}`}>New version</Button>}
                              {canApprove && r.status === 'draft' && <Button onClick={() => act.mutate({ id: r.id, action: 'activate' })} aria-label={`Activate ${r.key} v${r.version}`}>Activate</Button>}
                              {canApprove && r.status !== 'retired' && <Button variant="ghost" onClick={() => act.mutate({ id: r.id, action: 'retire' })} aria-label={`Retire ${r.key} v${r.version}`}>Retire</Button>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </Card>
            ))}
            {act.isError && <Alert tone="danger" title={act.error instanceof ApiError ? act.error.message : 'Action failed'} />}
            {q.hasNextPage && <Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button>}
          </div>
        )}
      </StateView>
      {editing && <RuleEditor base={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RuleEditor({ base, onClose }: { base: ComplianceRuleDto | null; onClose: () => void }) {
  const create = useCreateRule();
  const newVersion = useNewRuleVersion();
  const preview = usePreviewEvaluate();
  const [key, setKey] = useState(base?.key ?? '');
  const [jurisdiction, setJurisdiction] = useState(base?.jurisdiction ?? 'US');
  const [domain, setDomain] = useState<string>(base?.domain ?? 'rent');
  const [title, setTitle] = useState(base?.title ?? '');
  const [description, setDescription] = useState(base?.description ?? '');
  const [severity, setSeverity] = useState<string>(base?.severity ?? 'medium');
  const [action, setAction] = useState<string>(base?.action ?? 'warn');
  const [sourceUrl, setSourceUrl] = useState(base?.sourceUrl ?? '');
  const [conditions, setConditions] = useState(JSON.stringify(base?.conditions ?? { all: [{ field: 'rentCents', op: 'gt', value: 100000 }] }, null, 2));
  const [facts, setFacts] = useState('{\n  "rentCents": 180000,\n  "depositCents": 360000\n}');
  const parse = (s: string): { value?: Record<string, unknown>; error?: string } => { try { const v = JSON.parse(s) as unknown; if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'Must be a JSON object' }; return { value: v as Record<string, unknown> }; } catch (e) { return { error: (e as Error).message }; } };
  const cond = parse(conditions);
  const fct = parse(facts);
  const m = base ? newVersion : create;
  const submit = () => {
    if (!cond.value) return;
    const common = { jurisdiction, domain, title, description, severity, action, conditions: cond.value, sourceUrl: sourceUrl || null };
    if (base) newVersion.mutate({ id: base.id, ...common }, { onSuccess: onClose });
    else create.mutate({ key, ...common }, { onSuccess: onClose });
  };
  return (
    <Drawer open onClose={onClose} title={base ? `New version of ${base.key} (v${base.version + 1}+)` : 'New compliance rule'}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {!base && <Input label="Key" required value={key} onChange={(e) => setKey(e.target.value)} hint="lower-case, e.g. us-ca.rent.increase_cap" />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Jurisdiction" required value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value.toUpperCase())} hint="US, US-CA, US-CA-LOS_ANGELES" />
          <Select label="Domain" value={domain} onChange={(e) => setDomain(e.target.value)}>{DOMAINS.map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}</Select>
          <Select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>{SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
          <Select label="Action" value={action} onChange={(e) => setAction(e.target.value)}>{ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
        </div>
        <Input label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="block text-sm"><span className="mb-1 block font-medium text-navy-900">Description</span><textarea required value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-20 w-full rounded-lg border border-line bg-surface p-3 text-base" /></label>
        <Input label="Source URL" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} hint="Statute, regulation or guidance this rule implements" />
        <label className="block text-sm"><span className="mb-1 block font-medium text-navy-900">Conditions (JSON)</span><textarea value={conditions} onChange={(e) => setConditions(e.target.value)} spellCheck={false} className="min-h-40 w-full rounded-lg border border-line bg-surface p-3 font-mono text-xs" aria-invalid={Boolean(cond.error)} />{cond.error && <span role="alert" className="mt-1 block text-xs text-danger-600">{cond.error}</span>}</label>
        <Card title="Preview against sample facts">
          <label className="block text-sm"><span className="mb-1 block font-medium text-navy-900">Sample facts (JSON)</span><textarea value={facts} onChange={(e) => setFacts(e.target.value)} spellCheck={false} className="min-h-24 w-full rounded-lg border border-line bg-surface p-3 font-mono text-xs" />{fct.error && <span role="alert" className="mt-1 block text-xs text-danger-600">{fct.error}</span>}</label>
          <Button type="button" variant="secondary" className="mt-3" disabled={!cond.value || !fct.value} loading={preview.isPending} onClick={() => cond.value && fct.value && preview.mutate({ domain, jurisdiction, facts: fct.value, candidate: { key: key || base?.key || 'draft.candidate', action, severity, conditions: cond.value, jurisdiction, domain, title: title || 'Draft rule' } })}>Evaluate preview</Button>
          {preview.data && (
            <div className="mt-3 space-y-2 text-sm" aria-live="polite">
              <p>Result: <Pill tone={statusTone(preview.data.result)}>{preview.data.result}</Pill> · chain {preview.data.jurisdictionChain.join(' › ')} · {preview.data.rulesConsidered} rules considered (nothing persisted)</p>
              {preview.data.hits.length === 0 ? <p className="text-muted">No rule hits for these facts.</p> : <ul className="list-disc pl-5">{preview.data.hits.map((h) => <li key={`${h.ruleKey}${h.ruleVersion}`}><code>{h.ruleKey}</code> v{h.ruleVersion} → {h.action}: {h.evidence.conditionsMatched.join('; ')}</li>)}</ul>}
            </div>
          )}
          {preview.isError && <div className="mt-3"><Alert tone="danger" title={preview.error instanceof ApiError ? preview.error.message : 'Preview failed'} /></div>}
        </Card>
        {m.isError && <Alert tone="danger" title={m.error instanceof ApiError ? m.error.message : 'Could not save rule'}>{m.error instanceof ApiError && m.error.body.fieldErrors?.map((f) => <p key={f.path} className="text-xs">{f.path}: {f.message}</p>)}</Alert>}
        <div className="flex gap-2"><Button type="submit" loading={m.isPending} disabled={!cond.value}>{base ? 'Create draft version' : 'Create draft rule'}</Button><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button></div>
        <p className="text-xs text-muted">Drafts never evaluate. A different approver activates the version; the previous active version is retired automatically.</p>
      </form>
    </Drawer>
  );
}
