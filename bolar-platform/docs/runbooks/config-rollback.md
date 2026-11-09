# Runbook: config change rollback (hardening controls)

Every hardening control added in Days 91-104 is switched by an environment variable with a safe default, so a bad
tuning is reverted by a config change and a restart, never by a code deploy. Values live in the environment file
exported from the secret manager (`/etc/bolar/<env>.env`, kept alongside `<env>.env.prev`); see
[deploy-rollback.md](deploy-rollback.md) for the generic procedure.

## 1. Before changing a value
1. Record the current value and the reason for the change in the release issue.
2. Change one variable at a time; wait one SLO window (5 minutes) and compare `routeClass` P95 and 5xx rate
   (`docs/slo.md`) before the next change.
3. Keep the previous environment file: `cp /etc/bolar/staging.env /etc/bolar/staging.env.prev`.

## 2. Rollback by control

| Symptom | Variable | Rollback value | Effect, time to apply |
| --- | --- | --- | --- |
| Legitimate users see `429 rate_limited`; `rate_limit.exceeded` audit rows from known office IPs | `RATE_LIMIT_LOGIN_PER_IP`, `RATE_LIMIT_PUBLIC_PER_IP`, `RATE_LIMIT_AUTHED_PER_ACTOR` | raise (e.g. 10 -> 50) or add the address to `RATE_LIMIT_TRUSTED_IPS` | next request after API restart |
| Limiter misbehaving or Redis unavailable (log `rate limiter failed open`) | `RATE_LIMIT_DRIVER` | `memory` (per-replica limits) or `RATE_LIMIT_ENABLED=0` to disable entirely | restart; limits stop immediately |
| Role change not visible for up to 30 s is unacceptable for an incident | `CACHE_ME_TTL_SECONDS` | `0` disables the /me cache | restart; one extra query per request |
| `permission denied` / `row-level security` errors after enabling RLS | `DB_RLS_ENFORCE` and `DATABASE_URL` | `DB_RLS_ENFORCE=0`; point `DATABASE_URL` back at the owner role | restart; policies stay installed and inert |
| Retries hammering a failing provider | `QUEUE_BACKOFF_BASE_MS`, `QUEUE_BACKOFF_MAX_MS`, `QUEUE_MAX_ATTEMPTS` | raise base/max, lower attempts | new jobs only (options are set at enqueue time) |
| Duplicate side effects suspected from the worker | `WORKER_IDEMPOTENCY_TTL_SECONDS` | raise (default 86400); `WORKER_IDEMPOTENCY_DRIVER=redis` to refuse the memory fallback | worker restart |
| Tracing/Sentry overhead or quota | `OTEL_EXPORTER_OTLP_ENDPOINT`, `SENTRY_DSN` | empty (both exporters become no-ops) | restart |
| Latency summary log too chatty | `OBS_HISTOGRAM_LOG_INTERVAL_MS` | `0` disables the summary line | restart |

Apply: edit the environment file, then `docker compose -f docker-compose.staging.yml up -d api workers` (or the
equivalent restart). Verify with `/health` (`uptime` resets, `queueDriver` as expected) and one portal login.

## 3. Rollback of the hardening migrations
Both migrations are additive and safe to leave in place; prefer the config rollback above.

- `*_hardening_indexes`: `DROP INDEX "RoleAssignment_userId_revokedAt_idx";` then
  `prisma migrate resolve --rolled-back 20261109183000_hardening_indexes`.
- `*_rls_policies`: policies only bite for `bolar_app`; to remove them entirely run, per table,
  `DROP POLICY tenant_isolation ON "<Table>"; DROP POLICY owner_bypass ON "<Table>"; ALTER TABLE "<Table>" DISABLE ROW LEVEL SECURITY;`
  (the table list is `rlsTables()` in `packages/db/src/rls.ts`), then `prisma migrate resolve --rolled-back 20261109180000_rls_policies`.
  Leave the `bolar_app` role; it is harmless when unused.

## 4. After the rollback
1. Confirm P95/5xx back within `docs/slo.md` for 15 minutes.
2. Note the rolled-back value and the observed symptom in `docs/qa/hardening-qa.md` ("Config changes" table) so the
   next tuning starts from data.
3. Open a follow-up to fix the root cause before re-enabling.
