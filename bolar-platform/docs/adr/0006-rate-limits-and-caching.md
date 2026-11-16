# ADR 0006: Rate limits and caching (Days 91-104)

- Status: accepted
- Date: 2026-11-09

## Context
The blueprint's hardening phase asks for rate limits and caching that respect tenant isolation: one tenant's burst
must never consume another tenant's budget, and a cached permission set must never be served to another org. The API
already carried a bespoke 5/min limiter on the DSAR intake; nothing protected login, invitation acceptance, webhooks
or authenticated traffic, and every request resolved roles with a database query.

## Decision: rate limiting (`packages/api/src/shared/rate-limit.ts`)
- **Algorithm.** Sliding window counter: two counters per key (current and previous minute); the estimate is
  `current + previous * (1 - elapsedFraction)`. Cheap, shared across replicas, and bounded at 2x the limit at a window
  edge. A burst drains over up to two windows, which the tests document (`t += 90 s` cases).
- **Stores.** Redis (`INCR` + `PEXPIRE` + `GET` in one `MULTI`, `SET NX` for the once-per-window audit marker) when
  `RATE_LIMIT_DRIVER=redis`, or `auto` and `REDIS_URL` answers a PING; otherwise an in-memory store with sweeping.
  Tests force memory with a fake clock. Store errors **fail open** and log a warning: a limiter outage is never an API outage.
- **Policies** (per minute, env-tunable with the spec defaults):

  | Policy | Key | Default |
  | --- | --- | --- |
  | login per IP | `login:ip:<ip>` | 10 (`RATE_LIMIT_LOGIN_PER_IP`) |
  | login per e-mail | `login:email:<sha256(lower(email))>` | 5 (`RATE_LIMIT_LOGIN_PER_EMAIL`) |
  | public intake per IP | `public:intake|invite|webhook:<provider>:ip:<ip>` | 60 (`RATE_LIMIT_PUBLIC_PER_IP`) |
  | authenticated per actor | `actor:<tenantOrgId>:<userId>` | 600 (`RATE_LIMIT_AUTHED_PER_ACTOR`) |

  Platform admins (`platform_admin` with platform scope) are exempt. Trusted IPs (`RATE_LIMIT_TRUSTED_IPS`; loopback
  by default outside production so local e2e, dev servers and CI runners are not throttled) bypass every policy.
  Login rejections use one generic message so the limiter never reveals whether an account exists.
- **Response.** `429 { code: "rate_limited", message, requestId }` with `Retry-After`, `RateLimit-Limit`,
  `RateLimit-Remaining` (the tightest applicable policy) and `RateLimit-Reset`. The first rejection of a key in a window
  writes one `rate_limit.exceeded` audit row (policy, hashed key, limit, path; actor/tenant when authenticated).
- **Placement.** After `buildContext` (needs the actor and roles) and after `express.json` (needs `body.email`), before
  the module routers. The DSAR intake keeps its stricter 5/min rule in the privacy module.

## Decision: caching (`packages/api/src/shared/cache.ts`)
- **`/me` roles + permissions** are cached per `(userId, tenantOrgId, sessionId)` for `CACHE_ME_TTL_SECONDS` (30 s).
  The key carries the tenant, so an `X-Tenant-Org` switch by a platform actor resolves a separate entry; a cached
  org-A entry can never answer an org-B request. Explicit invalidation (`invalidateUserCache`, `invalidateSessionCache`)
  is called on role grant/revoke, invitation acceptance, user suspend/deactivate, logout and support-session start/end,
  so permission changes apply on the next request. Session validity and user status are still checked live on every
  request; only the role lookup is cached.
- **Permission catalog and portal templates** are process-lifetime memoized (`memoizeForever`): pure functions of
  static tables, identical for every tenant.
- **What is not cached.** Resource data, access decisions, sensitive-access approvals: anything whose staleness could
  show a row to the wrong person.

## Verification
- `packages/api/src/__tests__/hardening-rate-limit.test.ts`: limit, `Retry-After`, generic message, audit once per
  window, sliding reset, per-e-mail across IPs, per-endpoint and per-provider public budgets, per-tenant/per-actor
  isolation (one tenant's burst never consumes another's budget), platform exemption, trusted loopback bypass,
  fail-open, unit math and policy mapping.
- `packages/api/src/__tests__/hardening-cache.test.ts`: hit/miss accounting, tenant-keyed entries, `X-Tenant-Org`
  switch resolving org-specific roles from separate entries (no bleed), grant/revoke through the API visible on the
  next request while a direct DB write without invalidation is not, suspend and logout dropping entries.
- Live check against Redis: 12 login attempts from one untrusted IP -> 10 handled, 2 x `429 Retry-After: 53`, one
  `rate_limit.exceeded` audit row, keys `bolar:rl:login:*:<windowStart>` in Redis (`docs/qa/hardening-qa.md`).

## Consequences
- Login throughput from one NAT address is capped at 10/min; large offices behind one IP may need
  `RATE_LIMIT_LOGIN_PER_IP` raised or an edge allowlist. The per-actor limit of 600/min is far above UI traffic
  (<= 60/min observed in the manager board scenario).
- Role changes propagate within one request instead of at the next request anyway; the only observable difference is
  one fewer `RoleAssignment` query per request within 30 s.
- Config rollback for any of these is an env change (`docs/runbooks/config-rollback.md`).
