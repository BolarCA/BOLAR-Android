'use client';
import { useState } from 'react';
import { useCan } from '@/lib/auth';
import { useAiAudit, type AiAuditRowDto } from '@/lib/hooks/ai';
import { Badge, Button, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { Denied, StateView } from '@/components/ui/state-view';

const TOOLS = ['summarize_lease', 'summarize_case', 'summarize_work_order', 'summarize_document', 'list_due_items', 'flag_anomalies', 'draft_notice', 'draft_email', 'prepare_packet_outline', 'recommend_next_steps'];
const money = (cents: number | null) => (cents === null ? '—' : `$${(cents / 100).toFixed(2)}`);

/** /admin/ai-audit and /compliance/ai-audit: AI commands with tools, model, tokens, cost and redaction counts; denied tool calls; budget refusals. */
export function AiAudit() {
  const canAudit = useCan('ai:audit');
  const [actorId, setActorId] = useState('');
  const [tool, setTool] = useState('');
  const [status, setStatus] = useState('');
  const q = useAiAudit({ actorId: actorId || undefined, tool: tool || undefined, status: status || undefined });
  if (!canAudit) return <Denied />;
  return (
    <>
      <PageHeader title="AI audit" description="Every assistant command is recorded with the tools it used, their outcomes, the model, token counts, cost and how many identifiers were redacted. Denied tool calls and budget refusals appear here too." />
      <div className="mb-4 grid max-w-3xl gap-3 sm:grid-cols-3">
        <Input label="Actor id" placeholder="user id" value={actorId} onChange={(e) => setActorId(e.target.value.trim())} />
        <Select label="Tool" value={tool} onChange={(e) => setTool(e.target.value)}>
          <option value="">Any tool</option>
          {TOOLS.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option><option value="ok">ok</option><option value="denied">denied</option><option value="error">error</option><option value="exceeded">budget exceeded</option>
        </Select>
      </div>
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No AI activity matches', description: 'Commands appear here as soon as someone uses the assistant.' }} onRetry={() => void q.refetch()}>
        {(d) => (
          <>
            <Table<AiAuditRowDto> caption="AI audit events" rows={d.pages.flatMap((p) => p.items)} columns={[
              { key: 'time', header: 'When', render: (r) => <span className="whitespace-nowrap text-xs">{new Date(r.createdAt).toLocaleString()}</span> },
              { key: 'actor', header: 'Actor', render: (r) => <span className="text-xs">{r.actorId ? `${r.actorId.slice(0, 10)}…` : 'system'}</span> },
              { key: 'action', header: 'Action', render: (r) => <div><code className="text-xs">{r.action}</code>{r.reason && <p className="text-xs text-muted">{r.reason}</p>}</div> },
              { key: 'tools', header: 'Tools', render: (r) => (r.tools.length ? <ul className="flex flex-wrap gap-1">{r.tools.map((t, i) => <li key={i}><Badge tone={statusTone(t.status === 'ok' ? 'allow' : t.status)}>{t.tool} · {t.status}</Badge></li>)}</ul> : <span className="text-xs text-muted">—</span>) },
              { key: 'outcome', header: 'Outcome', render: (r) => <Badge tone={statusTone(r.outcome)}>{r.outcome}</Badge> },
              { key: 'model', header: 'Model / tokens', render: (r) => <span className="text-xs">{r.model ?? '—'}{r.inputTokens !== null ? ` · ${r.inputTokens}+${r.outputTokens ?? 0}` : ''}</span> },
              { key: 'cost', header: 'Cost', render: (r) => <span className="text-xs">{money(r.costCents)}</span> },
              { key: 'redactions', header: 'Redactions', render: (r) => <span className="text-xs">{r.redactionCount ?? '—'}</span> },
              { key: 'thread', header: 'Thread', render: (r) => <span className="text-xs text-muted">{r.threadId ? `${r.threadId.slice(0, 10)}…` : '—'}</span> },
            ]} />
            {q.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
    </>
  );
}
