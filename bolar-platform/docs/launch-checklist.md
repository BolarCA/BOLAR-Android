# Launch checklist (Days 105-120)

Expands [launch-gate.md](launch-gate.md) into dated, owner-assigned tasks. Planned pilot launch is Day 120 of the
blueprint schedule: Tuesday 2027-01-12 (Day 60 was 2026-11-09). If the date moves, the release manager re-dates every
row by the same offset and notes the change in the release issue. Each task is tracked as a GitHub issue created from
the `Launch task` form (`.github/ISSUE_TEMPLATE/launch-task.yml`) on the launch project board; the Evidence column
links the artefact the gate signer will look at.

Owners are roles; the release manager fills the names in the release issue at T-14. Severity of a missed task:
blocking tasks must be done before the go/no-go meeting; others are carried as accepted risks in the risk register.

## T-14: Tuesday 2026-12-29

| Id | Task | Owner | Gate section | Blocking | Evidence |
| --- | --- | --- | --- | --- | --- |
| L-01 | Freeze the release candidate: tag the commit, CI `checks` and `security` green, `pnpm openapi:check`, `pnpm docs:lint`, `pnpm env:check` green | release manager | 4 | yes | CI run links on the tag |
| L-02 | Deploy the candidate to staging with `deploy-staging.yml`; record `previous_tag` | engineering lead | 4 | yes | workflow run, `/etc/bolar/previous_tag` content |
| L-03 | Run `scripts/uat-smoke.sh` against staging data and commit `docs/uat/last-run.md` GREEN | UAT lead | 1 | yes | [uat/last-run.md](uat/last-run.md) |
| L-04 | Schedule the twelve UAT sessions with real users per persona; send quick starts and cheat sheets | UAT lead | 1 | yes | calendar, [training/README.md](training/README.md) |
| L-05 | Counsel review of templates, active rules, retention defaults for the pilot jurisdictions (US-TX, US-CA); open a `Counsel review` issue per artefact | counsel | 3, 7 | yes | issues from `counsel-review.yml`, [counsel-review-map.md](counsel-review-map.md) |
| L-06 | Confirm provider modes on staging: `STRIPE_MODE`, `PLAID_MODE`, `DOCUSIGN_MODE`, `TRANSUNION_MODE`, `IDME_MODE` are `mock` or `sandbox`; no production credentials anywhere; `pnpm env:check` refuses live keys | finance lead, security lead | 6, 7 | yes | `env:check` output, secret manager listing (names only) |
| L-07 | Fix or hide the sidebar links without pages: `/vendor/schedule`, `/vendor/documents`, `/corporate-admin/spend` (`apps/web/lib/nav.ts`), and add an app-level not-found page | web lead | 1 | no | PR, route matrix spec green |
| L-08 | Add login-time MFA step-up in the web app (the API already returns `mfaRequired`; the profile page verifies codes) and enforce MFA enrolment for all staff accounts on staging | web lead, security lead | 6 | yes | PR, `access.spec.ts` extended, staff MFA report from `/me` |
| L-09 | Wire Sentry (`@sentry/node` in api and workers, `@sentry/nextjs` in web) with the redaction list from [runbooks/monitoring-and-alerts.md](runbooks/monitoring-and-alerts.md); configure alert rules; capture a test error and show the routed alert | engineering lead | 5 | yes | Sentry issue link, alert notification screenshot |
| L-10 | Staging backup restore drill with `scripts/restore-drill.sh` from the weekly dump; record RTO and RPO | engineering lead | 5 | yes | drill output pasted into the release issue per [runbooks/restore-drill.md](runbooks/restore-drill.md) |
| L-11 | Configure uptime monitors for `/health` and `/login` and the log-based alerts; create the status page with the templates | engineering lead | 5 | yes | monitor dashboard screenshot, status page URL |
| L-12 | Tabletop rehearsal: bad deploy rolled back per [runbooks/deploy-rollback.md](runbooks/deploy-rollback.md); database loss recovered per [runbooks/restore-drill.md](runbooks/restore-drill.md); timings recorded | on-call engineer, release manager | 4, 5 | yes | rehearsal notes with timings |
| L-13 | Publish the on-call rota for launch week and the support tiers; test the pager path from the uptime monitor (stop the staging API for 3 minutes) | engineering lead, support lead | 5 | yes | rota, pager notification screenshot, [runbooks/support-escalation.md](runbooks/support-escalation.md) |

