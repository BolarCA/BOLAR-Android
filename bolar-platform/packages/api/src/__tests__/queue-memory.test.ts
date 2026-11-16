import { describe, it, expect, afterEach } from 'vitest';
import { enqueue, drainMemoryQueue, memoryQueue, memoryQueueStats, setMemoryQueueConsumer, MEMORY_QUEUE_MAX, type QueuedJob } from '../shared/queue.js';

/** Review finding 4: the memory driver either hands jobs to an in-process consumer or keeps a bounded buffer. */
describe('memory queue driver', () => {
  afterEach(() => { setMemoryQueueConsumer(null); drainMemoryQueue(); });

  it('delivers to a registered consumer instead of buffering', async () => {
    const seen: QueuedJob[] = [];
    setMemoryQueueConsumer(async (job) => { seen.push(job); });
    await enqueue('notifications', { to: 'x' }, { jobId: 'n-1' });
    await new Promise((r) => setImmediate(r));
    expect(seen.map((j) => [j.name, j.opts?.jobId])).toEqual([['notifications', 'n-1']]);
    expect(memoryQueue.length).toBe(0);
    expect(memoryQueueStats().consumerAttached).toBe(true);
  });

  it('keeps the buffer bounded when nothing consumes it', async () => {
    for (let i = 0; i < MEMORY_QUEUE_MAX + 25; i++) await enqueue('domain-events', { i });
    const stats = memoryQueueStats();
    expect(memoryQueue.length).toBe(MEMORY_QUEUE_MAX);
    expect(stats.dropped).toBeGreaterThanOrEqual(25);
    expect((memoryQueue[0]!.data as { i: number }).i).toBe(25);
  });
});
