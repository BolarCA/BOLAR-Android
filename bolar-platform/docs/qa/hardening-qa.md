# Performance and hardening QA (blueprint Days 91-104)

Scope: SLOs (`docs/slo.md`), rate limits and caching (ADR 0006), pagination audit, queue backoff and worker
idempotency, PostgreSQL row-level security (ADR 0005), EXPLAIN-justified indexes, observability, load scenarios.
Database `bolar_agent3`, API port 4123, web port 3123. Synthetic data only; all adapters in `mock` mode.

## How to reproduce

```bash
cd bolar-platform
pnpm --filter @bolar/api exec vitest run hardening            # 21 tests: rate limits, cache, pagination, observability
pnpm --filter @bolar/db test                                  # 9 tests incl. the RLS proof (needs CREATEROLE on the DB user)
pnpm --filter @bolar/workers test                             # 6 tests: idempotent job wrapper
pnpm exec tsx load/seed-volume.ts && pnpm exec tsx scripts/explain-report.ts
API_PORT=4123 QUEUE_DRIVER=memory pnpm --filter @bolar/api dev &
BASE_URL=http://localhost:4123 pnpm exec tsx load/local-p95.ts
export API_PORT=4123 WEB_PORT=3123 QUEUE_DRIVER=memory
pnpm exec playwright test --config tests/playwright.config.ts --trace off tests/e2e/access.spec.ts
```

The API and db suites truncate the configured database; re-run `pnpm db:seed && pnpm db:seed:demo` before e2e.

## Results summary

| Check | Command | Result |
| --- | --- | --- |
| Root lint / typecheck | `pnpm lint && pnpm typecheck` | pass (14/14 tasks each; one pre-existing openapi description-length warning in contracts) |
| API suite | `pnpm --filter @bolar/api test` | pass, 33 files / 217 tests (4 new hardening files, 21 tests) |
| DB suite | `pnpm --filter @bolar/db test` | pass, 9 tests (4 new RLS tests) |
| Workers suite | `pnpm --filter @bolar/workers test` | pass, 6 tests |
| Migration scratch test | `pnpm db:migrate:test` | pass (5 migrations incl. `rls_policies`, `hardening_indexes`) |
| Schema vs database | `prisma migrate diff --from-schema-datasource --to-schema-datamodel` | "No difference detected" |
| OpenAPI | `pnpm openapi:generate` | 248 operations; `Health` gains `uptime`, `queueDriver` |
| E2E | `tests/e2e/access.spec.ts` on 4123/3123 | pass 9/9 (portals, denied state, generic login error, invite flow, axe) with the limiter, cache and timing middleware mounted |
| k6 scripts | `node --check load/k6/*.js` | 5/5 syntax ok (k6 binary not installable in the sandbox; see load/README.md) |
| Volume seed | `load/seed-volume.ts` twice | 5000 rows x 11 tables in 4.0 s; second run "ok" for every table (idempotent) |

## 1. P95 (local loop, 200 requests x 10 concurrent per scenario, client-observed ms)

Node 22 fetch against the volume-seeded org (`load-pm`, ~5k rows per table) with the API on 4123 (`tsx`, no build,
`LOG_LEVEL=info`, Redis-backed limiter). Server-side numbers are lower; these include client overhead.

| Scenario | Class | p50 | p95 | p99 | max | 5xx | SLO p95 | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GET /health | health | 11.2 | 24.9 | 32.4 | 44.2 | 0 | 50 | pass |
| POST /auth/login | auth | 129.6 | 205.5 | 234.3 | 244.9 | 0 | 400 | pass |
| GET /me | auth | 19.3 | 28.7 | 31.6 | 33.0 | 0 | 400 | pass |
| GET /work-orders?limit=25 | lists | 32.2 | 55.2 | 64.3 | 66.1 | 0 | 300 | pass |
| GET /work-orders?overdue=true&limit=25 | lists | 39.0 | 58.3 | 68.7 | 87.0 | 0 | 300 | pass |
| GET /properties?status=active&limit=25 | lists | 32.9 | 52.7 | 56.1 | 58.7 | 0 | 300 | pass |
| GET /properties/:id | detail | 39.9 | 55.6 | 60.5 | 64.8 | 0 | 200 | pass |
| GET /invoices?limit=25 | lists | 36.2 | 62.1 | 85.8 | 87.4 | 0 | 300 | pass |
| GET /audit?limit=25 | lists | 23.3 | 33.2 | 37.0 | 39.3 | 0 | 300 | pass |
| GET /documents?ownerType=property&ownerId=:id&limit=25 | lists | 16.6 | 26.0 | 29.2 | 33.1 | 0 | 300 | pass |
| GET /rules/evaluations?result=block&reviewed=false&limit=25 | lists | 24.0 | 38.2 | 46.1 | 52.9 | 0 | 300 | pass |
| GET /tenant-profiles?q=Resident 12&limit=25 | lists | 39.4 | 67.9 | 92.9 | 110.4 | 0 | 300 | pass |