## T-7: Tuesday 2027-01-05

| Id | Task | Owner | Gate section | Blocking | Evidence |
| --- | --- | --- | --- | --- | --- |
| L-20 | UAT sessions complete for all twelve personas; every script signed; defects triaged per [uat/defect-triage.md](uat/defect-triage.md) | UAT lead | 1 | yes | signed scripts, defect board |
| L-21 | Zero open S1 and S2 defects; S3 items have owners and dates | engineering lead | 1 | yes | defect board filter |
| L-22 | Fix build deployed to staging; `scripts/uat-smoke.sh` GREEN on it; failed UAT steps re-verified by the testers | release manager, UAT lead | 1, 4 | yes | [uat/last-run.md](uat/last-run.md), issue comments "verified on <commit>" |
| L-23 | Data integrity pass on staging: `pnpm prisma:migrate:status` clean, `pnpm db:migrate:test` green in CI, tenant isolation suites green, `GET /ledger/proof` balanced, lease occupancy consistent per [qa/lease-qa.md](qa/lease-qa.md) | data reviewer, finance lead | 2 | yes | command outputs in the release issue |
| L-24 | Compliance pass on staging: seeded rule fixtures evaluate, queue shows hits, only counsel-reviewed rules active, notice approval and adverse-action waiting period enforced, privacy intake, legal hold exclusion and export approval chain exercised end to end | compliance lead, counsel | 3 | yes | compliance officer and lawyer UAT scripts signed, manifest export file |
| L-25 | Security pass: `security.yml` green, no secrets in repo, production modes refused outside production, MFA enabled for all staff accounts, session revocation tested (Suspend), access token storage decision recorded (ADR 0002 accepted or risk accepted in writing) | security lead | 6 | yes | workflow run, ADR link, risk register entry |
| L-26 | Observability pass: `/health` ok, structured logs flowing with redaction, a request id traced from a UI error toast to the log line, Sentry test error captured and alert routed, workers processing, failed-job alert fired once on purpose | engineering lead | 5 | yes | log excerpts (redacted fields visible as `[redacted]`), alert screenshots |
| L-27 | Pilot customer onboarding dry run with the [training/admin-onboarding-checklist.md](training/admin-onboarding-checklist.md) on a fresh staging org, then delete the org | support lead | 1 | no | checklist completed with dates |
| L-28 | Draft the go/no-go record from [go-no-go-template.md](go-no-go-template.md) with every gate row linked to evidence | release manager | 7 | yes | draft in the release issue |
| L-29 | Risk register review: every "launch blocker = yes" risk re-checked; unresolved blockers classified accept or fix by the founder | founder, release manager | 7 | yes | [risk-register.md](risk-register.md) updated |

## T-1: Monday 2027-01-11

