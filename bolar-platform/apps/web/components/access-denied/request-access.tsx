'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ACCESS_PURPOSES } from '@bolar/shared';
import { api, ApiError } from '@/lib/api-client';
import { Button, Select, Alert } from '../ui';

/** Day 15 "request-access" UI: posts a SensitiveAccessRequest. */
export function RequestAccessPanel({ resource }: { resource: { type: string; id: string; classification?: 'confidential' | 'restricted' } }) {
  const [purpose, setPurpose] = useState<string>(ACCESS_PURPOSES[0]);
  const [justification, setJustification] = useState('');
  const m = useMutation({
    mutationFn: () => api<{ id: string }>('/sensitive-access/requests', { method: 'POST', body: { resourceType: resource.type, resourceId: resource.id, classification: resource.classification ?? 'confidential', purpose, justification } }),
  });
  if (m.isSuccess) return <Alert tone="success" title="Request submitted">An approver has been notified. You will regain access here once it is approved.</Alert>;
  return (
    <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Select label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
        {ACCESS_PURPOSES.map((p) => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
      </Select>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-navy-900">Justification</span>
        <textarea required minLength={10} maxLength={2000} value={justification} onChange={(e) => setJustification(e.target.value)} className="min-h-24 w-full rounded-lg border border-line bg-surface p-3 text-base" placeholder="Why do you need this data, and for how long?" />
      </label>
      {m.isError && <Alert tone="danger" title={m.error instanceof ApiError ? m.error.message : 'Could not submit request'} />}
      <Button type="submit" loading={m.isPending}>Request access</Button>
    </form>
  );
}
