# Runbook: incident response

An incident is any event that degrades the platform for users or puts data at risk. This runbook says when to
declare one, who does what, how to mitigate with the controls that exist in this build, and how to close it. Monitoring
signals are described in [monitoring-and-alerts.md](monitoring-and-alerts.md); support hand-offs in
[support-escalation.md](support-escalation.md).

## Severity

| Level | Definition | Examples | Targets |
| --- | --- | --- | --- |
| SEV1 | Platform unavailable or data integrity or confidentiality at risk for any customer | `/health` 503 or unreachable for more than 5 minutes; cross-tenant data visible; payments recorded twice; sign-in broken for all users | acknowledge 15 min, first status 30 min, updates every 30 min, mitigation target 2 h |
| SEV2 | A portal or a core journey broken for many users, no workaround | Tenants cannot pay; leases cannot be approved; workers stopped processing (notifications and SLA scans silent); document downloads fail | acknowledge 30 min, updates every 2 h, mitigation target 8 h |
| SEV3 | Degradation with a workaround or affecting few users | Slow queue page; one org's feature flag misconfigured; a vendor cannot see one job | next business day; tracked as a defect |

Any suspected exposure of personal data is SEV1 regardless of the number of records, and counsel is paged.

## Roles

| Role | Does |
| --- | --- |
| Incident commander (on-call engineer by default) | Declares, owns the timeline, decides mitigations, hands over explicitly |
| Communications lead (tier 2 support lead) | Status page and customer updates, internal channel updates |
| Scribe | Records every action with timestamps in the incident channel |
| Subject experts (as needed) | Database, payments, auth, legal (counsel), security lead |

## Declare

1. Confirm the signal: `curl -s https://<api>/health` (expect `{"status":"ok","checks":{"database":"ok"},...}`),
   open `/login` on the web, check the uptime monitor and the error log for `unhandled error` or `job failed`.
2. Post the declaration in the incident channel: severity, what users see, since when, commander, next update time.
3. Open a `launch-task`-style tracking issue titled `INC-<date>-<short name>` and link it.
4. Publish the "Investigating" status page entry ([monitoring-and-alerts.md](monitoring-and-alerts.md) templates).

## Triage checklist

- `/health`: `checks.database` `fail` means PostgreSQL is unreachable or saturated; `ok` with user-facing errors
  points at the application, auth or storage.
- Logs: filter `service=bolar-api level>=50` for `unhandled error` (has `requestId`, `path`, `err`); `request
  denied` spikes indicate a role, session or token problem; `service=bolar-workers` `job failed` with `queue` and
  `jobId` for processing issues; `enqueue failed` means Redis is down.
- Trace a user report by `requestId` from the error toast to the log line (`X-Request-Id`).
- Recent change: compare the running image tag (`/etc/bolar/previous_tag` holds the one before) with the last deploy;
  check whether a migration ran (`pnpm prisma:migrate:status`).
- Audit: `/admin/audit` for `access.denied` bursts, `support.cross_tenant_access` you do not recognise, role grants.

## Mitigations available in this build

| Situation | Action | Where |
| --- | --- | --- |
| Bad deploy | Roll back api, workers, web to the previous tag | [deploy-rollback.md](deploy-rollback.md) |
| Bad migration | Stop api and workers, apply the PR's down SQL, `prisma migrate resolve --rolled-back`, redeploy previous image | [deploy-rollback.md](deploy-rollback.md) |
| Config change | Restore `staging.env.prev` and `docker compose up -d` | [deploy-rollback.md](deploy-rollback.md) |
| A feature misbehaves for one org or everyone | Disable the feature flag (`/admin/feature-flags`, "Disable <key>") | admin portal |
| Suspected account compromise | Suspend the user (`/subaccount/users`, "Suspend"): every session is revoked at once; invitations can be revoked | subaccount portal |
| Suspected token compromise platform-wide | Rotate `AUTH_JWT_SECRET` in the secret manager and restart api: all access tokens become invalid and users sign in again | host config |
| Support agent misuse | End the support session (`/admin/support-sessions`), suspend the agent, export the audit trail | admin portal |
| Database unreachable | Fail over the managed instance; if data is lost, restore the latest snapshot or dump into a fresh database following the drill and repoint `DATABASE_URL` | [restore-drill.md](restore-drill.md), [backup-restore.md](backup-restore.md) |
| Redis down | Workers stop; the API keeps serving (`enqueue failed` logged, requests still succeed where enqueue is best effort). Restart Redis; jobs are re-enqueued from source records because handlers are idempotent | host |
| Payment webhooks failing | Provider retries; `WebhookEvent` uniqueness prevents double posting on replay; verify the ledger proof after recovery (`GET /ledger/proof`) | finance portal |
| Signed document links failing | Check `STORAGE_*` settings and clock skew (links carry `exp`); tampered or expired links answer 404 by design | api config |
| Notice or adverse action sent in error | Notices cannot be unsent; counsel decides the corrective communication; record in the case | legal portal |

Never mitigate a data exposure by deleting audit rows or records under legal hold; the audit log is append-only and
holds are enforced in code.

## Data exposure specifics (SEV1)

1. Contain: suspend the involved accounts, end support sessions, disable the feature flag or roll back.
2. Preserve: export the audit manifest for the window (`GET /audit/export`) and take a database dump into a scratch
   database (the restore drill script does this) for forensics.
3. Scope: identify which orgs and which records; the `tenantOrgId` on every row and the audit log make this
   tractable.
4. Notify: counsel decides on regulator and individual notifications and timing; communications lead drafts with
   counsel; nothing is sent without counsel's approval.
5. Fix forward with a regression test (tenant isolation suite plus a case for the specific leak).

## Communicate

- Internal channel: declaration, every mitigation step, hand-overs, resolution.
- Status page: Investigating, Identified, Monitoring, Resolved entries at the cadence of the severity table.
- Customers with a ticket: tier 2 replies with the status page link.

## Resolve and learn

1. Declare resolved when the signal has been healthy for 30 minutes (SEV1) or 2 hours (SEV2) and the smoke run is
   green (`scripts/uat-smoke.sh` on staging, or `pnpm e2e:smoke` with `WEB_BASE_URL`).
2. Postmortem within 5 business days using this outline: summary, impact (users, orgs, duration, data), timeline,
   root cause, what went well, what went badly, action items with owners and dates, whether the launch gate or a
   runbook needs a change.
3. Link the postmortem from the incident issue and from the risk register if a risk changed.

## Rehearsal

Before launch (checklist task L-12) run a tabletop of two scenarios: a bad deploy rolled back with
[deploy-rollback.md](deploy-rollback.md), and a database loss recovered with `scripts/restore-drill.sh --keep`
followed by repointing a local API at the scratch copy. Record timings in the launch checklist.
