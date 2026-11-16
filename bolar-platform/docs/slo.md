# Service level objectives (blueprint Days 91-104)

Scope: the BOLAR API (`packages/api`), workers and the web app in staging and production. Targets are per route
class; the classification is computed by `packages/api/src/shared/observability.ts` (`classifyRoute`) and stamped on
every request log line as `routeClass`, so the same labels appear in logs, k6 thresholds (`load/k6/*.js`) and this
document.

## Route classes

| Class | What it covers | Examples |
| --- | --- | --- |
| auth | sign-in, token refresh, MFA, `/me` | `POST /auth/login`, `GET /me` |
| lists | GET routes that return a page (`items`, `nextCursor`), including child lists | `GET /work-orders`, `GET /properties/:id/units` |
| detail | GET of one resource (last path segment is an id) | `GET /properties/:id`, `GET /documents/:id/versions/:versionId/download` |
| mutations | POST/PATCH/PUT/DELETE that change state | `POST /payments`, `PATCH /users/:id` |
| webhooks | inbound provider callbacks | `POST /webhooks/stripe` |
| reports | summaries, exports and packet generation | `GET /finance/summary`, `POST /exports` |
| health | liveness | `GET /health` |

## Availability

| Service | Objective (30-day window) | Error budget | Measured by |
| --- | --- | --- | --- |
| API | 99.9 % of requests not 5xx (429 and 4xx excluded) | 43 min 49 s / month | request logs (`statusCode`, `routeClass`), Sentry issue count, `/health` probe every 30 s from the uptime monitor |
| Workers | 99.9 % of jobs succeed within `QUEUE_MAX_ATTEMPTS` | same | BullMQ failed-job count in Redis Insight, `job failed` log lines |
| Web | 99.5 % of page loads served | 3 h 36 m / month | uptime monitor on `/login` |

Error budget policy: when more than 50 % of the monthly budget is consumed, feature deploys pause and the next
release is hardening-only until the burn rate is back under 1x for 72 hours. A single incident that burns more than
25 % of the budget gets a post-mortem in `docs/runbooks/` within 5 working days.

## Latency (server side, P95 over 5-minute windows)

| Class | P95 target | P99 guide | Rationale |
| --- | --- | --- | --- |
| auth | 400 ms | 800 ms | scrypt password verification dominates; `/me` is cached 30 s (ADR 0006) |
| lists | 300 ms | 600 ms | every list is a bounded page (<= 100 rows) backed by a tenant-leading index |
| detail | 200 ms | 400 ms | primary-key lookups plus access checks |
| mutations | 500 ms | 1 s | includes audit write, event publish and idempotency store |
| webhooks | 300 ms | 600 ms | ack fast; side effects run in workers |
| reports | 2 s (sync) | 5 s | aggregates; anything heavier runs as an export job (P95 completion <= 5 min) |
| health | 50 ms | 100 ms | one `SELECT 1` |

Queue freshness: domain events are consumed within 30 s at P95; retention sweep and SLA scans complete inside their
schedule window.

## How the numbers are measured

1. **Request logs (pino).** `requestTiming()` runs first in the middleware chain and sets `res.locals.routeClass`,
   `routePattern` and `durationMs`; pino-http includes them on every request line (`customProps`). A
   `request latency summary` line with count/p50/p95/p99/max/errors5xx per class is logged every
   `OBS_HISTOGRAM_LOG_INTERVAL_MS` (default 60 s). Log queries per class are the source of truth for the SLO.
2. **`/health`.** Returns `status`, dependency `checks`, `version`, `uptime` (seconds) and `queueDriver`; the uptime
   monitor counts non-200 answers against the availability budget.
3. **Sentry.** Enabled by `SENTRY_DSN`; only unexpected errors (non-`AppError` or 5xx) are reported via
   `errorReportingHook`, tagged with `requestId` and `routeClass`. Expected 4xx are never sent.
4. **OpenTelemetry.** Enabled by `OTEL_EXPORTER_OTLP_ENDPOINT`; HTTP server spans for every route (health excluded).
   Locally: `docker compose --profile observability up -d` and open Jaeger on `http://localhost:16686`.
5. **Load tests.** `load/k6/*.js` thresholds use the same numbers (`SLO_P95` in `load/k6/lib.js`); the fallback
   loop `load/local-p95.ts` prints pass/fail per scenario. Results are recorded in `docs/qa/hardening-qa.md`.

## Alerting (staging first)

| Signal | Threshold | Action |
| --- | --- | --- |
| 5xx rate per class | > 0.5 % for 10 min | page on-call; check Sentry, roll back per `docs/runbooks/config-rollback.md` |
| P95 per class | > target for 15 min | investigate slow query log and `EXPLAIN` (`scripts/explain-report.ts`) |
| `rate_limit.exceeded` audit rows | > 100 / 5 min for one key | possible credential stuffing; review IP, consider blocking at the edge |
| Failed jobs | > 10 in 5 min on one queue | inspect in Redis Insight; handler is idempotent so re-running is safe |
| `/health` degraded | 2 consecutive probes | database connectivity incident |
