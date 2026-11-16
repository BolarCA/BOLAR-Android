'use client';
import { useState } from 'react';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useOrgs } from '@/lib/hooks/iam';
import { useCreateFeatureFlag, useFeatureFlags, useUpdateFeatureFlag, type FeatureFlagDto } from '@/lib/hooks/platform';
import { Alert, Badge, Button, Drawer, Input, PageHeader, Select, Table } from '@/components/ui';
import { Denied, StateView } from '@/components/ui/state-view';

/** Feature flags (Day 51): global flags apply everywhere; an org-scoped flag overrides the global value for that org. */
export default function FeatureFlagsPage() {
  const canWrite = useCan('feature_flag:write');
  const isPlatform = useCan('platform:admin');
  const [scope, setScope] = useState('all');
  const [key, setKey] = useState('');
  const [open, setOpen] = useState(false);
  const flags = useFeatureFlags({ scope: scope !== 'all' ? scope : undefined, key: key || undefined });
  const update = useUpdateFeatureFlag();
  if (!canWrite) return <Denied />;
  return (
    <>
      <PageHeader title="Feature flags" description="Roll features out globally or per organization. Changes are audited and published so running services pick them up." actions={<Button onClick={() => setOpen(true)}>New flag</Button>} />
      <div className="mb-4 grid max-w-xl gap-3 sm:grid-cols-2">
        <Input label="Key contains" placeholder="e.g. ops." value={key} onChange={(e) => setKey(e.target.value)} />
        <Select label="Scope" value={scope} onChange={(e) => setScope(e.target.value)} disabled={!isPlatform}>
          <option value="all">All</option><option value="global">Global only</option><option value="org">Org overrides only</option>
        </Select>
      </div>
      {update.isError && <div className="mb-4"><Alert tone="danger" title={update.error instanceof ApiError ? update.error.message : 'Update failed'} /></div>}
      <StateView isLoading={flags.isLoading} error={flags.error} data={flags.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: 'No feature flags', description: 'Create the first flag to start a staged rollout.', action: <Button onClick={() => setOpen(true)}>New flag</Button> }} onRetry={() => void flags.refetch()}>
        {(d) => (
          <>
            <Table<FeatureFlagDto> caption="Feature flags" rows={d.pages.flatMap((p) => p.items)} columns={[
              { key: 'key', header: 'Key', render: (f) => <code className="text-sm">{f.key}</code> },
              { key: 'scope', header: 'Scope', render: (f) => (f.tenantOrgId ? <Badge tone="violet">{f.orgSlug ?? f.tenantOrgId}</Badge> : <Badge tone="info">global</Badge>) },
              { key: 'enabled', header: 'State', render: (f) => <Badge tone={f.enabled ? 'success' : 'neutral'}>{f.enabled ? 'enabled' : 'disabled'}</Badge> },
              { key: 'rules', header: 'Rules', render: (f) => <code className="text-xs text-muted">{JSON.stringify(f.rules)}</code> },
              { key: 'updated', header: 'Updated', render: (f) => <span className="text-xs">{new Date(f.updatedAt).toLocaleString()}</span> },
              { key: 'actions', header: '', className: 'text-right', render: (f) => <Button variant="secondary" onClick={() => update.mutate({ id: f.id, enabled: !f.enabled })} aria-label={`${f.enabled ? 'Disable' : 'Enable'} ${f.key}${f.orgSlug ? ` for ${f.orgSlug}` : ''}`} loading={update.isPending && update.variables?.id === f.id}>{f.enabled ? 'Disable' : 'Enable'}</Button> },
            ]} />
            {flags.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void flags.fetchNextPage()} loading={flags.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      <CreateFlagDrawer open={open} onClose={() => setOpen(false)} isPlatform={isPlatform} />
    </>
  );
}

function CreateFlagDrawer({ open, onClose, isPlatform }: { open: boolean; onClose: () => void; isPlatform: boolean }) {
  const create = useCreateFeatureFlag();
  const orgs = useOrgs();
  const [form, setForm] = useState({ key: '', enabled: false, tenantOrgId: '', rules: '{}' });
  const [rulesError, setRulesError] = useState<string | undefined>();
  const submit = () => {
    let rules: Record<string, unknown> = {};
    try { rules = form.rules.trim() ? (JSON.parse(form.rules) as Record<string, unknown>) : {}; setRulesError(undefined); } catch { setRulesError('Rules must be valid JSON'); return; }
    create.mutate({ key: form.key, enabled: form.enabled, rules, tenantOrgId: form.tenantOrgId || undefined });
  };
  return (
    <Drawer open={open} onClose={onClose} title="New feature flag">
      {create.isSuccess ? (
        <div className="space-y-4"><Alert tone="success" title={`Flag ${create.data.key} created`}>{create.data.tenantOrgId ? `Scoped to ${create.data.orgSlug}.` : 'Global flag.'}</Alert><Button onClick={() => { create.reset(); setForm({ key: '', enabled: false, tenantOrgId: '', rules: '{}' }); onClose(); }}>Done</Button></div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Input label="Key" required pattern="^[a-z][a-z0-9_.\-]{1,79}$" hint="lowercase, e.g. ops.cockpit or lease.esign_v2" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
          <Select label="Scope" value={form.tenantOrgId} onChange={(e) => setForm({ ...form, tenantOrgId: e.target.value })} disabled={!isPlatform}>
            <option value="">Global (all organizations)</option>
            {orgs.data?.pages.flatMap((p) => p.items).map((o) => <option key={o.id} value={o.id}>{o.name} ({o.slug})</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled immediately</label>
          <label htmlFor="flag-rules" className="block text-sm">
            <span className="mb-1 block font-medium text-navy-900">Rules (JSON)</span>
            <textarea id="flag-rules" value={form.rules} onChange={(e) => setForm({ ...form, rules: e.target.value })} aria-invalid={Boolean(rulesError)} aria-describedby={rulesError ? 'flag-rules-err' : undefined} className="min-h-24 w-full rounded-lg border border-line bg-surface p-3 font-mono text-sm" />
            {rulesError && <span id="flag-rules-err" role="alert" className="mt-1 block text-xs text-danger-600">{rulesError}</span>}
          </label>
          {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not create flag'} />}
          <Button type="submit" loading={create.isPending}>Create flag</Button>
        </form>
      )}
    </Drawer>
  );
}
