# Load testing (blueprint Days 91-104)

Scenarios, a volume seed and a fallback latency loop for the performance and hardening phase. Thresholds mirror
[docs/slo.md](../docs/slo.md); results and the EXPLAIN plans live in [docs/qa/hardening-qa.md](../docs/qa/hardening-qa.md).
Everything here runs against synthetic data only.

## 1. Inflate a database to ~5k rows per table

```bash
cd bolar-platform
pnpm exec tsx load/seed-volume.ts                 # uses DATABASE_URL from .env; creates org `load-pm`
LOAD_ROWS=20000 pnpm exec tsx load/seed-volume.ts # bigger
LOAD_DATABASE_URL=postgresql://bolar@localhost:5432/bolar_load pnpm exec tsx load/seed-volume.ts  # separate database
```

Idempotent: re-running tops tables up to `LOAD_ROWS` and leaves the demo org untouched. Personas (password
`Bolar!Demo2026`): `admin@load.bolar.test`, `manager@load.bolar.test`, `tenant@load.bolar.test`, `books@load.bolar.test`.

## 2. EXPLAIN ANALYZE the hot queries

```bash
pnpm exec tsx scripts/explain-report.ts            # markdown report; exit message lists queries with a seq scan
pnpm exec tsx scripts/explain-report.ts --json
```

Only a query whose plan shows a sequential scan on its main table justifies a new index (see
`packages/db/prisma/migrations/*_hardening_indexes`).

## 3. k6 scenarios

Install k6 (`https://grafana.com/docs/k6/latest/set-up/install-k6/`), start the API, then:

```bash
export BASE_URL=http://localhost:4123 ORG_SLUG=load-pm MANAGER_EMAIL=manager@load.bolar.test TENANT_EMAIL=tenant@load.bolar.test
k6 run load/k6/login.js            # auth P95 < 400 ms; 429 (not 5xx) under abuse from an untrusted IP
k6 run load/k6/manager-board.js    # lists P95 < 300 ms, detail P95 < 200 ms while 10 VUs browse the board
k6 run load/k6/tenant-pay.js       # lists + mutations P95 < 500 ms; Idempotency-Key replay served from the store
k6 run load/k6/webhooks-burst.js   # 20 rps webhook burst; P95 < 300 ms, no 5xx; limiter answers 429 per provider
```

Each script fails its run when a threshold is missed (`http_req_duration{class:...}` percentiles, `http_req_failed`
< 1 %). Loopback is a trusted address outside production, so the limiter is bypassed for a local run; to exercise
it, run k6 from another host or set `RATE_LIMIT_TRUSTED_IPS=` to an address you are not using.

k6 is not available in the build sandbox; the scripts were validated with `node --check` (ES module syntax) and
reviewed against the k6 API (`http`, `check`, `Rate`, scenario executors, tagged thresholds).

## 4. Fallback: local P95 loop (no k6)

```bash
API_PORT=4123 QUEUE_DRIVER=memory pnpm --filter @bolar/api dev &
BASE_URL=http://localhost:4123 CONCURRENCY=10 REQUESTS=200 pnpm exec tsx load/local-p95.ts
```

Prints p50/p95/p99/max per scenario (client-observed) with a pass/fail against the SLO targets and exits non-zero
on a miss. Server-side numbers (per route class) are in the API logs: every request line carries `routeClass` and
`durationMs`, and a `request latency summary` line is logged every `OBS_HISTOGRAM_LOG_INTERVAL_MS`.

## 5. CI

A `load-smoke` job was not added to `.github/workflows/ci.yml`: k6 cannot be validated in this environment and the
seeded run exceeds the two-minute budget. Run sections 1-3 manually before a release candidate and attach the k6
summary to the release issue (see `docs/runbooks/config-rollback.md` for what to roll back when a threshold fails).
