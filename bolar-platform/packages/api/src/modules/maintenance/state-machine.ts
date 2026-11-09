import { StateMachine, type Transition } from '@bolar/shared';
import { REOPEN_WINDOW_DAYS, type WorkOrderStatus } from '@bolar/contracts';

/** Who the actor is relative to this work order (Day 32 "transition permissions for manager/vendor/tenant"). */
export type WorkOrderActorKind = 'manager' | 'vendor' | 'tenant';

export interface TransitionGuardContext {
  hasAssignee: boolean;
  scheduledFor: Date | null;
  note: string | undefined;
  completedAt: Date | null;
  actorKinds: readonly WorkOrderActorKind[];
  now: Date;
}

const has = (...kinds: WorkOrderActorKind[]) => (roles: readonly WorkOrderActorKind[]) => kinds.some((k) => roles.includes(k));
const needNote = (c: unknown) => ((c as TransitionGuardContext).note?.trim() ? null : 'note required');

const CANCELABLE_BY_MANAGER: WorkOrderStatus[] = ['new', 'triaged', 'assigned', 'scheduled', 'in_progress', 'blocked', 'review', 'reopened'];

export const WORK_ORDER_TRANSITIONS: Transition<WorkOrderStatus, WorkOrderActorKind>[] = [
  { from: 'new', to: 'triaged', allowed: has('manager') },
  { from: 'triaged', to: 'assigned', allowed: has('manager'), guard: (c) => ((c as TransitionGuardContext).hasAssignee ? null : 'assignee required') },
  // Vendor declines (Day 35 "vendor denial" fixture) or manager pulls the assignment: back to triage with a note.
  { from: 'assigned', to: 'triaged', allowed: has('manager', 'vendor'), guard: needNote },
  { from: 'assigned', to: 'scheduled', allowed: has('manager', 'vendor'), guard: (c) => ((c as TransitionGuardContext).scheduledFor ? null : 'scheduledFor required') },
  { from: 'scheduled', to: 'in_progress', allowed: has('manager', 'vendor') },
  { from: 'in_progress', to: 'blocked', allowed: has('manager', 'vendor'), guard: needNote },
  { from: 'blocked', to: 'in_progress', allowed: has('manager', 'vendor') },
  { from: 'in_progress', to: 'review', allowed: has('manager', 'vendor') },
  { from: 'review', to: 'complete', allowed: has('manager') },
  {
    from: 'complete', to: 'reopened', allowed: has('manager', 'tenant'),
    guard: (c) => {
      const ctx = c as TransitionGuardContext;
      if (!ctx.completedAt) return null;
      const limit = ctx.completedAt.getTime() + REOPEN_WINDOW_DAYS * 86_400_000;
      return ctx.now.getTime() <= limit ? null : `reopen window of ${REOPEN_WINDOW_DAYS} days has passed`;
    },
  },
  { from: 'reopened', to: 'triaged', allowed: has('manager') },
  {
    from: CANCELABLE_BY_MANAGER, to: 'canceled',
    allowed: has('manager', 'tenant'),
    guard: (c) => {
      const ctx = c as TransitionGuardContext & { from: WorkOrderStatus };
      if (!ctx.note?.trim()) return 'note required';
      if (ctx.actorKinds.includes('manager')) return null;
      // Tenant requester may only cancel before work is organised.
      return ctx.from === 'new' || ctx.from === 'triaged' ? null : 'requester can only cancel new or triaged requests';
    },
  },
];

export const workOrderMachine = new StateMachine<WorkOrderStatus, WorkOrderActorKind>(WORK_ORDER_TRANSITIONS);

/** Next states the actor could reach from `from` with the given context (used by the detail endpoint for action buttons). */
export function allowedTransitions(from: WorkOrderStatus, kinds: readonly WorkOrderActorKind[], ctx: Omit<TransitionGuardContext, 'note'> & { note?: string }): WorkOrderStatus[] {
  const out = new Set<WorkOrderStatus>();
  for (const t of WORK_ORDER_TRANSITIONS) {
    const matches = Array.isArray(t.from) ? t.from.includes(from) : t.from === from;
    if (!matches || !t.allowed(kinds)) continue;
    // Guards that only need user input (note/scheduledFor) should not hide the action; evaluate with a placeholder note/date.
    const probe = { ...ctx, note: 'probe', scheduledFor: ctx.scheduledFor ?? new Date(ctx.now.getTime() + 3_600_000), from } as TransitionGuardContext & { from: WorkOrderStatus };
    if (t.to === 'assigned' && !ctx.hasAssignee) continue;
    if (t.guard?.(probe)) continue;
    out.add(t.to);
  }
  return [...out];
}
