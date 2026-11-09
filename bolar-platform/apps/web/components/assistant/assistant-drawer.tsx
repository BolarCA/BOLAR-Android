'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api-client';
import { PROMPT_SUGGESTIONS, sourceHref, useAiBudget, useAiCommand, useAiThread, useAiThreads, type AiContextDto, type AiMessageDto, type AiSourceDto, type AiThreadDetailDto, type AiToolCallDto } from '@/lib/hooks/ai';
import { Alert, Badge, Button, Drawer, Select, cn } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Assistant drawer (Days 61-74). Threads, composer, tool-call chips (ok/denied), source citations as record links,
 * "draft created, awaiting approval" cards and the org budget. It never offers send/approve actions: drafts are
 * reviewed in the notices queue by a human (p300).
 */
export function AssistantDrawer({ open, onClose, context }: { open: boolean; onClose: () => void; context: AiContextDto }) {
  if (!open) return null;
  return (
    <Drawer open onClose={onClose} title="Assistant">
      <AssistantPanel context={context} />
    </Drawer>
  );
}

function AssistantPanel({ context }: { context: AiContextDto }) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const threads = useAiThreads();
  const thread = useAiThread(threadId);
  const budget = useAiBudget();
  const run = useAiCommand();
  const listRef = useRef<HTMLDivElement>(null);
  const threadItems = threads.data?.pages.flatMap((p) => p.items) ?? [];
  const contextLabel = context.resourceType ? `${context.resourceType.replace('_', ' ')} · ${context.resourceId?.slice(0, 10)}…` : 'no record selected';
  const suggestions = PROMPT_SUGGESTIONS[context.resourceType ?? 'none'] ?? PROMPT_SUGGESTIONS.none!;
  const exhausted = budget.data?.exhausted ?? false;

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [thread.data?.messages.length, run.isPending]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || run.isPending) return;
    run.mutate({ threadId: threadId ?? undefined, command: trimmed, context }, { onSuccess: (res) => { setThreadId(res.thread.id); setCommand(''); } });
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); submit(command); };

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3 text-sm" data-testid="assistant-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={context.resourceType ? 'info' : 'neutral'}>Context: {contextLabel}</Badge>
        <BudgetIndicator budget={budget.data} />
      </div>
      <div className="flex items-end gap-2">
        <div className="grow">
          <Select label="Conversation" value={threadId ?? ''} onChange={(e) => setThreadId(e.target.value || null)}>
            <option value="">New conversation</option>
            {threadItems.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </Select>
        </div>
        {threadId && <Button variant="secondary" onClick={() => setThreadId(null)}>New</Button>}
      </div>

      <div ref={listRef} className="grow space-y-3 overflow-y-auto rounded-[14px] border border-line bg-navy-50/60 p-3" aria-live="polite" aria-label="Conversation messages">
        {!threadId && !run.isPending && (
          <div className="space-y-3">
            <p className="text-muted">Ask for a summary, due items, anomalies, a draft notice or email, an evidence packet outline or next steps. Every answer cites its sources; drafts wait for a human approver.</p>
            <ul className="flex flex-wrap gap-2" aria-label="Suggested prompts">
              {suggestions.map((s) => <li key={s}><Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => submit(s)}>{s}</Button></li>)}
            </ul>
          </div>
        )}
        {threadId && (
          <StateView isLoading={thread.isLoading} error={thread.error} data={thread.data} skeleton="list" onRetry={() => void thread.refetch()}>
            {(d) => <Messages detail={d} />}
          </StateView>
        )}
        {run.isPending && <p role="status" className="text-muted">Working…</p>}
        {run.isError && <CommandError error={run.error} />}
      </div>

      {exhausted && <Alert tone="warning" title="Monthly AI budget exhausted">Ask an administrator to raise the budget. Nothing is lost; existing conversations stay readable.</Alert>}
      <form onSubmit={onSubmit} className="space-y-2">
        <label htmlFor="assistant-command" className="block">
          <span className="mb-1 block font-medium text-navy-900">Ask the assistant</span>
          <textarea id="assistant-command" value={command} onChange={(e) => setCommand(e.target.value)} rows={2} maxLength={4000} disabled={exhausted} placeholder="e.g. Summarize this lease" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(command); } }} />
        </label>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted">Summaries, drafts and flags only. Humans approve everything.</p>
          <Button type="submit" loading={run.isPending} disabled={exhausted || !command.trim()}>Send</Button>
        </div>
      </form>
    </div>
  );
}

