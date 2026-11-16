import { errors } from './errors.js';

/** Generic guarded state machine used by lease, work order, application, privacy request. */
export interface Transition<S extends string, A extends string> {
  from: S | S[];
  to: S;
  /** Roles/permissions allowed; checked by caller via `allowed` predicate. */
  allowed: (actorRoles: readonly A[]) => boolean;
  /** Optional guard for required artifacts (e.g., signed document present). */
  guard?: (ctx: unknown) => string | null;
}

export class StateMachine<S extends string, A extends string> {
  constructor(private readonly transitions: Transition<S, A>[]) {}

  canTransition(from: S, to: S, roles: readonly A[], ctx?: unknown): { ok: true } | { ok: false; reason: string } {
    const t = this.transitions.find((tr) => tr.to === to && (Array.isArray(tr.from) ? tr.from.includes(from) : tr.from === from));
    if (!t) return { ok: false, reason: `no transition ${from} -> ${to}` };
    if (!t.allowed(roles)) return { ok: false, reason: 'actor not allowed' };
    const g = t.guard?.(ctx);
    if (g) return { ok: false, reason: g };
    return { ok: true };
  }

  assertTransition(from: S, to: S, roles: readonly A[], ctx?: unknown): void {
    const r = this.canTransition(from, to, roles, ctx);
    if (!r.ok) {
      if (r.reason === 'actor not allowed') throw errors.forbidden();
      throw errors.invalidTransition(from, to);
    }
  }

  nextStates(from: S): S[] {
    return this.transitions.filter((t) => (Array.isArray(t.from) ? t.from.includes(from) : t.from === from)).map((t) => t.to);
  }
}
