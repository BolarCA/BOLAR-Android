# Runbook: monitoring and alerts

What the platform exposes today, how to watch it, which alerts to configure before launch, and the status page
wording to use. Where a capability is not yet wired in code this runbook says so and points at the launch task.

## Health checks

| Check | Call | Healthy | Unhealthy |
| --- | --- | --- | --- |
| API liveness and database | `GET /health` (public) | HTTP 200, body `{"status":"ok","checks":{"database":"ok"},"version":"<pkg version>","requestId":"<uuid>"}` | HTTP 503 with `"status":"degraded"` and `"database":"fail"`; a timeout or connection error means the API process is down |
| Web | `GET /login` | HTTP 200 with the sign-in form | 5xx or timeout |
| Platform summary (authenticated) | `GET /platform/health-summary` with a platform admin token, or the `/admin` overview card | dependency health plus org, user, session and support-session counts | missing card or `degraded` |
| Workers | Log line `bolar-workers started` with `queues` after each deploy; `job completed` at debug level, `job failed` at error level | failures absent or transient | repeated `job failed` for one queue, or no worker log lines after deploy |
| Redis | `enqueue failed` absent from API logs | | present: queue connection lost |
| Ledger integrity | `GET /ledger/proof` (bookkeeper token) | balanced | any imbalance is SEV1 |

## Uptime monitor configuration

Use any HTTP uptime service (the blueprint names a generic "uptime monitor"); configure two monitors per environment:

| Setting | API monitor | Web monitor |
| --- | --- | --- |
| URL | `https://<api>/health` | `https://<web>/login` |
| Interval | 60 s | 60 s |
| Locations | 2 regions | 2 regions |
| Success condition | HTTP 200 and body contains `"status":"ok"` | HTTP 200 and body contains `Sign in` |
| Alert after | 2 consecutive failures (2 minutes) | 3 consecutive failures |
| Notify | on-call pager plus incident channel | incident channel, pager after 10 minutes |
| Maintenance windows | deploy window from the launch checklist, suppress alerts for 15 minutes after a deploy |

The staging deploy workflow already polls `/health` for up to 150 seconds after rollout and rolls back on failure.

## Structured logs

Both services log JSON with pino. Fields to filter on:

| Field | Source | Meaning |
| --- | --- | --- |
| `service` | both | `bolar-api` or `bolar-workers` |
| `env` | api | `development`, `test`, `production` (from `NODE_ENV`) |
| `level` | both | pino numeric level; 50 is error, 40 warn, 30 info |
| `requestId` | api | same value as the `X-Request-Id` response header and the `requestId` in every error body; clients may send their own (8 to 128 URL-safe characters) |
| `req.method`, `req.url`, `res.statusCode`, `responseTime` | api (pino-http) | per request, disabled when `NODE_ENV=test` |
| `msg` = `request denied` with `code` | api | 401 or 403 answered; `code` is the error code (for example `forbidden`, `review_required`) |
| `msg` = `unhandled error` with `err`, `path` | api | a 500 was returned; the stack is in `err` |
| `msg` = `enqueue failed` with `queueName` | api | Redis unavailable |
| `queue`, `jobId`, `msg` = `job failed`, `err` | workers | a BullMQ job exhausted an attempt (5 attempts, exponential backoff from 2 s) |
| `signal` with `shutting down` | both | graceful shutdown on SIGTERM or SIGINT |

Redaction is applied before the line is written: `req.headers.authorization`, `req.headers.cookie`, and any field named
`password`, `passwordHash`, `refreshToken`, `accessToken`, `ssn`, `ssnLast4`, `token`, `secret`, `email`, `phone`,
`recipientAddress` appear as `[redacted]`. `LOG_LEVEL` controls verbosity (`warn` in e2e, `info` by default).

### Log-based alerts (configure in the log platform)

| Alert | Condition | Severity |
| --- | --- | --- |
| API errors | more than 5 `unhandled error` lines in 5 minutes | SEV2, SEV1 if sustained 15 minutes |
| Denied burst | more than 100 `request denied` lines from one `req.remoteAddress` or one actor in 5 minutes | security review (possible credential stuffing; lockout is 5 failures per account for 15 minutes) |
| Queue outage | any `enqueue failed` | SEV2 |
| Job failures | more than 3 `job failed` for the same `queue` in 10 minutes | SEV2 for `notifications`, SEV3 otherwise |
| Workers silent | no `bolar-workers` lines for 30 minutes after a deploy | SEV2 |
| Cross-tenant access | `support.cross_tenant_access` audit rows without an active support session outside business hours | review next morning |

## Sentry

`SENTRY_DSN` is read by the API configuration (`packages/api/src/config.ts`) and listed in the staging host
prerequisites, but this build does not initialise a Sentry SDK in `packages/api/src/server.ts`, the workers or the
web app, so no event is captured yet. Launch task L-09 wires `@sentry/node` (API and workers) and `@sentry/nextjs`
(web) with `tracesSampleRate` 0 and `sendDefaultPii` false, tags `service` and `env`, attaches `requestId` from the
error handler, and strips the redaction list above from breadcrumbs. Once wired, configure these alert rules:

| Rule | Condition | Action |
| --- | --- | --- |
| New issue in production | first seen, any level error | incident channel; pager for `bolar-api` |
| Regression | a resolved issue reappears | incident channel |
| Spike | more than 20 events of one issue in 10 minutes | pager |
| Payment or ledger errors | issue tags `module:finance` or message contains `ledger` | pager plus finance lead |
| Auth errors | message contains `token` or `session` at error level | security lead |

Launch gate row "Sentry DSN configured and a test error captured; alert routed" is satisfied by throwing a test
error from a protected route on staging after L-09 and showing the routed alert.

## Dashboards to keep open during launch week

- Uptime monitor overview (both monitors).
- Log view filtered to `level>=40` for both services.
- `/admin` overview (health summary and support sessions) and `/admin/audit` with Outcome `deny`.
- `/finance` dashboard proof for the pilot org (bookkeeper account).

## Status page content templates

Keep entries short, factual, free of internal names and request ids. Times in the customer's time zone.

Investigating (first post, within the severity's first-status target):

> We are investigating reports that <what users see: for example, the resident portal is not loading>. Started at
> <time>. Next update by <time>.

Identified:

> We have identified the cause (<plain-language cause: for example, a database connection issue>) and are applying a
> fix. <Which portals or actions are affected>. Next update by <time>.

Monitoring:

> A fix has been applied at <time> and the platform is operating normally. We are monitoring for 30 minutes before
> closing this incident.

Resolved:

> Resolved at <time>. Impact: <who and what was affected, for how long>. No data was lost. If you still see a
> problem, contact your property manager or support.

Scheduled maintenance (posted at least 48 hours ahead):

> Maintenance window <date, start to end>. Expected impact: <for example, sign-in unavailable for up to 10 minutes>.
> Rent payments and maintenance requests submitted during the window will be processed afterwards.

Data exposure (only with counsel's approval, wording from counsel):

> On <date> we identified <nature of the issue>. We have contained it and are contacting affected individuals
> directly. <Contact route>.

## Evidence for the launch gate

Record in the launch checklist: screenshots of both uptime monitors green, one deliberately failed check that paged
the on-call (stop the API on staging for 3 minutes during the T-7 rehearsal), the log alert configuration, and after
L-09 the Sentry test event with its routed alert.
