import type { DomainEvent } from '@bolar/shared';
import type { JobContext } from './index.js';

export type EventReaction = (event: DomainEvent, ctx: JobContext) => Promise<void>;
const reactions = new Map<string, EventReaction[]>();

/** Modules register reactions to domain events: onEvent('work_order.created', notifyManager). */
export function onEvent(name: string, reaction: EventReaction): void {
  reactions.set(name, [...(reactions.get(name) ?? []), reaction]);
}
export function reactionsFor(name: string): EventReaction[] {
  return [...(reactions.get(name) ?? []), ...(reactions.get('*') ?? [])];
}
