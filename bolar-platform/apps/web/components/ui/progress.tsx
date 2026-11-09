'use client';
import { cn } from './index';

type ProgressTone = 'cobalt' | 'teal' | 'orange' | 'danger';

/**
 * Accessible determinate progress / occupancy bar. The visible number is rendered by the caller; the bar itself
 * carries the ARIA progressbar semantics so screen readers announce the percentage.
 */
export function Progress({ value, max = 100, label, tone = 'cobalt', className, valueText }: { value: number; max?: number; label: string; tone?: ProgressTone; className?: string; valueText?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  const fill: Record<ProgressTone, string> = { cobalt: 'bg-cobalt-500', teal: 'bg-teal-500', orange: 'bg-orange-500', danger: 'bg-danger-600' };
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={valueText ?? `${pct}%`} className={cn('h-2.5 w-full overflow-hidden rounded-full bg-navy-100', className)}>
      <div className={cn('h-full rounded-full transition-[width]', fill[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Picks a bar tone from an occupancy percentage: healthy >= 85, watch >= 60, otherwise attention. */
export function occupancyTone(pct: number): ProgressTone {
  if (pct >= 85) return 'teal';
  if (pct >= 60) return 'cobalt';
  return 'orange';
}
