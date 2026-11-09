/** Typed in-process domain event bus (blueprint p9 shared kernel). Workers subscribe via queue publisher. */
export interface DomainEvent<TName extends string = string, TPayload = unknown> {
  name: TName;
  tenantOrgId: string | null;
  actorId: string | null;
  requestId: string;
  occurredAt: string;
  payload: TPayload;
}

type Handler = (event: DomainEvent) => Promise<void> | void;

export class EventBus {
  private handlers = new Map<string, Handler[]>();
  private wildcard: Handler[] = [];

  on(name: string, handler: Handler): () => void {
    if (name === '*') {
      this.wildcard.push(handler);
      return () => { this.wildcard = this.wildcard.filter((h) => h !== handler); };
    }
    const list = this.handlers.get(name) ?? [];
    list.push(handler);
    this.handlers.set(name, list);
    return () => this.handlers.set(name, (this.handlers.get(name) ?? []).filter((h) => h !== handler));
  }

  async emit<T>(event: DomainEvent<string, T>): Promise<void> {
    const list = [...(this.handlers.get(event.name) ?? []), ...this.wildcard];
    for (const h of list) {
      try {
        await h(event as DomainEvent);
      } catch (err) {
        // Event handlers must never break the request path; log and continue.
        console.error(`[events] handler for ${event.name} failed`, err);
      }
    }
  }
}

export function makeEvent<T>(name: string, ctx: { requestId: string; tenantOrgId: string | null; actor: { userId: string } | null }, payload: T): DomainEvent<string, T> {
  return { name, tenantOrgId: ctx.tenantOrgId, actorId: ctx.actor?.userId ?? null, requestId: ctx.requestId, occurredAt: new Date().toISOString(), payload };
}
