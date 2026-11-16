'use client';
import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { useChangeUnitStatus, humanize, type UnitDto } from '@/lib/hooks/property';
import { Alert, Badge, Button, Modal, Select, statusTone } from '@/components/ui';

/** Day 17 status transition modal: only reachable statuses are offered and a reason is required (audited + history). */
export function UnitStatusModal({ propertyId, unit, onClose }: { propertyId: string; unit: UnitDto | null; onClose: () => void }) {
  const change = useChangeUnitStatus(propertyId);
  const [toStatus, setToStatus] = useState('');
  const [reason, setReason] = useState('');
  const unitId = unit?.id;
  const firstNext = unit?.nextStatuses?.[0] ?? '';
  const reset = change.reset;
  useEffect(() => { setToStatus(firstNext); setReason(''); reset(); }, [unitId, firstNext, reset]);
  if (!unit) return null;
  const options = unit.nextStatuses ?? [];
  return (
    <Modal open onClose={onClose} title={`Change status of unit ${unit.unitNumber}`}
      footer={<><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="unit-status-form" loading={change.isPending} disabled={!toStatus || reason.trim().length < 3}>Confirm change</Button></>}>
      <form id="unit-status-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); change.mutate({ id: unit.id, toStatus, reason: reason.trim() }, { onSuccess: onClose }); }}>
        <p className="text-sm text-ink">Current status: <Badge tone={statusTone(unit.status)}>{humanize(unit.status)}</Badge></p>
        {options.length === 0 ? <Alert tone="warning" title="No transitions available from this status" /> : (
          <Select id="unit-to-status" label="New status" value={toStatus} onChange={(e) => setToStatus(e.target.value)} required>
            {options.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
        )}
        <label htmlFor="unit-status-reason" className="block text-sm">
          <span className="mb-1 block font-medium text-navy-900">Reason (required)</span>
          <textarea id="unit-status-reason" required minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-24 w-full rounded-lg border border-line bg-surface p-3 text-base text-ink" placeholder="Why is the status changing? This is recorded in the unit history and audit log." />
        </label>
        {change.isError && <Alert tone="danger" title={change.error instanceof ApiError ? change.error.message : 'Could not change status'} />}
      </form>
    </Modal>
  );
}
