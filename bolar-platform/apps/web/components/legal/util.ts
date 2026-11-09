/** Small presentation helpers shared by the governance screens. */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function dueLabel(iso: string | null | undefined): { text: string; tone: 'neutral' | 'info' | 'violet' | 'danger' | 'success' } {
  const d = daysUntil(iso);
  if (d === null) return { text: 'No due date', tone: 'neutral' };
  if (d < 0) return { text: `${Math.abs(d)}d overdue`, tone: 'danger' };
  if (d === 0) return { text: 'Due today', tone: 'violet' };
  if (d <= 7) return { text: `${d}d left`, tone: 'violet' };
  return { text: `${d}d left`, tone: 'info' };
}

export function shortId(id: string | null | undefined, n = 10): string {
  return id ? `${id.slice(0, n)}…` : '—';
}

export function fmtDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

export function fmtDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export function splitIds(value: string): string[] {
  return value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

export function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}
