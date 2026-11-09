/**
 * Observability (blueprint Days 91-104, docs/slo.md).
 *
 * - `requestTiming()` classifies every request into a route class (auth, lists, detail, mutations, webhooks,
 *   reports, health) and records its duration in an in-process histogram. It is mounted first so its `finish`
 *   listener runs before pino-http's; pino-http then picks `routeClass`/`durationMs` up from `res.locals` and
 *   every request log line carries them. A summary (count, p50, p95, p99 per class) is logged periodically.
 * - `initTelemetry()` starts OpenTelemetry (OTLP/HTTP traces + http instrumentation) when
 *   OTEL_EXPORTER_OTLP_ENDPOINT is set and Sentry when SENTRY_DSN is set. Both are lazy imports and no-ops when
 *   unset, so the default install carries no exporter cost.
 */
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import { isAppError } from '@bolar/shared';
import { config, type Config } from '../config.js';
import { logger } from '../logger.js';
import { routeRegistry } from './route.js';

export type RouteClass = 'auth' | 'lists' | 'detail' | 'mutations' | 'webhooks' | 'reports' | 'health' | 'other';
export const ROUTE_CLASSES: readonly RouteClass[] = ['auth', 'lists', 'detail', 'mutations', 'webhooks', 'reports', 'health', 'other'];

const REPORT_TAGS = new Set(['packet-export', 'reporting']);
const REPORT_PATHS = [/^\/exports/, /^\/reports/, /^\/finance\/summary/, /^\/ledger\/(proof|trial-balance)/, /^\/invoices\/aging/, /\/summary$/];

/** Pure classification from method + matched route pattern (falls back to the raw path). */
export function classifyRoute(method: string, routePattern: string | undefined, rawPath: string, tags: readonly string[] = []): RouteClass {
  const m = method.toUpperCase();
  const pattern = routePattern ?? rawPath;
  if (pattern === '/health' || pattern.startsWith('/platform/health')) return 'health';
  if (pattern.startsWith('/auth/') || pattern === '/me') return 'auth';
  if (pattern.startsWith('/webhooks/')) return 'webhooks';
  if (tags.some((t) => REPORT_TAGS.has(t)) || REPORT_PATHS.some((re) => re.test(pattern))) return 'reports';
  if (m !== 'GET' && m !== 'HEAD') return 'mutations';
  const segments = pattern.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  if (last.startsWith(':') || /^c[a-z0-9]{20,}$/.test(last) || /^[0-9a-f-]{36}$/.test(last)) return 'detail';
  if (segments.length === 0) return 'other';
  return 'lists';
}

// ---------------------------------------------------------------------------------------------------------------
// Histogram
// ---------------------------------------------------------------------------------------------------------------

export const LATENCY_BUCKETS_MS: readonly number[] = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

export interface LatencySummary { count: number; p50: number; p95: number; p99: number; max: number; errors5xx: number }

export class LatencyHistogram {
  private readonly counts = new Map<RouteClass, number[]>();
  private readonly max = new Map<RouteClass, number>();
  private readonly errors = new Map<RouteClass, number>();

  record(cls: RouteClass, durationMs: number, status: number): void {
    let arr = this.counts.get(cls);
    if (!arr) { arr = new Array(LATENCY_BUCKETS_MS.length + 1).fill(0); this.counts.set(cls, arr); }
    let i = LATENCY_BUCKETS_MS.findIndex((b) => durationMs <= b);
    if (i < 0) i = LATENCY_BUCKETS_MS.length;
    arr[i] = (arr[i] ?? 0) + 1;
    this.max.set(cls, Math.max(this.max.get(cls) ?? 0, durationMs));
    if (status >= 500) this.errors.set(cls, (this.errors.get(cls) ?? 0) + 1);
  }

  /** Percentiles are the upper bound of the bucket where the cumulative share crosses p (conservative). */
  snapshot(): Partial<Record<RouteClass, LatencySummary>> {
    const out: Partial<Record<RouteClass, LatencySummary>> = {};
    for (const [cls, arr] of this.counts) {
      const count = arr.reduce((a, b) => a + b, 0);
      const pct = (p: number) => {
        const target = Math.ceil(count * p);
        let cum = 0;
        for (let i = 0; i < arr.length; i++) { cum += arr[i] ?? 0; if (cum >= target) return LATENCY_BUCKETS_MS[i] ?? Infinity; }
        return Infinity;
      };
      out[cls] = { count, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: this.max.get(cls) ?? 0, errors5xx: this.errors.get(cls) ?? 0 };
    }
    return out;
  }

  reset(): void { this.counts.clear(); this.max.clear(); this.errors.clear(); }
}

export const latencyHistogram = new LatencyHistogram();
export function getLatencySnapshot(): Partial<Record<RouteClass, LatencySummary>> { return latencyHistogram.snapshot(); }

let routeLookup: Map<string, readonly string[]> | null = null;
function tagsFor(method: string, routePattern: string | undefined): readonly string[] {
  if (!routePattern) return [];
  if (!routeLookup || routeLookup.size !== routeRegistry.length) {
    routeLookup = new Map(routeRegistry.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r.tags]));
  }
  return routeLookup.get(`${method.toUpperCase()} ${routePattern}`) ?? [];
}

