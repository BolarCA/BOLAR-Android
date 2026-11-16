import { StateMachine, type Permission } from '@bolar/shared';
import type { UnitStatus } from '@bolar/contracts';

/**
 * Unit occupancy state machine (Day 17 "unit CRUD and status transitions", schema p16).
 *
 *   vacant     -> reserved | make_ready | down | occupied
 *   occupied   -> notice | vacant
 *   notice     -> vacant | occupied
 *   make_ready -> vacant
 *   down       -> make_ready | vacant
 *   reserved   -> occupied | vacant
 *
 * Active-lease overlap is enforced by the lease module (it owns lease dates); this module exposes the
 * occupancy status and history that the lease module and reporting consume.
 */
export const UNIT_TRANSITIONS: Record<UnitStatus, readonly UnitStatus[]> = {
  vacant: ['reserved', 'make_ready', 'down', 'occupied'],
  occupied: ['notice', 'vacant'],
  notice: ['vacant', 'occupied'],
  make_ready: ['vacant'],
  down: ['make_ready', 'vacant'],
  reserved: ['occupied', 'vacant'],
};

export const unitStateMachine = new StateMachine<UnitStatus, Permission>(
  (Object.keys(UNIT_TRANSITIONS) as UnitStatus[]).flatMap((from) =>
    UNIT_TRANSITIONS[from].map((to) => ({ from, to, allowed: (perms: readonly Permission[]) => perms.includes('unit:write') })),
  ),
);

export function nextUnitStatuses(from: string): UnitStatus[] {
  return [...(UNIT_TRANSITIONS[from as UnitStatus] ?? [])];
}
