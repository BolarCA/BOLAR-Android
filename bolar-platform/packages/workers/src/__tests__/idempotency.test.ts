import { describe, it, expect } from 'vitest';
import { MemoryProcessedJobStore, RedisProcessedJobStore, withIdempotency, createProcessedJobStore } from '../idempotency.js';

describe('worker job idempotency wrapper (Days 91-104)', () => {
  it('runs a job once and skips redeliveries with the same jobId per queue', async () => {
    const store = new MemoryProcessedJobStore();
    let runs = 0;
    const run = withIdempotency('domain-events', async () => { runs++; }, { store });
    expect(await run({}, 'job-1')).toBe('processed');
    expect(await run({}, 'job-1')).toBe('skipped_duplicate');
    expect(await run({}, 'job-1')).toBe('skipped_duplicate');
    expect(runs).toBe(1);
    // same id on another queue is a different job
    const other = withIdempotency('notifications', async () => { runs++; }, { store });
    expect(await other({}, 'job-1')).toBe('processed');
    expect(runs).toBe(2);
  });

  it('releases the marker when the handler fails so the retry can run', async () => {
    const store = new MemoryProcessedJobStore();
    let attempts = 0;
    const run = withIdempotency('exports', async () => { attempts++; if (attempts === 1) throw new Error('transient'); }, { store });
    await expect(run({}, 'j')).rejects.toThrow('transient');
    expect(await run({}, 'j')).toBe('processed');
    expect(await run({}, 'j')).toBe('skipped_duplicate');
    expect(attempts).toBe(2);
  });

  it('expires markers after the TTL and always runs jobs without an id', async () => {
    let now = 1_000_000;
    const store = new MemoryProcessedJobStore(() => now);
    let runs = 0;
    const run = withIdempotency('q', async () => { runs++; }, { store, ttlSeconds: 60 });
    await run({}, 'a');
    now += 59_000;
    expect(await run({}, 'a')).toBe('skipped_duplicate');
    now += 2_000;
    expect(await run({}, 'a')).toBe('processed');
    expect(await run({}, undefined)).toBe('processed');
    expect(await run({}, null)).toBe('processed');
    expect(runs).toBe(4);
  });

  it('fails open when the store errors, and logs it', async () => {
    const warnings: string[] = [];
    const broken = { kind: 'redis' as const, claim: async () => { throw new Error('ECONNREFUSED'); }, release: async () => {} };
    let runs = 0;
    const run = withIdempotency('q', async () => { runs++; }, { store: broken, logger: { info: () => {}, warn: (_o, m) => warnings.push(m) } });
    expect(await run({}, 'x')).toBe('processed');
    expect(runs).toBe(1);
    expect(warnings[0]).toMatch(/store unavailable/);
  });

  it('redis store uses SET NX EX and DEL', async () => {
    const calls: string[] = [];
    const keys = new Set<string>();
    const fake = {
      set: async (k: string, _v: string, _ex: 'EX', _s: number, _nx: 'NX') => { calls.push(`set ${k}`); if (keys.has(k)) return null; keys.add(k); return 'OK'; },
      del: async (k: string) => { calls.push(`del ${k}`); return keys.delete(k) ? 1 : 0; },
      quit: async () => 'OK',
      disconnect: () => {},
    };
    const store = new RedisProcessedJobStore(fake);
    expect(await store.claim('q', '1', 10)).toBe(true);
    expect(await store.claim('q', '1', 10)).toBe(false);
    await store.release('q', '1');
    expect(await store.claim('q', '1', 10)).toBe(true);
    expect(calls).toEqual(['set bolar:jobs:processed:q:1', 'set bolar:jobs:processed:q:1', 'del bolar:jobs:processed:q:1', 'set bolar:jobs:processed:q:1']);
  });

  it('memory driver is selected explicitly or when redis is unreachable in auto mode', async () => {
    expect((await createProcessedJobStore('redis://localhost:6379', 'memory')).kind).toBe('memory');
    const warned: string[] = [];
    const s = await createProcessedJobStore('redis://127.0.0.1:1', 'auto', { info: () => {}, warn: (_o, m) => warned.push(m) });
    expect(s.kind).toBe('memory');
    expect(warned.some((m) => /redis unavailable/.test(m))).toBe(true);
  });
});