let summaryTimer: NodeJS.Timeout | null = null;
function ensureSummaryTimer(cfg: Config): void {
  if (summaryTimer || cfg.OBS_HISTOGRAM_LOG_INTERVAL_MS <= 0 || cfg.NODE_ENV === 'test') return;
  summaryTimer = setInterval(() => {
    const snap = latencyHistogram.snapshot();
    if (Object.keys(snap).length) logger.info({ latency: snap }, 'request latency summary (ms, per route class)');
  }, cfg.OBS_HISTOGRAM_LOG_INTERVAL_MS);
  summaryTimer.unref();
}

/** Mount first in the chain. Never throws: a failure here must never fail a request. */
export function requestTiming(): RequestHandler {
  return (req: Request, res: Response, next) => {
    try {
      const cfg = config();
      ensureSummaryTimer(cfg);
      const start = process.hrtime.bigint();
      res.locals.routeClass = classifyRoute(req.method, undefined, req.path);
      res.on('finish', () => {
        try {
          const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
          const pattern = (req as Request & { route?: { path?: string } }).route?.path;
          const cls = classifyRoute(req.method, pattern, req.path, tagsFor(req.method, pattern));
          res.locals.routeClass = cls;
          res.locals.durationMs = Math.round(durationMs * 100) / 100;
          res.locals.routePattern = pattern ?? null;
          latencyHistogram.record(cls, durationMs, res.statusCode);
        } catch (err) {
          logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'request timing failed');
        }
      });
    } catch (err) {
      logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'request timing setup failed');
    }
    next();
  };
}

/** Extra fields for pino-http's per-request log line. */
export function timingLogProps(req: Request, res: Response): Record<string, unknown> {
  return { requestId: req.ctx?.requestId, routeClass: res.locals.routeClass ?? null, routePattern: res.locals.routePattern ?? null, durationMs: res.locals.durationMs ?? null };
}

// ---------------------------------------------------------------------------------------------------------------
// Exporters (lazy, optional)
// ---------------------------------------------------------------------------------------------------------------

export interface TelemetryState { otel: boolean; sentry: boolean }

interface SentryLike { init(o: Record<string, unknown>): void; captureException(e: unknown, hint?: Record<string, unknown>): string; flush?(ms?: number): Promise<boolean> }
let sentry: SentryLike | null = null;
let otelSdk: { shutdown(): Promise<void> } | null = null;
let telemetryPromise: Promise<TelemetryState> | null = null;

export function initTelemetry(cfg: Config = config()): Promise<TelemetryState> {
  if (!telemetryPromise) {
    telemetryPromise = (async () => {
      const state: TelemetryState = { otel: false, sentry: false };
      if (cfg.OTEL_EXPORTER_OTLP_ENDPOINT) {
        try {
          const [{ NodeSDK }, { HttpInstrumentation }, { OTLPTraceExporter }] = await Promise.all([
            import('@opentelemetry/sdk-node'),
            import('@opentelemetry/instrumentation-http'),
            import('@opentelemetry/exporter-trace-otlp-http'),
          ]);
          const sdk = new NodeSDK({
            serviceName: cfg.OTEL_SERVICE_NAME,
            traceExporter: new OTLPTraceExporter({ url: cfg.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '') + '/v1/traces' }),
            instrumentations: [new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => req.url === '/health' })],
          });
          sdk.start();
          otelSdk = sdk;
          state.otel = true;
          logger.info({ endpoint: cfg.OTEL_EXPORTER_OTLP_ENDPOINT }, 'opentelemetry tracing enabled');
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'opentelemetry init failed; continuing without tracing');
        }
      }
      if (cfg.SENTRY_DSN) {
        try {
          const mod = (await import('@sentry/node')) as unknown as SentryLike;
          mod.init({ dsn: cfg.SENTRY_DSN, environment: cfg.NODE_ENV, release: process.env.npm_package_version ?? '0.1.0', tracesSampleRate: 0, sendDefaultPii: false });
          sentry = mod;
          state.sentry = true;
          logger.info('sentry error reporting enabled');
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'sentry init failed; continuing without error reporting');
        }
      }
      return state;
    })();
  }
  return telemetryPromise;
}

export async function shutdownTelemetry(): Promise<void> {
  try { await otelSdk?.shutdown(); } catch { /* best effort */ }
  try { await sentry?.flush?.(2000); } catch { /* best effort */ }
  otelSdk = null;
  sentry = null;
  telemetryPromise = null;
  if (summaryTimer) { clearInterval(summaryTimer); summaryTimer = null; }
}

/** Report unexpected (non-AppError or 5xx) errors to Sentry when configured; always forwards to the next handler. */
export const errorReportingHook: ErrorRequestHandler = (err, req, _res, next) => {
  try {
    const expected = isAppError(err) && err.status < 500;
    if (!expected && sentry) sentry.captureException(err, { tags: { requestId: req.ctx?.requestId ?? 'unknown', routeClass: String(_res.locals.routeClass ?? 'other') } });
  } catch (hookErr) {
    logger.debug({ err: hookErr instanceof Error ? hookErr.message : String(hookErr) }, 'error reporting hook failed');
  }
  next(err);
};

export function resetObservabilityForTests(): void {
  latencyHistogram.reset();
  routeLookup = null;
}
