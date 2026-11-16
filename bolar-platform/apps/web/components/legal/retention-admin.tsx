'use client';
import { useState } from 'react';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useAssignRetention, useCreateRetentionPolicy, useRetentionAction, useRetentionAssignments, useRetentionPolicies, useRetentionSweep, type RetentionAssignmentDto, type RetentionPolicyDto } from '@/lib/hooks/retention';
import { Alert, Badge, Button, Card, Drawer, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { dueLabel, fmtDate, humanize, shortId } from './util';

const RESOURCE_TYPES = ['document', 'lease', 'audit_log', 'notification', 'screening_result', 'media', 'message', 'report'];

/** Day 47: policies (platform defaults + org overrides) and the proposed-disposition queue with human gates. */
export function RetentionAdmin() {
  const [state, setState] = useState('proposed');
  const [policyOpen, setPolicyOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const policies = useRetentionPolicies();
  const assignments = useRetentionAssignments({ state: state || undefined });
  const sweep = useRetentionSweep();
  const action = useRetentionAction();
  const canWrite = useCan('retention:write');
  const canApprovePrivacy = useCan('privacy_request:approve');
  const canApproveCompliance = useCan('compliance:approve');
  const canApprove = canApprovePrivacy || canApproveCompliance;

  return (
    <>
      <PageHeader title="Retention" description="Policies define how long records are kept and what happens next. The daily sweep only proposes dispositions; a human approves, and anything under legal hold is blocked."
        actions={canWrite && <><Button variant="secondary" onClick={() => setAssignOpen(true)}>Attach policy</Button><Button variant="secondary" onClick={() => setPolicyOpen(true)}>New policy</Button><Button loading={sweep.isPending} onClick={() => sweep.mutate()}>Run sweep</Button></>} />
      {sweep.isSuccess && <div className="mb-4"><Alert tone="success" title={`Sweep complete: ${sweep.data.scanned} due, ${sweep.data.proposed} proposed, ${sweep.data.held} held`} /></div>}
      {sweep.isError && <div className="mb-4"><Alert tone="danger" title={sweep.error instanceof ApiError ? sweep.error.message : 'Sweep failed'} /></div>}
      <div className="space-y-8">
        <Card title="Policies">
          <StateView isLoading={policies.isLoading} error={policies.error} data={policies.data} isEmpty={(d) => d.items.length === 0} empty={{ title: 'No policies', description: 'Platform defaults appear after the base seed runs.' }} onRetry={() => void policies.refetch()}>
            {(d) => (
              <Table<RetentionPolicyDto> caption="Retention policies" rows={d.items} columns={[
                { key: 'key', header: 'Policy', render: (p) => <div><p className="font-medium">{p.name}</p><p className="text-xs text-muted">{p.key}</p></div> },
                { key: 'type', header: 'Applies to', render: (p) => <span className="text-xs">{humanize(p.resourceType)}{p.classification ? ` · ${p.classification}` : ''}</span> },
                { key: 'days', header: 'Retain', render: (p) => `${p.retainDays} days` },
                { key: 'disp', header: 'Disposition', render: (p) => <Badge tone={p.disposition === 'delete' ? 'danger' : p.disposition === 'anonymize' ? 'danger' : 'info'}>{p.disposition}</Badge> },
                { key: 'src', header: 'Source', render: (p) => (p.isPlatformDefault ? <Badge>platform default</Badge> : <Badge tone="violet">org override</Badge>) },
              ]} />
            )}
          </StateView>
        </Card>
        <Card title="Assignments" actions={<div className="w-48"><Select label="State" value={state} onChange={(e) => setState(e.target.value)}><option value="">All</option>{['retained', 'proposed', 'approved', 'held', 'disposed'].map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>}>
          {action.isError && <div className="mb-3"><Alert tone="danger" title={action.error instanceof ApiError ? action.error.message : 'Action failed'} /></div>}
          <StateView isLoading={assignments.isLoading} error={assignments.error} data={assignments.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} empty={{ title: state === 'proposed' ? 'Nothing proposed' : 'No assignments', description: state === 'proposed' ? 'Run the sweep to propose dispositions for records past their retention date.' : 'Attach a policy to a record to start its clock.' }} onRetry={() => void assignments.refetch()}>
            {(d) => (
              <>
                <Table<RetentionAssignmentDto> caption="Retention assignments" rows={d.pages.flatMap((p) => p.items)} columns={[
                  { key: 'res', header: 'Record', render: (a) => <div><p className="font-medium">{humanize(a.resourceType)}</p><p className="text-xs text-muted">{shortId(a.resourceId, 14)}</p></div> },
                  { key: 'policy', header: 'Policy', render: (a) => <span className="text-xs">{a.policyKey ?? shortId(a.policyId)}</span> },
                  { key: 'until', header: 'Retain until', render: (a) => { const l = dueLabel(a.retainUntil); return <div className="flex items-center gap-2"><span className="text-xs">{fmtDate(a.retainUntil)}</span>{a.state === 'retained' && <Badge tone={l.tone}>{l.text}</Badge>}</div>; } },
                  { key: 'state', header: 'State', render: (a) => <Badge tone={a.state === 'held' ? 'danger' : a.state === 'proposed' ? 'info' : statusTone(a.state)}>{a.state}</Badge> },
                  { key: 'actions', header: '', className: 'text-right', render: (a) => (
                    <div className="flex justify-end gap-2">
                      {a.state === 'proposed' && canApprove && <Button aria-label={`Approve disposal of ${a.resourceType} ${a.resourceId}`} onClick={() => action.mutate({ id: a.id, action: 'approve', note: 'Approved from retention queue' })}>Approve</Button>}
                      {a.state === 'approved' && canWrite && <Button variant="danger" aria-label={`Dispose ${a.resourceType} ${a.resourceId}`} onClick={() => action.mutate({ id: a.id, action: 'dispose' })}>Dispose</Button>}
                      {['retained', 'proposed', 'approved'].includes(a.state) && canWrite && <Button variant="ghost" aria-label={`Hold ${a.resourceType} ${a.resourceId}`} onClick={() => action.mutate({ id: a.id, action: 'hold', note: 'Held from retention queue' })}>Hold</Button>}
                    </div>
                  ) },
                ]} />
                {assignments.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void assignments.fetchNextPage()} loading={assignments.isFetchingNextPage}>Load more</Button></div>}
              </>
            )}
          </StateView>
        </Card>
      </div>
      <PolicyDrawer open={policyOpen} onClose={() => setPolicyOpen(false)} />
      <AssignDrawer open={assignOpen} onClose={() => setAssignOpen(false)} policies={policies.data?.items ?? []} />
    </>
  );
}

function PolicyDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateRetentionPolicy();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [resourceType, setResourceType] = useState('document');
  const [retainDays, setRetainDays] = useState('365');
  const [disposition, setDisposition] = useState('review');
  return (
    <Drawer open={open} onClose={onClose} title="New retention policy">
      {create.isSuccess ? <div className="space-y-4"><Alert tone="success" title={`Policy ${create.data.key} created`} /><Button onClick={() => { create.reset(); onClose(); }}>Done</Button></div> : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ key, name, resourceType, retainDays: Number(retainDays), disposition }); }}>
          <Input label="Key" required value={key} onChange={(e) => setKey(e.target.value)} hint="Lowercase, e.g. documents.general. Same key as a platform default overrides it." />
          <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Select label="Resource type" value={resourceType} onChange={(e) => setResourceType(e.target.value)}>{RESOURCE_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select>
          <Input label="Retain days" type="number" min={1} required value={retainDays} onChange={(e) => setRetainDays(e.target.value)} />
          <Select label="Disposition" value={disposition} onChange={(e) => setDisposition(e.target.value)}><option value="review">review</option><option value="archive">archive</option><option value="anonymize">anonymize</option><option value="delete">delete</option></Select>
          {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not create policy'} />}
          <div className="flex gap-2"><Button type="submit" loading={create.isPending}>Create</Button><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button></div>
        </form>
      )}
    </Drawer>
  );
}

