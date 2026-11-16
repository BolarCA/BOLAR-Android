'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAuth, useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useCreateTemplate, useCreateTemplateVersion, useRenderTemplate, useTemplate, useTemplateTransition, useTemplates, variablesOf, type TemplateDto, type TemplateVersionDto } from '@/lib/hooks/template';
import { Alert, Badge, Button, Card, Drawer, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';

const CHANNELS = ['email', 'sms', 'document', 'notice'];

/** Template registry (Day 29): platform + org templates, version drawer with preview, approval actions, render preview. */
export function TemplatesAdmin() {
  const canWrite = useCan('template:write');
  const [scope, setScope] = useState('');
  const [channel, setChannel] = useState('');
  const [risk, setRisk] = useState('');
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useTemplates({ scope: scope || undefined, channel: channel || undefined, riskLevel: risk || undefined, q: q || undefined });

  return (
    <>
      <PageHeader title="Templates" description="Email, SMS, document and notice templates. Low-risk templates publish on submit; high-risk templates (notices, FCRA, privacy) need approval from legal or compliance before they can be rendered." actions={canWrite && <Button onClick={() => setCreateOpen(true)}>New template</Button>} />
      <div className="mb-4 grid max-w-4xl gap-3 sm:grid-cols-4">
        <Input id="templates-search" label="Search" placeholder="Key or name" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select id="templates-scope" label="Scope" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">All</option><option value="org">Organization</option><option value="platform">Platform</option></Select>
        <Select id="templates-channel" label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">Any</option>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
        <Select id="templates-risk" label="Risk" value={risk} onChange={(e) => setRisk(e.target.value)}><option value="">Any</option><option value="low">low</option><option value="high">high</option></Select>
      </div>
      <StateView isLoading={list.isLoading} error={list.error} data={list.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No templates match', description: 'Create an organization template or clear the filters.' }} onRetry={() => void list.refetch()}>
        {(d) => (
          <>
            <Table<TemplateDto> caption="Templates" rows={d.pages.flatMap((p) => p.items)} onRowClick={(t) => setSelected(t.id)} columns={[
              { key: 'name', header: 'Template', render: (t) => <div><p className="font-medium">{t.name}</p><code className="text-xs text-muted">{t.key}</code></div> },
              { key: 'scope', header: 'Scope', render: (t) => <Badge tone={t.scope === 'platform' ? 'violet' : 'info'}>{t.scope}</Badge> },
              { key: 'channel', header: 'Channel', render: (t) => t.channel },
              { key: 'risk', header: 'Risk', render: (t) => <Badge tone={t.riskLevel === 'high' ? 'violet' : 'neutral'}>{t.riskLevel}</Badge> },
              { key: 'version', header: 'Approved v.', render: (t) => (t.currentVersion > 0 ? `v${t.currentVersion}` : '—') },
              { key: 'latest', header: 'Latest', render: (t) => (t.latestStatus ? <Badge tone={statusTone(t.latestStatus)}>{t.latestStatus.replace(/_/g, ' ')}</Badge> : '—') },
              { key: 'open', header: '', className: 'text-right', render: (t) => <Button variant="ghost" onClick={(e) => { e.stopPropagation(); setSelected(t.id); }} aria-label={`Open ${t.name}`}>Open</Button> },
            ]} />
            {list.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      <CreateTemplateDrawer open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => { setCreateOpen(false); setSelected(id); }} />
      <TemplateDrawer id={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function parseVariables(s: string): string[] | undefined {
  const list = s.split(/[,\s]+/).map((v) => v.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

function CreateTemplateDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const create = useCreateTemplate();
  const [form, setForm] = useState({ key: '', name: '', channel: 'email', riskLevel: 'low' as 'low' | 'high', jurisdiction: '', subject: '', body: '', variables: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Drawer open={open} onClose={onClose} title="New template">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ key: form.key.trim(), name: form.name.trim(), channel: form.channel, riskLevel: form.riskLevel, jurisdiction: form.jurisdiction.trim() || undefined, subject: form.subject.trim() || undefined, body: form.body, variables: parseVariables(form.variables) }, { onSuccess: (t) => { onCreated(t.id); create.reset(); } }); }}>
        <Input id="new-template-key" label="Key" required value={form.key} onChange={set('key')} hint="Lowercase, dot separated, e.g. notice.late_rent" pattern="^[a-z0-9]+([._-][a-z0-9]+)*$" />
        <Input id="new-template-name" label="Name" required value={form.name} onChange={set('name')} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select id="new-template-channel" label="Channel" value={form.channel} onChange={set('channel')}>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
          <Select id="new-template-risk" label="Risk level" value={form.riskLevel} onChange={set('riskLevel')}><option value="low">low (auto-approve)</option><option value="high">high (legal approval)</option></Select>
          <Input id="new-template-jurisdiction" label="Jurisdiction" value={form.jurisdiction} onChange={set('jurisdiction')} placeholder="US-TX" />
        </div>
        <Input id="new-template-subject" label="Subject" value={form.subject} onChange={set('subject')} hint="Optional; supports {{variables}}" />
        <label htmlFor="new-template-body" className="block text-sm">
          <span className="mb-1 block font-medium text-navy-900">Body</span>
          <textarea id="new-template-body" required value={form.body} onChange={set('body')} className="min-h-32 w-full rounded-lg border border-line bg-surface p-3 font-mono text-sm" placeholder="Dear {{tenantName}}, ..." />
        </label>
        <Input id="new-template-variables" label="Declared variables" value={form.variables} onChange={set('variables')} hint="Comma separated; placeholders in the body are detected automatically" />
        {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not create template'}>{create.error instanceof ApiError && create.error.body.fieldErrors?.map((f) => <p key={f.path} className="text-xs">{f.path}: {f.message}</p>)}</Alert>}
        <div className="flex gap-2"><Button type="submit" loading={create.isPending}>Create draft</Button><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button></div>
      </form>
    </Drawer>
  );
}

function TemplateDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { me } = useAuth();
  const canWrite = useCan('template:write');
  const canApprove = useCan('template:approve');
  const q = useTemplate(id);
  const transition = useTemplateTransition();
  const addVersion = useCreateTemplateVersion();
  const [activeVersion, setActiveVersion] = useState<string | null>(null);
  const [newBody, setNewBody] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [showNew, setShowNew] = useState(false);
  useEffect(() => { setActiveVersion(null); setShowNew(false); }, [id]);
  const version: TemplateVersionDto | undefined = useMemo(() => q.data?.versions.find((v) => v.id === activeVersion) ?? q.data?.versions[0], [q.data, activeVersion]);
  const editable = q.data?.scope === 'org' || Boolean(me?.actor.isPlatform);

  return (
    <Drawer open={!!id} onClose={onClose} title={q.data ? q.data.name : 'Template'}>
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} onRetry={() => void q.refetch()} skeleton="detail">
        {(t) => (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2 text-sm">
              <code className="rounded bg-navy-50 px-2 py-1 text-xs">{t.key}</code>
              <Badge tone={t.scope === 'platform' ? 'violet' : 'info'}>{t.scope}</Badge><Badge>{t.channel}</Badge>
              <Badge tone={t.riskLevel === 'high' ? 'violet' : 'neutral'}>{t.riskLevel} risk</Badge>{t.jurisdiction && <Badge>{t.jurisdiction}</Badge>}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-navy-900">Versions</p>
              <ul className="flex flex-wrap gap-2" aria-label="Versions">
                {t.versions.map((v) => (
                  <li key={v.id}>
                    <button type="button" aria-pressed={version?.id === v.id} onClick={() => setActiveVersion(v.id)} className={`rounded-lg border px-3 py-1.5 text-sm ${version?.id === v.id ? 'border-cobalt-500 bg-cobalt-100/60' : 'border-line bg-surface'}`}>
                      v{v.version} <Badge tone={statusTone(v.status)}>{v.status.replace(/_/g, ' ')}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {version && (
              <Card title={`Version ${version.version} preview`} actions={<Badge tone={statusTone(version.status)}>{version.status.replace(/_/g, ' ')}</Badge>}>
                {version.subject && <p className="mb-2 text-sm"><span className="font-medium">Subject:</span> {version.subject}</p>}
                <pre className="whitespace-pre-wrap rounded-lg bg-navy-50 p-3 text-sm" data-testid="version-body">{version.body}</pre>
                <p className="mt-2 text-xs text-muted">Variables: {variablesOf(version).join(', ') || 'none'}{version.approvedAt ? ` · approved ${new Date(version.approvedAt).toLocaleDateString()}` : ''}</p>
                {editable && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {version.status === 'draft' && canWrite && <Button onClick={() => transition.mutate({ id: t.id, versionId: version.id, action: 'submit' })} loading={transition.isPending}>Submit for approval</Button>}
                    {version.status === 'pending_approval' && canApprove && version.createdBy !== me?.actor.id && (
                      <>
                        <Button onClick={() => transition.mutate({ id: t.id, versionId: version.id, action: 'approve' })} loading={transition.isPending}>Approve</Button>
                        <Button variant="danger" onClick={() => transition.mutate({ id: t.id, versionId: version.id, action: 'reject' })} loading={transition.isPending}>Reject</Button>
                      </>
                    )}
                    {version.status === 'pending_approval' && (!canApprove || version.createdBy === me?.actor.id) && <Alert tone="info" title="Awaiting approval">A reviewer with the approve permission who is not the author must approve this {t.riskLevel}-risk version.</Alert>}
                  </div>
                )}
                {transition.isError && <div className="mt-3"><Alert tone="danger" title={transition.error instanceof ApiError ? transition.error.message : 'Action failed'} /></div>}
              </Card>
            )}
            {editable && canWrite && (
              <Card title="New version" actions={<Button variant="ghost" onClick={() => setShowNew((s) => !s)} aria-expanded={showNew}>{showNew ? 'Hide' : 'Draft a new version'}</Button>}>
                {showNew ? (
                  <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); addVersion.mutate({ id: t.id, subject: newSubject.trim() || undefined, body: newBody }, { onSuccess: (d) => { setShowNew(false); setNewBody(''); setNewSubject(''); setActiveVersion(d.versions[0]?.id ?? null); } }); }}>
                    <Input id="new-version-subject" label="Subject" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />
                    <label htmlFor="new-version-body" className="block text-sm"><span className="mb-1 block font-medium text-navy-900">Body</span><textarea id="new-version-body" required value={newBody} onChange={(e) => setNewBody(e.target.value)} className="min-h-28 w-full rounded-lg border border-line bg-surface p-3 font-mono text-sm" /></label>
                    {addVersion.isError && <Alert tone="danger" title={addVersion.error instanceof ApiError ? addVersion.error.message : 'Could not save version'} />}
                    <Button type="submit" loading={addVersion.isPending}>Save draft</Button>
                  </form>
                ) : <p className="text-sm text-muted">Drafts start unpublished; the approved version keeps rendering until a new one is approved.</p>}
              </Card>
            )}
            <RenderPreview templateKey={t.key} version={version} />
          </div>
        )}
      </StateView>
    </Drawer>
  );
}

function RenderPreview({ templateKey, version }: { templateKey: string; version: TemplateVersionDto | undefined }) {
  const render = useRenderTemplate();
  const names = useMemo(() => (version ? variablesOf(version) : []), [version]);
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => { setValues({}); render.reset(); }, [version?.id]);
  return (
    <Card title="Render preview">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); render.mutate({ key: templateKey, variables: values }); }}>
        {names.length === 0 && <p className="text-sm text-muted">This version has no variables.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {names.map((n) => <Input key={n} id={`render-var-${n}`} label={n} value={values[n] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))} />)}
        </div>
        <Button type="submit" variant="secondary" loading={render.isPending}>Render</Button>
        {render.isError && (
          <Alert tone="danger" title={render.error instanceof ApiError ? render.error.message : 'Render failed'}>
            {render.error instanceof ApiError && render.error.body.fieldErrors?.map((f) => <p key={f.path} className="text-xs">{f.path.replace('variables.', '')}: {f.message}</p>)}
          </Alert>
        )}
        {render.isSuccess && (
          <div className="rounded-lg border border-line bg-surface p-3 text-sm" data-testid="render-output">
            <p className="text-xs text-muted">Rendered from approved v{render.data.version}</p>
            {render.data.subject && <p className="mt-1 font-medium">{render.data.subject}</p>}
            <p className="mt-1 whitespace-pre-wrap">{render.data.body}</p>
          </div>
        )}
      </form>
    </Card>
  );
}