Login is dominated by scrypt (by design, blueprint p22). `/me` at 19 ms p50 reflects the 30 s role cache: the only
database work left is the session and user status checks.

## 2. Pagination audit

- Startup assertion (`assertBoundedListRoutes` in `createApp`): 47 page-returning GET routes, each with a `limit`
  that defaults to <= 100 and rejects 101. No offenders in the registry; a synthetic offender fails `createApp()`
  with `Unbounded list routes ... no limit query parameter`.
- Query audit (`hardening-pagination.test.ts`) over `packages/api/src/modules/**/*.ts`: 100+ `findMany` calls.
  Bounded by `take`, by an id `in`-list derived from a page, or by the current actor. Offenders fixed by adding
  `take` (small edits in other modules, each a parent-bounded or catalog list):

  | File | Query | Cap |
  | --- | --- | --- |
  | `auth/service.ts` | login candidates by e-mail | 10 (ambiguity check) |
  | `compliance/jurisdiction.ts` | active rules for a jurisdiction chain | 500 |
  | `compliance/service.ts` | unresolved block evaluations for a resource | 100 |
  | `document/routes.ts` (x2) | versions of a document | 100 |
  | `document/service.ts`, `legal-hold/service.ts` | active legal holds of an org | 500 |
  | `finance/invoice/service.ts` | parties of a lease | 50 |
  | `finance/ledger/service.ts` | chart of accounts | 1000 |
  | `lease/routes.ts`, `lease/service.ts` | occupying leases of a unit | 50 |
  | `legal/routes.ts` | holds covering a case | 100 |
  | `legal-hold/service.ts` | lease parties of a profile | 200 |
  | `privacy/service.ts` (x2) | users by e-mail; confirmation templates | 10 |
  | `property/routes.ts` | buildings of a property | 100 |
  | `retention/service.ts` | retention policy catalog | 500 |
  | `screening/routes.ts` (x2) | orders / adverse actions of an application | 50 |
  | `tenant/routes.ts` | business accounts of an org | 100 |

  Eight remaining call sites are listed with justifications in `packages/api/src/__tests__/pagination-allowlist.json`
  (batch jobs, aggregates, owner-scope computation); the test fails on stale entries and on new unlisted calls.
  Follow-ups: chunk invoice generation by cursor; move the aging/KPI aggregates to SQL `groupBy`.

## 3. Rate limits (`hardening-rate-limit.test.ts`, memory store, fake clock)

| Fixture | Result | What it proves |
| --- | --- | --- |
| login per IP | pass | 10 handled, 11th `429 rate_limited` with `Retry-After` 1-60 s; a correct password is still refused while limited; exactly one `rate_limit.exceeded` audit row per window with policy/limit/path and a hashed key (raw IP absent); allowed again 90 s later (sliding); other IPs unaffected |
| login per e-mail | pass | 5 failures across 5 IPs -> 6th `429` with the generic message; unknown e-mail from the same IPs still gets the normal generic 401 (limiter does not leak existence); another account keeps its budget |
| public intake | pass | `/invitations/accept`, `/privacy-requests/intake`, `/webhooks/stripe` have separate per-IP budgets; `/webhooks/plaid` has its own; 3 audit rows (one per key) |
| per-actor isolation | pass | manager A hits the limit from IP X; manager B (other tenant) and admin A (same tenant) from the same IP keep full budgets; audit row carries tenant A / actor A; budget fully restored after two windows |
| platform exemption | pass | `platform_admin` sends 8 requests over a 5-limit, all 200 |
| trusted IP | pass | 12 failed logins from loopback (no X-Forwarded-For) are all 401, never 429 |
| fail open / disable | pass | a throwing store lets requests through (logged); `enabled=false` ignores a 1-request budget |
| unit | pass | sliding estimate at window boundaries; policy mapping (keys, hashing, trailing slash, platform/trusted exemptions) |

Live against Redis (API on 4123, `RATE_LIMIT_DRIVER=auto` -> `"driver":"redis"` in the log): 12 login attempts from
`X-Forwarded-For: 203.0.113.99` -> 10 handled, 2 x `429 Retry-After: 53`; one audit row `rate_limit.exceeded /
login_ip / 10`; counter keys `bolar:rl:login:email:<hash>:<windowStart>` present in Redis.

## 4. Cache and tenant bleed (`hardening-cache.test.ts`)

