'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { VENDOR_STATUSES, VENDOR_TRADES } from '@bolar/contracts';
import { useCan } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { useCreateVendor, useVendors, type VendorProfileDto } from '@/lib/hooks/vendor';
import { Alert, Badge, Button, Drawer, Input, PageHeader, Select, Table, statusTone } from '@/components/ui';
import { StateView } from "@/components/ui/state-view";
import { Chip, LinkButton } from "./labels";

export function insuranceTone(s: string) { return s === 'valid' ? 'success' : s === 'expiring' ? 'warning' : 'danger'; }

/** Vendor rolodex (Day 33): list with status/trade filters, add-vendor drawer; row opens the detail page. */
export function VendorsAdmin() {
  const router = useRouter();
  const canWrite = useCan('vendor:write');
  const [status, setStatus] = useState('');
  const [trade, setTrade] = useState('');
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const vendors = useVendors({ status: status || undefined, trade: trade || undefined, q: q || undefined });
  return (
    <>
      <PageHeader title="Vendors" description="Approved trades, coverage, insurance and contracts. Only approved vendors with valid insurance can be assigned." actions={canWrite && <Button onClick={() => setAddOpen(true)}>Add vendor</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input label="Search" placeholder="Name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{VENDOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <Select label="Trade" value={trade} onChange={(e) => setTrade(e.target.value)}><option value="">All trades</option>{VENDOR_TRADES.map((t) => <option key={t} value={t}>{t}</option>)}</Select>
      </div>
      <StateView isLoading={vendors.isLoading} error={vendors.error} data={vendors.data} isEmpty={(d) => d.pages.every((p) => p.items.length === 0)} onRetry={() => void vendors.refetch()}
        empty={{ title: 'No vendors yet', description: 'Add your first vendor to start assigning work orders.', action: canWrite && <Button onClick={() => setAddOpen(true)}>Add vendor</Button> }}>
        {(d) => (
          <>
            <Table<VendorProfileDto> caption="Vendors" rows={d.pages.flatMap((p) => p.items)} onRowClick={(v) => router.push(`/manager/vendors/${v.id}`)} columns={[
              { key: 'name', header: 'Vendor', render: (v) => <div><Link href={`/manager/vendors/${v.id}`} className="font-medium text-cobalt-600 underline-offset-2 hover:underline">{v.name}</Link><p className="text-xs text-muted">{v.email ?? '—'}{v.phone ? ` · ${v.phone}` : ''}</p></div> },
              { key: 'trades', header: 'Trades', render: (v) => <div className="flex flex-wrap gap-1">{v.trades.map((t) => <Badge key={t} tone="info">{t}</Badge>)}</div> },
              { key: 'status', header: 'Status', render: (v) => <Chip tone={statusTone(v.status)}>{v.status}</Chip> },
              { key: 'insurance', header: 'Insurance', render: (v) => <Chip tone={insuranceTone(v.insuranceStatus)}>{v.insuranceStatus}{v.insuranceExpiresAt ? ` · ${new Date(v.insuranceExpiresAt).toLocaleDateString()}` : ''}</Chip> },
              { key: 'coverage', header: 'Coverage', render: (v) => (v.coverageJson.propertyIds.length ? `${v.coverageJson.propertyIds.length} propert${v.coverageJson.propertyIds.length === 1 ? 'y' : 'ies'}` : 'All properties') },
              { key: 'open', header: 'Open jobs', render: (v) => v.openWorkOrders },
            ]} />
            {vendors.hasNextPage && <div className="mt-3"><Button variant="secondary" onClick={() => void vendors.fetchNextPage()} loading={vendors.isFetchingNextPage}>Load more</Button></div>}
          </>
        )}
      </StateView>
      <AddVendorDrawer open={addOpen} onClose={() => setAddOpen(false)} />
    </>
  );
}

function AddVendorDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateVendor();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [insurance, setInsurance] = useState('');
  const [license, setLicense] = useState('');
  const [budget, setBudget] = useState('');
  const [trades, setTrades] = useState<string[]>([]);
  const toggle = (t: string) => setTrades(trades.includes(t) ? trades.filter((x) => x !== t) : [...trades, t]);
  const reset = () => { create.reset(); setName(''); setEmail(''); setPhone(''); setInsurance(''); setLicense(''); setBudget(''); setTrades([]); };
  return (
    <Drawer open={open} onClose={onClose} title="Add a vendor">
      {create.isSuccess ? (
        <div className="space-y-4">
          <Alert tone="success" title={`${create.data.name} added as pending`}>Approve the vendor from its detail page once insurance and contracts are on file.</Alert>
          <div className="flex gap-2"><LinkButton href={`/manager/vendors/${create.data.id}`} variant="primary">Open vendor</LinkButton><Button variant="secondary" onClick={() => { reset(); onClose(); }}>Done</Button></div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ name, trades, email: email || undefined, phone: phone || undefined, insuranceExpiresAt: insurance ? new Date(insurance).toISOString() : undefined, licenseNumber: license || undefined, budgetLimitCents: budget ? Math.round(Number(budget) * 100) : undefined }); }}>
          <Input label="Company name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-navy-900">Trades <span className="font-normal text-muted">(at least one)</span></legend>
            <div className="grid grid-cols-2 gap-1 text-sm">
              {VENDOR_TRADES.map((t) => <label key={t} className="flex items-center gap-2"><input type="checkbox" checked={trades.includes(t)} onChange={() => toggle(t)} /> {t}</label>)}
            </div>
          </fieldset>
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label="Insurance expires" type="date" value={insurance} onChange={(e) => setInsurance(e.target.value)} hint="Vendors without valid insurance cannot be assigned." />
          <Input label="License number" value={license} onChange={(e) => setLicense(e.target.value)} />
          <Input label="Budget limit per job (USD)" type="number" min={0} step="1" value={budget} onChange={(e) => setBudget(e.target.value)} hint="Optional. Estimates above this block assignment." />
          {create.isError && <Alert tone="danger" title={create.error instanceof ApiError ? create.error.message : 'Could not add vendor'}>{create.error instanceof ApiError && create.error.body.fieldErrors?.map((f) => <p key={f.path}>{f.path}: {f.message}</p>)}</Alert>}
          <div className="flex gap-2"><Button type="submit" loading={create.isPending} disabled={trades.length === 0}>Add vendor</Button><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button></div>
        </form>
      )}
    </Drawer>
  );
}
