'use client';
import { useState } from 'react';
import { Badge, Select } from '@/components/ui';
import { StateView } from '@/components/ui/state-view';
import { fmtCents, fmtMonth, useCollections, type CollectionsReportDto } from '@/lib/hooks/reporting';
import { PropertyFilter } from './shared';

const W = 720; const H = 220; const PAD = { l: 56, r: 12, t: 12, b: 36 };

/** Inline SVG bars (collected vs invoiced per month) with a visually hidden table so the numbers are readable without the chart. */
export function CollectionsChart({ months: initialMonths = 12, showPropertyFilter = true }: { months?: number; showPropertyFilter?: boolean }) {
  const [months, setMonths] = useState(initialMonths);
  const [propertyId, setPropertyId] = useState('');
  const q = useCollections({ months, propertyId: propertyId || undefined });
  return (
    <div>
      <div className="mb-4 grid max-w-xl gap-3 sm:grid-cols-2">
        {showPropertyFilter && <PropertyFilter value={propertyId} onChange={setPropertyId} />}
        <Select label="Window" value={String(months)} onChange={(e) => setMonths(Number(e.target.value))}>{[3, 6, 12, 24].map((m) => <option key={m} value={m}>Last {m} months</option>)}</Select>
      </div>
      <StateView isLoading={q.isLoading} error={q.error} data={q.data} isEmpty={(d) => d.byMonth.length === 0} empty={{ title: 'No collections in this window', description: 'Succeeded payments appear here by the month they were received.' }} onRetry={() => void q.refetch()}>
        {(d) => <Bars d={d} />}
      </StateView>
    </div>
  );
}

function Bars({ d }: { d: CollectionsReportDto }) {
  const series = d.byMonth;
  const max = Math.max(1, ...series.flatMap((m) => [m.collectedCents, m.invoicedCents]));
  const innerW = W - PAD.l - PAD.r; const innerH = H - PAD.t - PAD.b;
  const group = innerW / series.length; const bar = Math.min(28, group * 0.36);
  const y = (v: number) => PAD.t + innerH - (v / max) * innerH;
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const summary = `Collections for ${series.length} months: ${series.map((m) => `${fmtMonth(m.month)} collected ${fmtCents(m.collectedCents)} of ${fmtCents(m.invoicedCents)} invoiced`).join('; ')}.`;
  return (
    <figure data-testid="collections-chart">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-cobalt-500" /> Collected</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-3 w-3 rounded-sm bg-navy-200" /> Invoiced</span>
        <Badge tone={d.totals.reconciled ? 'success' : 'danger'}>{d.totals.reconciled ? 'Reconciles to ledger cash' : `Ledger cash ${fmtCents(d.totals.ledgerCashCents)} differs`}</Badge>
        <span className="text-muted">Total collected {fmtCents(d.totals.collectedCents)} · invoiced {fmtCents(d.totals.invoicedCents)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="h-auto w-full max-w-3xl">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.12} />
            <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.7}>{fmtCents(t).replace(/\.00$/, '')}</text>
          </g>
        ))}
        {series.map((m, i) => {
          const x0 = PAD.l + i * group + group / 2;
          return (
            <g key={m.month}>
              <rect x={x0 - bar - 2} width={bar} y={y(m.invoicedCents)} height={Math.max(0, PAD.t + innerH - y(m.invoicedCents))} className="fill-navy-200" />
              <rect x={x0 + 2} width={bar} y={y(m.collectedCents)} height={Math.max(0, PAD.t + innerH - y(m.collectedCents))} className="fill-cobalt-500" />
              <text x={x0} y={H - PAD.b + 16} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.8}>{fmtMonth(m.month)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        <table>
          <caption>Collections by month</caption>
          <thead><tr><th scope="col">Month</th><th scope="col">Collected</th><th scope="col">Invoiced</th><th scope="col">Ledger cash</th><th scope="col">Payments</th></tr></thead>
          <tbody>{series.map((m) => <tr key={m.month}><th scope="row">{fmtMonth(m.month)}</th><td>{fmtCents(m.collectedCents)}</td><td>{fmtCents(m.invoicedCents)}</td><td>{fmtCents(m.ledgerCashCents)}</td><td>{m.paymentsCount}</td></tr>)}</tbody>
        </table>
      </figcaption>
    </figure>
  );
}