| Fixture | Result | What it proves |
| --- | --- | --- |
| hit/miss | pass | second `/me` is a cache hit; entry exists for `(user, orgA, session)` and not for `(user, orgB, session)`; cached roles all carry orgA |
| X-Tenant-Org switch | pass | platform admin with a bookkeeper role in org B only: `/me` for home org, org A and org B resolve from three separate entries; org A view (cached) never shows the org-B role; org B's manager resolves its own key |
| grant/revoke invalidation | pass | a direct DB role insert is not visible (cache in effect); `POST /roles` and `DELETE /roles/:id` are visible on the next request |
| suspend / logout | pass | `PATCH /users/:id status=suspended` drops the user's entries and the token is 401; `POST /auth/logout` drops the session entry; helper counts for user/session invalidation |
| unit | pass | TTL expiry, predicate eviction, size bound, zero TTL, memoize identity |

## 5. Queue backoff and worker idempotency

- `backoffDelayMs`: 2000, 4000, ... 32000 ms for attempts 1-5 (rand=0), halved at full jitter, capped at
  `QUEUE_BACKOFF_MAX_MS` (300 s); BullMQ receives `attempts`, `backoff: { exponential, delay, jitter }` from the same
  settings (`hardening-observability.test.ts`).
- `withIdempotency` (`packages/workers/src/__tests__/idempotency.test.ts`): runs once and skips redeliveries per
  (queue, jobId); same id on another queue runs; a failing handler releases the marker so the retry runs; markers
  expire after the TTL; jobs without an id always run; a broken store fails open with a warning; the Redis store uses
  `SET NX EX` / `DEL`; `auto` falls back to memory when Redis is unreachable.

## 6. Row-level security proof (`packages/db/src/__tests__/rls.test.ts`)

Connected as `bolar_app_rls_test LOGIN ... IN ROLE bolar_app` (non-owner; the local `bolar` role is a superuser with
`Bypass RLS`, so it cannot be used for the proof):

| Step | Result |
| --- | --- |
| 58 tenant-scoped tables have RLS enabled and the `tenant_isolation` policy; committed migration equals `rlsPolicySql()` | pass |
| without `app.tenant_id`: Property 0, Lease 0, Invoice 0, Document 0, AuditLog 1 (the platform-level NULL-tenant row only) | pass |
| `withTenantRls(app, orgA, ...)`: exactly one row each (tenant A) across the five tables; `count()` with no where clause = 1 | pass |
| `withTenantRls(app, orgB, ...)`: Prop B only; setting gone after the transaction; count back to 0 | pass |
| insert for org B inside org A's transaction -> `row-level security` error; legit insert ok; owner client unaffected | pass |
| `forTenant(app, orgA, { rls: true })` reads through the policy; `forTenant(app, orgA)` as the app role sees nothing (RLS really enforcing); explicit cross-tenant where returns 0 | pass |

API suite and db suite stay green with `DB_RLS_ENFORCE=0` (default).

## 7. EXPLAIN ANALYZE (scripts/explain-report.ts, 5k rows per table)

Table sizes: Property=5002, WorkOrder=5000, Invoice=5000, AuditLog=5001, Document=5000, RuleEvaluation=5000,
TenantProfile=5000, UserProfile=5004, RoleAssignment=5004.

| Query | Route | Before | After | Exec ms |
| --- | --- | --- | --- | --- |
| work-order board (open, newest first) | `GET /work-orders?limit=25` | index (`WorkOrder_tenantOrgId_createdAt_id_idx`) | unchanged | 0.09 |
| work-order board (overdue) | `GET /work-orders?overdue=true&limit=25` | index | unchanged | 0.74 |
| work-order board (property + status) | `GET /work-orders?propertyId=&status=assigned` | index (`tenantOrgId, propertyId, status`) | unchanged | 0.08 |
| invoices list | `GET /invoices?limit=25` | index (`tenantOrgId, createdAt, id`) | unchanged | 0.03 |
| invoices overdue | `GET /invoices?overdue=true` | index | unchanged | 0.05 |
| audit by action prefix | `GET /audit?action=lease.` | index (`tenantOrgId, createdAt`) | unchanged | 0.04 |
| audit by resource | `GET /audit?resourceType=&resourceId=` | index (`tenantOrgId, resourceType, resourceId`) | unchanged | 0.05 |
| audit by actor + window | `GET /audit?actorId=&from=` | index (`tenantOrgId, actorId, createdAt`) | unchanged | 0.07 |
| documents by owner | `GET /documents?ownerType=&ownerId=` | index (`tenantOrgId, ownerType, ownerId`) | unchanged | 0.05 |
| rule evaluations queue | `GET /rules/evaluations?result=block&reviewed=false` | index (`tenantOrgId, result, createdAt`) + PK join | unchanged | 0.19 |
| tenant profile search | `GET /tenant-profiles?status=active&q=` | index (`tenantOrgId, status`) + ILIKE filter | unchanged | 5.74 |
| property list by status + city | `GET /properties?status=active&city=Austin` | index (`tenantOrgId, status, city` prefix) + ILIKE filter | unchanged | 0.16 |
| property keyset page 2 | `GET /properties?cursor=` | index (`tenantOrgId, createdAt, id`) | unchanged | 8.46 |
| **role resolution per request** | every authenticated request | **Seq Scan on RoleAssignment, 5003 rows removed by filter, 1.90 ms** | **Index Scan using `RoleAssignment_userId_revokedAt_idx`, 0.021 ms** | 1.90 -> 0.02 |
| active support session lookup | cross-tenant requests | Seq Scan (table has 0 rows; planner choice on an empty table) | no index added (index `tenantOrgId, agentUserId` exists) | 0.01 |

