'use client';
import { useEffect, useState } from 'react';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { NOTICE_TEMPLATES, useCreateNotice, useNoticeAction, useNotices, type NoticeDto, type NoticeWithGuardDto } from '@/lib/hooks/notice';
import { useApplicationLookups } from '@/lib/hooks/screening';
import { Alert, Button, Drawer, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { Pill } from './pill';
import { StateView } from '@/components/ui/state-view';
import { NoticeReviewDrawer } from './notice-approvals';

/** /manager/notices: draft from a template, see guard hits immediately, submit for approval, send once approved. */
export function NoticesDrafting() {
  const canDraft = useCan('notice:draft');
  const canApprove = useCan('notice:approve');
  const q = useNotices();
  const act = useNoticeAction();
  const [draftOpen, setDraftOpen] = useState(false);
  const [selected, setSelected] = useState<NoticeDto | null>(null);
  useEffect(() => {
    const focus = new URLSearchParams(window.location.search).get('focus');
    if (!focus || selected) return;
    const found = q.data?.pages.flatMap((p) => p.items).find((n) => n.id === focus);
    if (found) setSelected(found);
  }, [q.data, selected]);
  return (
    <>
      <PageHeader title="Notices" description="Draft tenant notices from approved templates. The fair-housing and source-of-income guard runs on every draft; approval by a second person is required before sending." actions={canDraft && <Button onClick={() => setDraftOpen(true)}>Draft notice</Button>} />
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void q.refetch()} empty={{ title: 'No notices yet', description: 'Draft the first notice from a template.', action: canDraft && <Button onClick={() => setDraftOpen(true)}>Draft notice</Button> }}>
        {(d) => (
          <Table<NoticeDto> caption="Notices" rows={d.pages.flatMap((p) => p.items)} columns={[
            { key: 'recipient', header: 'Recipient', render: (n) => <div><p className="font-medium">{n.recipientName ?? n.recipientId}</p><p className="text-xs text-muted">{n.kind.replace(/_/g, ' ')} · {n.templateKey}</p></div> },
            { key: 'status', header: 'Status', render: (n) => <Pill tone={statusTone(n.status)}>{n.status.replace(/_/g, ' ')}</Pill> },
            { key: 'guard', header: 'Guard', render: (n) => (n.ruleEvaluationIds.length ? <Pill tone="warning">{n.ruleEvaluationIds.length} hit{n.ruleEvaluationIds.length > 1 ? 's' : ''}</Pill> : <Pill tone="success">clean</Pill>) },
            { key: 'updated', header: 'Updated', render: (n) => new Date(n.updatedAt).toLocaleDateString() },
            { key: 'actions', header: '', className: 'text-right', render: (n) => (
              <div className="flex flex-wrap justify-end gap-1">
                <Button variant="ghost" onClick={() => setSelected(n)} aria-label={`View notice for ${n.recipientName ?? n.recipientId}`}>View</Button>
                {canDraft && n.status === 'draft' && <Button variant="secondary" loading={act.isPending} onClick={() => act.mutate({ id: n.id, action: 'submit' })} aria-label={`Submit notice for ${n.recipientName ?? n.recipientId}`}>Submit for approval</Button>}
                {canDraft && n.status === 'approved' && <Button loading={act.isPending} onClick={() => act.mutate({ id: n.id, action: 'send' })} aria-label={`Send notice for ${n.recipientName ?? n.recipientId}`}>Send</Button>}
                {canDraft && n.status === 'rejected' && <Button variant="secondary" onClick={() => act.mutate({ id: n.id, action: 'reopen' })}>Reopen</Button>}
                {canDraft && ['draft', 'pending_approval', 'approved', 'rejected'].includes(n.status) && <Button variant="ghost" onClick={() => act.mutate({ id: n.id, action: 'cancel' })} aria-label={`Cancel notice for ${n.recipientName ?? n.recipientId}`}>Cancel</Button>}
              </div>
            ) },
          ]} />
        )}
      </StateView>
      {act.isError && <div className="mt-4"><Alert tone="danger" title={act.error instanceof ApiError ? act.error.message : 'Action failed'} /></div>}
      <DraftNoticeDrawer open={draftOpen} onClose={() => setDraftOpen(false)} />
      {selected && <NoticeReviewDrawer notice={selected} canApprove={canApprove} onClose={() => setSelected(null)} />}
    </>
  );
}

function DraftNoticeDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lookups = useApplicationLookups(open);
  const create = useCreateNotice();
  const [templateKey, setTemplateKey] = useState(NOTICE_TEMPLATES[0]!.key);
  const [recipientId, setRecipientId] = useState('');
  const [vars, setVars] = useState<Record<string, string>>({});
  const [entryLeadHours, setEntryLeadHours] = useState('48');
  const [emergency, setEmergency] = useState(false);
  const tpl = NOTICE_TEMPLATES.find((t) => t.key === templateKey) ?? NOTICE_TEMPLATES[0]!;
  const result: NoticeWithGuardDto | undefined = create.data;
  const reset = () => { create.reset(); setVars({}); onClose(); };
  return (
    <Drawer open={open} onClose={reset} title="Draft a notice">
      {result ? (
        <div className="space-y-4 text-sm">
          <Alert tone={result.result === 'allow' ? 'success' : result.result === 'block' ? 'danger' : 'warning'} title={result.result === 'allow' ? 'Draft saved; no guard hits' : result.result === 'block' ? 'Draft saved but blocked by a compliance rule' : 'Draft saved and routed to human review'}>
            {result.guard.flagged && (
              <ul className="mt-2 list-disc pl-5" data-testid="guard-hits">
                {result.guard.hits.map((h, i) => <li key={i}><strong>{h.term}</strong> flagged by <code>{h.ruleKey}</code> ({h.severity}) {h.sourceUrl && <a className="underline" href={h.sourceUrl} target="_blank" rel="noreferrer">source</a>}</li>)}
              </ul>
            )}
            {result.ruleHits.filter((h) => !result.guard.hits.some((g) => g.ruleKey === h.ruleKey)).map((h) => <p key={h.ruleKey} className="mt-1"><code>{h.ruleKey}</code> → {h.action}: {h.evidence.conditionsMatched.join('; ')}</p>)}
          </Alert>
          <pre className="whitespace-pre-wrap rounded-lg border border-line bg-navy-50 p-3 font-sans">{result.bodyDraft}</pre>
          <p className="text-xs text-muted">Review-level hits are shown to the approver. Block-level hits must be resolved in the compliance queue before this notice can be submitted.</p>
          <Button onClick={reset}>Done</Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); const variables: Record<string, string> = {}; for (const v of tpl.variables) variables[v] = vars[v] ?? ''; create.mutate({ kind: tpl.kind, templateKey: tpl.key, recipientId, variables, ...(tpl.kind === 'entry' ? { facts: { entryLeadHours: Number(entryLeadHours), emergency } } : {}) }); }}>
          <Select label="Template" value={templateKey} onChange={(e) => { setTemplateKey(e.target.value); setVars({}); }}>{NOTICE_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select>
          <Select label="Recipient" required value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
            <option value="">Select a tenant profile</option>
            {lookups.data?.applicants.map((a) => <option key={a.id} value={a.id}>{a.displayName} ({a.status})</option>)}
          </Select>
          {tpl.variables.map((v) => (v === 'body' ? (
            <label key={v} className="block text-sm"><span className="mb-1 block font-medium text-navy-900">Body</span><textarea required value={vars[v] ?? ''} onChange={(e) => setVars((s) => ({ ...s, [v]: e.target.value }))} className="min-h-28 w-full rounded-lg border border-line bg-surface p-3 text-base" /></label>
          ) : (
            <Input key={v} label={v.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())} value={vars[v] ?? ''} onChange={(e) => setVars((s) => ({ ...s, [v]: e.target.value }))} />
          )))}
          {tpl.kind === 'entry' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Entry lead time (hours)" type="number" min={0} value={entryLeadHours} onChange={(e) => setEntryLeadHours(e.target.value)} hint="Less than 24h is blocked unless emergency" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} />Emergency entry</label>
            </div>
          )}
          {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not draft notice'} />}
          <div className="flex gap-2"><Button type="submit" loading={create.isPending} disabled={!recipientId}>Save draft</Button><Button type="button" variant="secondary" onClick={reset}>Cancel</Button></div>
        </form>
      )}
    </Drawer>
  );
}