| Id | Task | Owner | Gate section | Blocking | Evidence |
| --- | --- | --- | --- | --- | --- |
| L-40 | Go/no-go meeting: founder, release manager, counsel sign; decision recorded | founder, release manager, counsel | 7 | yes | signed [go-no-go-template.md](go-no-go-template.md) copy in the release issue |
| L-41 | Production environment prepared from [../infra/staging/README.md](../infra/staging/README.md) with production values: `NODE_ENV=production`, `AUTH_JWT_SECRET` from the secret manager, `STORAGE_DRIVER=s3`, `EMAIL_DRIVER=sendgrid`, provider modes agreed with finance (sandbox stays until the payments control checklist in [qa/finance-qa.md](qa/finance-qa.md) is signed), `SENTRY_DSN` set | engineering lead | 4, 6 | yes | env key listing (names only), `pnpm env:check` on the host |
| L-42 | Production database created, migrations applied (`prisma migrate deploy`), base seed only (`pnpm db:seed` creates the permission catalog, platform templates and retention defaults; the demo seed is never run in production), backups scheduled | engineering lead | 2 | yes | `migrate status` output, backup schedule screenshot |
| L-43 | Pilot organization created and first admin invited per the onboarding checklist steps 1 to 3; no demo accounts in production | platform admin | 1 | yes | platform audit rows |
| L-44 | Final smoke on production with read-only checks: `/health` ok, `/login` renders, platform admin signs in with MFA, no data | release manager | 5 | yes | screenshots |
| L-45 | Status page scheduled-maintenance notice posted; customer launch communication ready; support rota confirmed for launch day | support lead | 5 | yes | status page entry |
| L-46 | Rollback readiness: `previous_tag` recorded, config backup `staging.env.prev` equivalent for production, the rollback commands from [runbooks/deploy-rollback.md](runbooks/deploy-rollback.md) pasted into the release issue | on-call engineer | 4 | yes | release issue section |

## Launch day: Tuesday 2027-01-12

| Id | Task | Owner | Gate section | Blocking | Evidence |
| --- | --- | --- | --- | --- | --- |
| L-50 | Deploy the signed release candidate tag to production during the maintenance window; watch `/health` and the uptime monitors | release manager, on-call engineer | 4 | yes | deploy log, monitor green |
| L-51 | Post-deploy verification: platform admin overview healthy, pilot org admin signs in and completes onboarding steps 4 to 6 (invite staff, approve one access request, confirm templates), first property and unit created | platform admin, pilot org admin | 1 | yes | audit rows, screenshots without personal data |
| L-52 | First restore-drill verification on production data: `scripts/restore-drill.sh --skip-tests` against a snapshot or the first dump, scratch dropped | engineering lead | 5 | yes | drill output |
| L-53 | Hypercare starts: on-call primary and secondary online, support tier 2 staffed, incident channel open, dashboards from [runbooks/monitoring-and-alerts.md](runbooks/monitoring-and-alerts.md) open | engineering lead, support lead | 5 | yes | channel post |
| L-54 | Status page set to operational; launch communication sent | support lead | 5 | no | status page entry |

## T+1: Wednesday 2027-01-13

| Id | Task | Owner | Gate section | Blocking | Evidence |
| --- | --- | --- | --- | --- | --- |
| L-60 | 24-hour review: uptime, error counts, `job failed` count, denied bursts, support tickets by tier, any incident | engineering lead, support lead | 5 | no | review notes in the release issue |
| L-61 | Audit review of the first day: `support.cross_tenant_access` rows all tied to tickets; no unexpected role grants; no `access.denied` bursts | security lead | 6 | no | audit export manifest |
| L-62 | Ledger proof balanced on production; first invoices and payments reconcile | finance lead | 2 | no | `GET /ledger/proof` output |
| L-63 | Defects found in hypercare triaged with the UAT rubric; S1 and S2 fixed or rolled back the same day | engineering lead | 1 | yes | defect board |
| L-64 | Retrospective scheduled for T+7; carry remaining S3 and S4 items, the known limits from [uat/README.md](uat/README.md) and the accepted risks into the post-launch backlog | release manager | 7 | no | retrospective invite, backlog links |

## Standing rules

- A task is done only when its evidence link is in the release issue and the owner has ticked it there.
- Any blocking task not done by the go/no-go meeting means NO-GO unless the founder accepts the risk in writing in the
  risk register, with counsel's agreement for sections 3 and 7.
- The release manager re-runs `scripts/uat-smoke.sh` after every deploy to staging and commits the result.
