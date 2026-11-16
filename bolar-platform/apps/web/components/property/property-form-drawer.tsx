'use client';
import { useState } from 'react';
import { PROPERTY_TYPES } from '@bolar/contracts';
import { ApiError } from '@/lib/api-client';
import { useCreateProperty, usePortfolios, type PropertyDto } from '@/lib/hooks/property';
import { Alert, Button, Drawer, Input, Select } from '@/components/ui';

/** Day 16 create-property drawer. Field ids are explicit so they never collide with the list filters. */
export function PropertyFormDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (p: PropertyDto) => void }) {
  const create = useCreateProperty();
  const portfolios = usePortfolios();
  const [form, setForm] = useState({ name: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', county: '', propertyType: 'residential', status: 'onboarding', portfolioId: '' });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fieldError = (path: string) => (create.error instanceof ApiError ? create.error.body.fieldErrors?.find((f) => f.path === `body.${path}`)?.message : undefined);
  const reset = () => { create.reset(); setForm({ name: '', addressLine1: '', addressLine2: '', city: '', state: '', postalCode: '', county: '', propertyType: 'residential', status: 'onboarding', portfolioId: '' }); };

  return (
    <Drawer open={open} onClose={() => { reset(); onClose(); }} title="Add a property">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { name: form.name, addressLine1: form.addressLine1, addressLine2: form.addressLine2 || undefined, city: form.city, state: form.state, postalCode: form.postalCode, county: form.county || undefined, propertyType: form.propertyType, status: form.status, portfolioId: form.portfolioId || undefined },
            { onSuccess: (p) => { reset(); onCreated?.(p); onClose(); } },
          );
        }}
      >
        <Input id="prop-name" label="Property name" required maxLength={160} value={form.name} onChange={set('name')} error={fieldError('name')} />
        <Input id="prop-address1" label="Address line 1" required maxLength={200} value={form.addressLine1} onChange={set('addressLine1')} error={fieldError('addressLine1')} />
        <Input id="prop-address2" label="Address line 2" maxLength={200} value={form.addressLine2} onChange={set('addressLine2')} />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-1"><Input id="prop-city" label="City" required maxLength={100} value={form.city} onChange={set('city')} error={fieldError('city')} /></div>
          <Input id="prop-state" label="State" required minLength={2} maxLength={2} placeholder="TX" value={form.state} onChange={set('state')} error={fieldError('state')} />
          <Input id="prop-postal" label="Postal code" required minLength={3} maxLength={12} value={form.postalCode} onChange={set('postalCode')} error={fieldError('postalCode')} />
        </div>
        <Input id="prop-county" label="County" maxLength={100} value={form.county} onChange={set('county')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select id="prop-type" label="Property type" value={form.propertyType} onChange={set('propertyType')}>
            {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select id="prop-status" label="Initial status" value={form.status} onChange={set('status')}>
            <option value="onboarding">onboarding</option><option value="active">active</option><option value="inactive">inactive</option>
          </Select>
        </div>
        <Select id="prop-portfolio" label="Portfolio" value={form.portfolioId} onChange={set('portfolioId')}>
          <option value="">No portfolio</option>
          {portfolios.data?.pages.flatMap((p) => p.items).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        {create.isError && !(create.error instanceof ApiError && create.error.body.fieldErrors?.length) && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not create property'} />}
        <div className="flex gap-2">
          <Button type="submit" loading={create.isPending}>Create property</Button>
          <Button type="button" variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
        </div>
      </form>
    </Drawer>
  );
}
