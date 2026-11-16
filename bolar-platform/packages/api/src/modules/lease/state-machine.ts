import { StateMachine, type Permission, type Transition } from '@bolar/shared';
import { LEASE_STATES, type LeaseState } from '@bolar/contracts';

export { LEASE_STATES, type LeaseState };

/** Facts the guards need; assembled by the service from the loaded lease and the request. */
export interface LeaseGuardContext {
  lease: { status: LeaseState; startDate: Date; endDate: Date; createdBy: string; currentVersionId: string | null };
  partyCount: number;
  versionCount: number;
  /** Occupying leases on the same unit whose dates intersect this one. */
  overlaps: number;
  actorId: string | null;
  /** True for webhook/system transitions (no human actor). */
  system: boolean;
  note?: string;
  signedAt?: string;
  activate?: boolean;
  /** Set when a completed e-sign envelope exists for the lease. */
  envelopeCompleted: boolean;
  today: Date;
}

const has = (perm: Permission) => (perms: readonly Permission[]) => perms.includes(perm);
const any = (...list: Permission[]) => (perms: readonly Permission[]) => list.some((p) => perms.includes(p));

const ACTIVATION_WINDOW_DAYS = 30;

/**
 * Lease lifecycle (blueprint Day 23 / p17): draft -> review -> approved -> sent -> signed -> active -> renewal,
 * with terminated/canceled exits and rollback paths for review failures and canceled e-sign.
 * Permissions stand in for actor roles; the service passes the actor's permission set (system gets lease:write).
 */
export const LEASE_TRANSITIONS: Transition<LeaseState, Permission>[] = [
  { from: 'draft', to: 'review', allowed: has('lease:write'), guard: (c) => ((c as LeaseGuardContext).partyCount === 0 ? 'At least one party is required before review' : null) },
  { from: 'review', to: 'approved', allowed: has('lease:approve'), guard: (c) => {
    const g = c as LeaseGuardContext;
    if (!g.system && g.actorId && g.actorId === g.lease.createdBy) return 'Approver cannot be the lease creator';
    if (g.overlaps > 0) return 'Another lease occupies this unit for these dates';
    return null;
  } },
  // Review failure: back to draft with a counsel/approver note.
  { from: 'review', to: 'draft', allowed: any('lease:approve', 'lease:write'), guard: (c) => (!(c as LeaseGuardContext).note ? 'A review note is required when sending a lease back to draft' : null) },
  { from: 'approved', to: 'sent', allowed: has('lease:send'), guard: (c) => (!(c as LeaseGuardContext).lease.currentVersionId ? 'A lease version (terms) is required before sending' : null) },
  // Signed via e-sign webhook (system) or wet signature artifact.
  { from: 'sent', to: 'signed', allowed: has('lease:write'), guard: (c) => {
    const g = c as LeaseGuardContext;
    if (g.system || g.envelopeCompleted || g.signedAt) return null;
    return 'A signedAt artifact or a completed e-sign envelope is required';
  } },
  // E-sign canceled/voided/declined: reopen as draft.
  { from: 'sent', to: 'draft', allowed: has('lease:write'), guard: (c) => (!(c as LeaseGuardContext).note ? 'A note explaining the reopen is required' : null) },
  { from: 'signed', to: 'active', allowed: has('lease:write'), guard: (c) => {
    const g = c as LeaseGuardContext;
    if (g.overlaps > 0) return 'Another lease occupies this unit for these dates';
    const windowStart = new Date(g.today.getTime() + ACTIVATION_WINDOW_DAYS * 86_400_000);
    if (g.lease.startDate > windowStart && !g.activate) return `Start date is more than ${ACTIVATION_WINDOW_DAYS} days away; confirm explicit activation`;
    return null;
  } },
  { from: 'active', to: 'renewal', allowed: has('lease:write') },
  { from: 'renewal', to: 'active', allowed: has('lease:write'), guard: (c) => ((c as LeaseGuardContext).versionCount < 2 ? 'A new lease version with renewal terms is required' : null) },
  { from: ['active', 'renewal'], to: 'terminated', allowed: has('lease:approve'), guard: (c) => (!(c as LeaseGuardContext).note ? 'A termination note is required' : null) },
  { from: ['draft', 'review', 'approved', 'sent'], to: 'canceled', allowed: has('lease:write') },
];

export const leaseMachine = new StateMachine<LeaseState, Permission>(LEASE_TRANSITIONS);

export function isLeaseState(v: string): v is LeaseState {
  return (LEASE_STATES as readonly string[]).includes(v);
}
