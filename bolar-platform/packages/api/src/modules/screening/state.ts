/** Application and adverse-action state machines plus business-day helpers (blueprint Days 43, 58). */
import { StateMachine, type Permission } from '@bolar/shared';

export type ApplicationStatus = 'draft' | 'submitted' | 'screening' | 'review' | 'approved' | 'conditionally_approved' | 'denied' | 'withdrawn';
export type AdverseStage = 'pre_adverse' | 'waiting' | 'final' | 'disputed' | 'withdrawn';

export const applicationMachine = new StateMachine<ApplicationStatus, Permission>([
  { from: 'draft', to: 'submitted', allowed: (p) => p.includes('application:write') },
  { from: 'submitted', to: 'screening', allowed: (p) => p.includes('screening:order') },
  { from: 'screening', to: 'review', allowed: (p) => p.includes('screening:order') },
  { from: 'submitted', to: 'review', allowed: (p) => p.includes('application:write') },
  { from: 'review', to: 'approved', allowed: (p) => p.includes('adverse_action:manage') },
  { from: 'review', to: 'conditionally_approved', allowed: (p) => p.includes('adverse_action:manage') },
  { from: 'review', to: 'denied', allowed: (p) => p.includes('adverse_action:manage') },
  { from: ['draft', 'submitted', 'screening', 'review'], to: 'withdrawn', allowed: (p) => p.includes('application:write') },
]);

export const adverseMachine = new StateMachine<AdverseStage, Permission>([
  { from: 'pre_adverse', to: 'waiting', allowed: (p) => p.includes('adverse_action:manage') },
  { from: 'waiting', to: 'final', allowed: (p) => p.includes('adverse_action:manage') },
  { from: ['pre_adverse', 'waiting'], to: 'disputed', allowed: (p) => p.includes('adverse_action:manage') },
  { from: ['pre_adverse', 'waiting', 'disputed'], to: 'withdrawn', allowed: (p) => p.includes('adverse_action:manage') },
]);

export const WAITING_BUSINESS_DAYS = 5;

export function isBusinessDay(d: Date): boolean {
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

/** Adds N business days (Mon-Fri, UTC) keeping the time of day. */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBusinessDay(d)) left--;
  }
  return d;
}

/** Whole business days elapsed between two instants (0 when `to` is before `from`). */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  let count = 0;
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (d.getTime() < end.getTime()) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBusinessDay(d)) count++;
  }
  return count;
}
