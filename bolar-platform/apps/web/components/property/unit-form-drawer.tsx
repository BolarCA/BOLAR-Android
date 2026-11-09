'use client';
import { useState } from 'react';
import { UNIT_STATUSES } from '@bolar/contracts';
import { ApiError } from '@/lib/api-client';
import { useCreateUnit, type BuildingDto } from '@/lib/hooks/property';
import { Alert, Button, Drawer, Input, Select } from '@/components/ui';

/** Day 17 create-unit drawer. Rent is entered in dollars and sent as integer cents. */
export function UnitFormDrawer({ propertyId, buildings, open, onClose }: { propertyId: string; buildings: BuildingDto[]; open: boolean; onClose: () => void }) {
  const create = useCreateUnit(propertyId);
  const blank = { unitNumber: '', buildingId: '', bedrooms: '', bathrooms: '', squareFeet: '', rent: '', status: 'vacant' };
  const [form, setForm] = useState(blank);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fieldError = (path: string) => (create.error instanceof ApiError ? create.error.body.fieldErrors?.find((f) => f.path === `body.${path}`)?.message : undefined);
  const close = () => { create.reset(); setForm(blank); onClose(); };
  return (
    <Drawer open={open} onClose={close} title="Add a unit">
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        create.mutate({
          unitNumber: form.unitNumber, buildingId: form.buildingId || undefined, status: form.status,
          bedrooms: form.bedrooms === '' ? undefined : Number(form.bedrooms), bathrooms: form.bathrooms === '' ? undefined : Number(form.bathrooms),
          squareFeet: form.squareFeet === '' ? undefined : Number(form.squareFeet), targetRentCents: form.rent === '' ? 0 : Math.round(Number(form.rent) * 100),
        }, { onSuccess: close });
      }}>
        <Input id="unit-number" label="Unit number" required maxLength={20} value={form.unitNumber} onChange={set('unitNumber')} error={fieldError('unitNumber')} />
        <Select id="unit-building" label="Building" value={form.buildingId} onChange={set('buildingId')}>
          <option value="">Not assigned</option>
          {buildings.map((b) => <option key={b.id} value={b.id}>{b.name ?? 'Building'}</option>)}
        </Select>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input id="unit-beds" label="Bedrooms" type="number" min={0} max={50} value={form.bedrooms} onChange={set('bedrooms')} />
          <Input id="unit-baths" label="Bathrooms" type="number" min={0} max={50} step={0.5} value={form.bathrooms} onChange={set('bathrooms')} error={fieldError('bathrooms')} />
          <Input id="unit-sqft" label="Square feet" type="number" min={0} value={form.squareFeet} onChange={set('squareFeet')} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input id="unit-rent" label="Target rent (USD / month)" type="number" min={0} step={1} value={form.rent} onChange={set('rent')} error={fieldError('targetRentCents')} />
          <Select id="unit-status" label="Initial status" value={form.status} onChange={set('status')}>
            {UNIT_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </Select>
        </div>
        {create.isError && !(create.error instanceof ApiError && create.error.body.fieldErrors?.length) && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not create unit'} />}
        <div className="flex gap-2"><Button type="submit" loading={create.isPending}>Create unit</Button><Button type="button" variant="secondary" onClick={close}>Cancel</Button></div>
      </form>
    </Drawer>
  );
}