function AssignDrawer({ open, onClose, policies }: { open: boolean; onClose: () => void; policies: RetentionPolicyDto[] }) {
  const assign = useAssignRetention();
  const [policyKey, setPolicyKey] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [anchorDate, setAnchorDate] = useState('');
  const policy = policies.find((p) => p.key === policyKey);
  return (
    <Drawer open={open} onClose={onClose} title="Attach a retention policy">
      {assign.isSuccess ? <div className="space-y-4"><Alert tone="success" title={`Retained until ${fmtDate(assign.data.retainUntil)}`} /><Button onClick={() => { assign.reset(); setResourceId(''); onClose(); }}>Done</Button></div> : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (policy) assign.mutate({ policyKey, resourceType: policy.resourceType, resourceId, anchorDate: anchorDate ? new Date(anchorDate).toISOString() : undefined }); }}>
          <Select label="Policy" required value={policyKey} onChange={(e) => setPolicyKey(e.target.value)}><option value="">Choose…</option>{policies.map((p) => <option key={p.id} value={p.key}>{p.name} ({humanize(p.resourceType)}, {p.retainDays}d)</option>)}</Select>
          <Input label="Record id" required value={resourceId} onChange={(e) => setResourceId(e.target.value)} hint={policy ? `A ${humanize(policy.resourceType)} id` : 'Choose a policy first'} />
          <Input label="Anchor date" type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} hint="Defaults to today. Retain-until = anchor + retain days." />
          {assign.isError && <Alert tone="danger" title={assign.error instanceof ApiError ? assign.error.message : 'Could not attach policy'} />}
          <div className="flex gap-2"><Button type="submit" loading={assign.isPending} disabled={!policy}>Attach</Button><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button></div>
        </form>
      )}
    </Drawer>
  );
}
