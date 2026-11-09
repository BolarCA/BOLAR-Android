import { EventBus, makeEvent, type RequestContext } from '@bolar/shared';
import { enqueue } from './queue.js';

/** Process-wide bus. Modules subscribe at import time; the queue publisher forwards every event to workers. */
export const events = new EventBus();

export async function publish<T>(ctx: RequestContext, name: string, payload: T): Promise<void> {
  const ev = makeEvent(name, ctx, payload);
  await events.emit(ev);
  await enqueue('domain-events', ev as unknown as Record<string, unknown>, { jobId: `${ev.requestId}:${name}:${Date.now()}` });
}