function BudgetIndicator({ budget }: { budget: { monthlyLimitCents: number; spentCents: number; period: string; exhausted: boolean } | undefined }) {
  if (!budget) return null;
  const pct = budget.monthlyLimitCents > 0 ? Math.min(100, Math.round((budget.spentCents / budget.monthlyLimitCents) * 100)) : 100;
  return (
    <div className="min-w-40 text-xs" data-testid="ai-budget">
      <div className="flex justify-between text-muted"><span>Budget {budget.period}</span><span>{money(budget.spentCents)} / {money(budget.monthlyLimitCents)}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-navy-100" role="progressbar" aria-label="AI budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={cn('h-full rounded-full', budget.exhausted ? 'bg-danger-600' : pct > 80 ? 'bg-orange-900' : 'bg-cobalt-500')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CommandError({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.code === 'rate_limited') return <Alert tone="warning" title="Budget exhausted">{error.message}</Alert>;
  if (error instanceof ApiError && error.isDenied) return <Alert tone="danger" title="Not available for your role">The assistant requires the ai:use permission.</Alert>;
  return <Alert tone="danger" title="The assistant could not answer">{error instanceof Error ? error.message : 'Unknown error'}</Alert>;
}

function Messages({ detail }: { detail: AiThreadDetailDto }) {
  if (detail.messages.length === 0) return <p className="text-muted">No messages yet.</p>;
  return (
    <ol className="space-y-3">
      {detail.messages.map((m) => <li key={m.id}><Message message={m} toolCalls={detail.toolCalls.filter((c) => c.messageId === m.id)} /></li>)}
    </ol>
  );
}

function Message({ message, toolCalls }: { message: AiMessageDto; toolCalls: AiToolCallDto[] }) {
  const isUser = message.role === 'user';
  const drafts = toolCalls.filter((c) => c.draftRef);
  return (
    <article className={cn('rounded-[14px] border p-3', isUser ? 'ml-6 border-cobalt-100 bg-cobalt-100/40' : 'mr-6 border-line bg-surface')} data-role={message.role} aria-label={isUser ? 'Your message' : 'Assistant answer'}>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{isUser ? 'You' : 'Assistant'}</p>
      {toolCalls.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1" aria-label="Tools used">
          {toolCalls.map((c) => <li key={c.id}><Badge tone={c.status === 'ok' ? 'success' : c.status === 'denied' ? 'danger' : 'warning'}>{c.tool} · {c.status}</Badge></li>)}
        </ul>
      )}
      <AnswerText text={message.content} />
      {drafts.map((c) => c.draftRef && (
        <div key={c.id} className="mt-3 rounded-lg border border-violet-100 bg-violet-100/50 p-3" data-testid="ai-draft-card">
          <p className="font-semibold text-navy-900">Draft created, awaiting approval</p>
          <p className="mt-1 text-ink">{c.draftRef.label}. A human must submit it and a different approver must approve it before anything is sent.</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link className="text-cobalt-600 underline" href={c.draftRef.href}>Review draft in notices</Link>
            <Link className="text-cobalt-600 underline" href="/compliance/notices">Approval queue</Link>
          </div>
        </div>
      ))}
      {!isUser && message.sources.length > 0 && <Sources sources={message.sources} />}
      {!isUser && message.model && <p className="mt-2 text-[11px] text-muted">{message.model} · {message.inputTokens ?? 0}+{message.outputTokens ?? 0} tokens · {money(message.costCents ?? 0)} · {message.redactionCount} redaction{message.redactionCount === 1 ? '' : 's'}</p>}
    </article>
  );
}

/** Light rendering of the assistant's plain text: **bold** titles, bullet lines, and the Sources line hidden (rendered as links). */
function AnswerText({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => !l.startsWith('Sources:'));
  return (
    <div className="space-y-1 whitespace-pre-wrap break-words">
      {lines.map((line, i) => {
        const bold = line.match(/^\*\*(.+)\*\*$/);
        if (bold) return <p key={i} className="font-semibold text-navy-900">{bold[1]}</p>;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

function Sources({ sources }: { sources: AiSourceDto[] }) {
  const seen = new Set<string>();
  const unique = sources.filter((s) => { const k = `${s.type}:${s.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-muted">Sources</p>
      <ul className="mt-1 flex flex-wrap gap-2" aria-label="Sources">
        {unique.map((s) => {
          const href = sourceHref(s);
          return <li key={`${s.type}:${s.id}`}>{href ? <Link href={href} className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-cobalt-600 hover:underline">{s.label}</Link> : <span className="rounded-full border border-line px-2.5 py-0.5 text-xs">{s.label}</span>}</li>;
        })}
      </ul>
    </div>
  );
}
