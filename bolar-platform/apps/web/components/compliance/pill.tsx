'use client';
import type { ComponentProps } from 'react';
import { Badge } from '@/components/ui';

/**
 * Drop-in for the shared Badge with a WCAG AA compliant warning tone: the shared orange-100 / orange-700 pair is 4.05:1
 * at 12px (axe "serious"), so warning pills in compliance screens use navy ink on the orange tint instead.
 */
export function Pill({ tone = 'neutral', children }: ComponentProps<typeof Badge>) {
  if (tone !== 'warning') return <Badge tone={tone}>{children}</Badge>;
  return <span className="inline-flex items-center rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-navy-900 ring-1 ring-inset ring-orange-500/50">{children}</span>;
}
