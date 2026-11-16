# Go/no-go record (template)

Copy this file into the release issue for the candidate, fill every field, and attach the signatures. The record is
the evidence that the launch gate ([launch-gate.md](launch-gate.md)) was walked, item by item, on a named build. A
row without evidence counts as not met.

## Meeting

| Field | Value |
| --- | --- |
| Release candidate tag and commit | |
| Target environment and launch date | |
| Meeting date and time | |
| Attendees (name, role) | |
| Facilitator | release manager |
| Decision owners | founder, release manager; counsel for sections 3 and 7 |

## Gate walk-through

Status is one of: met, met with accepted risk (link the risk register entry), not met.

| Gate item | Launch checklist tasks | Evidence link | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 Cross-portal demo: all portals load with seed data; role matrix passes; mobile tenant home verified | L-03, L-20 to L-22 | | | |
| 2 Data integrity: migrate status clean, migrate test green, isolation suites green, ledger proof balanced, occupancy consistent | L-23 | | | |
| 3 Compliance active: rule engine on fixtures, queue hits, only counsel-reviewed rules active, notice approval and adverse-action waiting period enforced, privacy and legal hold and export chain exercised | L-05, L-24 | | | |
| 4 CI/CD green: ci and security green on the tag; staging deploy succeeded; previous tag recorded; rollback rehearsed | L-01, L-02, L-12, L-46 | | | |
| 5 Observability and resilience: health ok, logs with redaction, request id traceable, Sentry test error and alert, backup restored on scratch, workers processing, failed-job alerting | L-09 to L-11, L-13, L-26 | | | |
| 6 Security and privacy: no secrets in repo, production modes refused outside production, MFA for all staff, session revocation tested, access token decision recorded | L-06, L-08, L-25 | | | |
| 7 Human approvals: legal (templates, rules, retention), finance (no real payment credentials, adapters sandbox), founder (blockers classified) | L-05, L-06, L-29 | | | |

## UAT summary

| Persona | Script signed by | Steps passed / total | Open defects (id, severity) |
| --- | --- | --- | --- |
| Platform admin | | / 16 | |
| Org admin | | / 18 | |
| Property manager | | / 31 | |
| Landlord | | / 13 | |
| Tenant | | / 15 | |
| Bookkeeper | | / 14 | |
| Lawyer | | / 17 | |
| Vendor | | / 10 | |
| Compliance officer | | / 15 | |
| Government | | / 10 | |
| Corporate admin | | / 8 | |
| Occupant | | / 7 | |

Last smoke run: link to `docs/uat/last-run.md` at the candidate commit, verdict and timestamp.

## Defects and risks

| Severity | Open | Closed since UAT start | Launch-blocking per [uat/defect-triage.md](uat/defect-triage.md) |
| --- | --- | --- | --- |
| S1 | | | any open blocks |
| S2 | | | any open blocks unless accepted in writing |
| S3 | | | owner and date required |
| S4 | | | never |

Accepted risks (each with the risk register id, the accepting owner and the date):

| Risk id | Description | Accepted by | Mitigation and review date |
| --- | --- | --- | --- |
| | | | |

Known limits carried into launch (from `docs/uat/README.md`), confirmed still acceptable:

| Limit | Decision |
| --- | --- |
| Virus scanning no-op; thumbnails not generated | |
| Providers in mock or sandbox mode | |
| Nav links without pages (L-07) | |
| Login-time MFA step-up (L-08) | |

## Resilience evidence

| Check | Result | Link |
| --- | --- | --- |
| Restore drill on staging: duration, dump size, tables, rows, RTO, RPO | | |
| Rollback rehearsal: time from decision to healthy `/health` | | |
| Monitoring alert fired to the pager | | |
| Sentry test error routed | | |

## Decision

| Field | Value |
| --- | --- |
| Decision | GO / NO-GO |
| Conditions attached to a GO (if any) | |
| Date and time | |
| Founder signature | |
| Release manager signature | |
| Counsel signature (sections 3 and 7) | |

## Follow-ups after the decision

| Action | Owner | Due |
| --- | --- | --- |
| | | |
