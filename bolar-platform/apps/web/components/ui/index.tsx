'use client';
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, forwardRef } from 'react';

export function cn(...parts: (string | false | null | undefined)[]) { return parts.filter(Boolean).join(' '); }

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }>(
  function Button({ variant = 'primary', loading, className, children, disabled, ...rest }, ref) {
    const styles: Record<Variant, string> = {
      primary: 'bg-cobalt-500 text-white hover:bg-cobalt-600 disabled:bg-navy-200',
      secondary: 'bg-surface text-navy-900 border border-line hover:bg-navy-50',
      ghost: 'bg-transparent text-cobalt-600 hover:bg-cobalt-100',
      danger: 'bg-danger-600 text-white hover:opacity-90',
    };
    return (
      <button ref={ref} disabled={disabled || loading} aria-busy={loading || undefined} className={cn('inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed', styles[variant], className)} {...rest}>
        {loading && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
        {children}
      </button>
    );
  },
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }>(
  function Input({ label, error, hint, id, className, ...rest }, ref) {
    const inputId = id ?? `in-${label.replace(/\s+/g, '-').toLowerCase()}`;
    return (
      <label htmlFor={inputId} className="block text-sm">
        <span className="mb-1 block font-medium text-navy-900">{label}</span>
        <input ref={ref} id={inputId} aria-invalid={!!error} aria-describedby={error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined} className={cn('min-h-11 w-full rounded-lg border bg-surface px-3 text-base text-ink', error ? 'border-danger-600' : 'border-line', className)} {...rest} />
        {hint && !error && <span id={`${inputId}-hint`} className="mt-1 block text-xs text-muted">{hint}</span>}
        {error && <span id={`${inputId}-err`} role="alert" className="mt-1 block text-xs text-danger-600">{error}</span>}
      </label>
    );
  },
);

export function Select({ label, id, children, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const selectId = id ?? `sel-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <label htmlFor={selectId} className="block text-sm">
      <span className="mb-1 block font-medium text-navy-900">{label}</span>
      <select id={selectId} className={cn('min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink', className)} {...rest}>{children}</select>
    </label>
  );
}

export function Card({ title, children, actions, className, as: Tag = 'section' }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return (
    <Tag className={cn('rounded-[14px] border border-line bg-surface p-5 shadow-sm', className)}>
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-navy-900">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </Tag>
  );
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet';
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const tones: Record<Tone, string> = {
    neutral: 'bg-navy-50 text-navy-700', info: 'bg-cobalt-100 text-cobalt-700', success: 'bg-success-100 text-success-700',
    warning: 'bg-orange-100 text-orange-900', danger: 'bg-danger-100 text-danger-600', violet: 'bg-violet-100 text-violet-700',
  };
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}

export function statusTone(status: string): Tone {
  if (/active|approved|complete|paid|succeeded|allow|signed|clean/.test(status)) return 'success';
  if (/pending|review|draft|queued|new|triaged|open|sent/.test(status)) return 'info';
  if (/overdue|blocked|warn|suspended|expired|late|emergency|high/.test(status)) return 'warning';
  if (/denied|failed|deny|void|canceled|revoked|infected|critical|terminated/.test(status)) return 'danger';
  return 'neutral';
}

export function KpiCard({ label, value, hint, tone = 'neutral' }: { label: string; value: ReactNode; hint?: string; tone?: Tone }) {
  return (
    <div className="rounded-[14px] border border-line bg-surface p-5 shadow-sm">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-navy-900">{value}</p>
      {hint && <p className="mt-1 text-xs"><Badge tone={tone}>{hint}</Badge></p>}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function Table<T extends { id: string }>({ columns, rows, caption, onRowClick, emptyLabel }: { columns: { key: string; header: string; render: (row: T) => ReactNode; className?: string }[]; rows: T[]; caption: string; onRowClick?: (row: T) => void; emptyLabel?: string }) {
  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-surface" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-navy-50 text-xs uppercase tracking-wide text-muted">
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={cn('px-4 py-3 font-semibold', c.className)}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-muted">{emptyLabel ?? 'Nothing here yet.'}</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn('border-t border-line', onRowClick && 'cursor-pointer hover:bg-navy-50')}>
              {columns.map((c) => <td key={c.key} className={cn('px-4 py-3 align-top', c.className)}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      <button aria-label="Close panel" className="absolute inset-0 bg-navy-900/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="drawer-title" className="relative h-full w-full max-w-lg overflow-y-auto bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="drawer-title" className="text-lg font-semibold text-navy-900">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <button aria-label="Close dialog" className="absolute inset-0 bg-navy-900/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="modal-title" className="relative w-full max-w-lg rounded-[14px] bg-surface p-6 shadow-xl">
        <h2 id="modal-title" className="text-lg font-semibold text-navy-900">{title}</h2>
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: Tone; title: string; children?: ReactNode }) {
  const tones: Record<Tone, string> = { neutral: 'border-line bg-navy-50', info: 'border-cobalt-100 bg-cobalt-100/50', success: 'border-success-100 bg-success-100/60', warning: 'border-orange-100 bg-orange-100/60', danger: 'border-danger-100 bg-danger-100/60', violet: 'border-violet-100 bg-violet-100/60' };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-lg border p-4 text-sm', tones[tone])}>
      <p className="font-semibold text-navy-900">{title}</p>
      {children && <div className="mt-1 text-ink">{children}</div>}
    </div>
  );
}