The schema already carried tenant-leading composite indexes for every list route, so the only index justified by a
plan change is `RoleAssignment(userId, revokedAt)` (migration `20261109183000_hardening_indexes`). The two ILIKE
searches stay index-range + filter; a trigram index is the next step if `q` searches exceed 50 ms at 50k rows.

Before (role resolution):
```
Limit  (cost=0.00..192.57 rows=1 width=165) (actual time=0.007..1.890 rows=1 loops=1)
  ->  Seq Scan on "RoleAssignment"  (cost=0.00..192.57 rows=1 width=165) (actual time=0.007..1.889 rows=1 loops=1)
        Filter: (("revokedAt" IS NULL) AND ("userId" = '...') AND (("tenantOrgId" = '...') OR ("scopeType" = 'platform')))
        Rows Removed by Filter: 5003
Execution Time: 1.901 ms
```
After:
```
Limit  (cost=0.28..8.31 rows=1 width=165) (actual time=0.014..0.014 rows=1 loops=1)
  ->  Index Scan using "RoleAssignment_userId_revokedAt_idx" on "RoleAssignment"  (cost=0.28..8.31 rows=1 width=165)
        Index Cond: (("userId" = '...') AND ("revokedAt" IS NULL))
        Filter: (("tenantOrgId" = '...') OR ("scopeType" = 'platform'))
Execution Time: 0.021 ms
```

## 8. Observability (`hardening-observability.test.ts`)

- `classifyRoute` maps auth/lists/detail/mutations/webhooks/reports/health as in `docs/slo.md`.
- `requestTiming()` sets `routeClass`, `routePattern`, `durationMs` on finish, never throws (bare request object
  case), and pino-http includes them via `timingLogProps`; the histogram counts the request under its class
  (`/health`, `/properties`, `/properties/:id`, login verified end to end).
- `initTelemetry()` resolves `{ otel: false, sentry: false }` with both env keys empty; `errorReportingHook` forwards
  the error unchanged. With `OTEL_EXPORTER_OTLP_ENDPOINT`/`SENTRY_DSN` set, the SDKs are imported lazily (deps added to
  `@bolar/api`); `docker compose --profile observability` provides a collector + Jaeger.
- `/health` returns `uptime` and `queueDriver` (verified live: `"uptime":31,"queueDriver":"memory"`).

## 9. Config changes applied during this phase

| Change | Rollback | Observed |
| --- | --- | --- |
| New env keys with defaults (`RATE_LIMIT_*`, `CACHE_ME_TTL_SECONDS`, `DB_RLS_ENFORCE`, `QUEUE_BACKOFF_*`, `OTEL_*`, `OBS_*`) | unset / previous values, see `docs/runbooks/config-rollback.md` | `pnpm env:check` OK (48 keys) |
| `RoleAssignment_userId_revokedAt_idx` | `DROP INDEX` | 1.90 ms -> 0.02 ms |
| RLS policies installed, enforcement off | `DB_RLS_ENFORCE=0` (already default) | no behaviour change for the owner role |

## Risks and follow-ups
- Login per-IP default (10/min) can throttle large offices behind one NAT; raise `RATE_LIMIT_LOGIN_PER_IP` or list the
  address in `RATE_LIMIT_TRUSTED_IPS` (runbook).
- The RLS read path is reads-only; mutations rely on ADR 0003 plus `WITH CHECK`. Enabling enforcement needs the
  `bolar_app` LOGIN member and the owner URL for migrations.
- OpenTelemetry http instrumentation is initialised lazily after Express has loaded; for complete server spans start
  the process with the SDK preloaded (`node --import`) once the collector is deployed.
- k6 runs were not possible in this environment; the scripts are syntax-checked and must be executed before the
  release candidate (load/README.md section 5).
