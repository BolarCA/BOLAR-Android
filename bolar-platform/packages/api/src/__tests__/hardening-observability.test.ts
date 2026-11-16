/**
 * Observability + queue backoff (Days 91-104): request timing fields per route class, exporters are no-ops when
 * unset, /health reports uptime and the queue driver, backoff is exponential with jitter and capped.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import { twoTenantFixture } from '@bolar/testing';
import { testApp, asUser } from './helpers.js';
import { classifyRoute, LatencyHistogram, requestTiming, timingLogProps, initTelemetry, errorReportingHook, getLatencySnapshot, resetObservabilityForTests, LATENCY_BUCKETS_MS } from '../shared/observability.js';
import { backoffDelayMs } from '../shared/queue.js';
import { config } from '../config.js';

describe('observability middleware and exporters', () => {
  let fx: Awaited<ReturnType<typeof twoTenantFixture>>;
  beforeAll(async () => { fx = await twoTenantFixture(); });

  it('classifies routes into SLO classes', () => {
    expect(classifyRoute('GET', '/health', '/health')).toBe('health');
    expect(classifyRoute('POST', '/auth/login', '/auth/login')).toBe('auth');
    expect(classifyRoute('GET', '/me', '/me')).toBe('auth');
    expect(classifyRoute('POST', '/webhooks/:provider', '/webhooks/stripe')).toBe('webhooks');
    expect(classifyRoute('GET', '/properties', '/properties')).toBe('lists');
    expect(classifyRoute('GET', '/properties/:id', '/properties/cmabc123456789012345678')).toBe('detail');
    expect(classifyRoute('GET', '/properties/:id/units', '/properties/cm1/units')).toBe('lists');
    expect(classifyRoute('GET', undefined, '/properties/cmabc123456789012345678')).toBe('detail');
    expect(classifyRoute('PATCH', '/properties/:id', '/properties/x')).toBe('mutations');
    expect(classifyRoute('POST', '/exports', '/exports', ['packet-export'])).toBe('reports');
    expect(classifyRoute('GET', '/finance/summary', '/finance/summary')).toBe('reports');
    expect(classifyRoute('GET', '/exports/:id', '/exports/x', ['packet-export'])).toBe('reports');
    expect(classifyRoute('GET', undefined, '/')).toBe('other');
  });

  it('histogram reports conservative percentiles per class and counts 5xx', () => {
    const h = new LatencyHistogram();
    for (let i = 0; i < 95; i++) h.record('lists', 20, 200);
    for (let i = 0; i < 5; i++) h.record('lists', 900, 500);
    const s = h.snapshot().lists!;
    expect(s.count).toBe(100);
    expect(s.p50).toBe(25);
    expect(s.p95).toBe(25);
    expect(s.p99).toBe(1000);
    expect(s.max).toBe(900);
    expect(s.errors5xx).toBe(5);
    h.record('detail', 99_999, 200);
    expect(h.snapshot().detail!.p50).toBe(Infinity);
    expect(LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]).toBe(10000);
  });

  it('requestTiming adds routeClass/durationMs on finish and never throws', async () => {
    const mw = requestTiming();
    const res = Object.assign(new EventEmitter(), { locals: {} as Record<string, unknown>, statusCode: 200 });
    const req = { method: 'GET', path: '/properties/cmabc123456789012345678', route: { path: '/properties/:id' } };
    let nextCalled = false;
    mw(req as never, res as never, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    expect(res.locals.routeClass).toBe('detail');
    res.emit('finish');
    expect(res.locals.routeClass).toBe('detail');
    expect(res.locals.routePattern).toBe('/properties/:id');
    expect(typeof res.locals.durationMs).toBe('number');
    expect(res.locals.durationMs as number).toBeGreaterThanOrEqual(0);
    const props = timingLogProps({ ctx: { requestId: 'r1' } } as never, res as never);
    expect(props).toMatchObject({ requestId: 'r1', routeClass: 'detail', routePattern: '/properties/:id' });
    // a request object missing everything still does not throw
    const bare = Object.assign(new EventEmitter(), { locals: {}, statusCode: 500 });
    expect(() => { mw({ method: 'GET', path: '/' } as never, bare as never, () => {}); bare.emit('finish'); }).not.toThrow();
  });

  it('exporters are no-ops when OTEL_EXPORTER_OTLP_ENDPOINT and SENTRY_DSN are unset; the error hook forwards errors', async () => {
    const cfg = config();
    expect(cfg.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').toBe('');
    expect(cfg.SENTRY_DSN ?? '').toBe('');
    await expect(initTelemetry(cfg)).resolves.toEqual({ otel: false, sentry: false });
    const err = new Error('boom');
    let forwarded: unknown = null;
    errorReportingHook(err, { ctx: { requestId: 'r' } } as never, { locals: {} } as never, (e: unknown) => { forwarded = e; });
    expect(forwarded).toBe(err);
  });

  it('/health exposes uptime and the queue driver; the histogram records the request under its class', async () => {
    resetObservabilityForTests();
    const before = getLatencySnapshot().health?.count ?? 0;
    const r = await request(testApp()).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(typeof r.body.uptime).toBe('number');
    expect(r.body.queueDriver).toBe('memory');
    expect(r.headers['x-request-id']).toBeTruthy();
    expect(getLatencySnapshot().health!.count).toBe(before + 1);
    const m = await asUser(fx.managers.a);
    await m.get('/properties');
    await m.get(`/properties/${fx.propA.id}`);
    const snap = getLatencySnapshot();
    expect(snap.lists!.count).toBeGreaterThanOrEqual(1);
    expect(snap.detail!.count).toBeGreaterThanOrEqual(1);
    expect(snap.auth!.count).toBeGreaterThanOrEqual(1); // the login
  });

  it('queue backoff is exponential with jitter and capped', () => {
    const s = { maxAttempts: 5, baseMs: 2000, maxMs: 300_000, jitter: 0.5 };
    expect(backoffDelayMs(1, s, () => 0)).toBe(2000);
    expect(backoffDelayMs(2, s, () => 0)).toBe(4000);
    expect(backoffDelayMs(5, s, () => 0)).toBe(32_000);
    expect(backoffDelayMs(1, s, () => 1)).toBe(1000); // full jitter can halve the delay
    expect(backoffDelayMs(20, s, () => 0)).toBe(300_000); // capped
    const d = backoffDelayMs(3, s);
    expect(d).toBeGreaterThanOrEqual(4000);
    expect(d).toBeLessThanOrEqual(8000);
    expect(backoffDelayMs(1)).toBeGreaterThan(0); // env-driven defaults
  });
});
