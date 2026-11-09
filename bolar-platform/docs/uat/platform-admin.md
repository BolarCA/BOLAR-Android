# UAT script: platform admin (/admin)

| | |
| --- | --- |
| Persona | BOLAR platform staff who operate the control plane across all customer organizations |
| Demo account | platform@bolar.test (platform org `bolar-platform`), password `Bolar!Demo2026` |
| Portal | `/admin` with Overview, Organizations, Users, Audit, Feature flags, Support sessions |
| Automated by | `tests/e2e/manager-ops.spec.ts` ("master admin control plane"), `tests/e2e/portal-matrix.spec.ts` |
| Estimated time | 25 minutes |

## Preconditions

- [last-run.md](last-run.md) is GREEN for the build under test.
- Seed present: organizations `bolar-platform` and `demo-pm` ("Demo Property Management") with its subaccount
  "Austin Region" and twelve demo users.
- No support session is active for `demo-pm` (end any leftover from `/admin/support-sessions`).
- Tester has a ticket reference to type as the support reason (any text of at least 10 characters).

## Steps

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| 1 | Open `/login`, sign in as platform@bolar.test | Redirected to `/admin`; sidebar "Primary" shows Overview, Organizations, Users, Audit, Feature flags, Support sessions | | |
| 2 | Read the health summary card | "API health ok", "db ok", Organizations count of at least 1, "Queue memory" (or `redis` when workers run on Redis) | | |
| 3 | Open Organizations | Table lists `demo-pm` with the link "Demo Property Management"; a "Create organization" action exists | | |
| 4 | Open "Demo Property Management" | Detail page with the org heading, a "Subaccounts" section listing Austin Region and "Recent audit activity" | | |
| 5 | Click "Start support session", leave the reason empty, submit | The form refuses: reason is required (minimum 10 characters) | | |
| 6 | Enter "Ticket #UAT-1: verify lease approvals page", Duration 15, click "Start session" | "Support session started"; after Done the button reads "Support session active" and is disabled | | |
| 7 | Click "Act as Demo Property Management" | Redirect to `/admin`; a banner "Support session active" naming Demo Property Management is visible; the overview says "Support session" | | |
| 8 | While acting as the org, open `/admin/audit` and filter Action prefix `support.` | Rows `support.session_started` and `support.cross_tenant_access` exist with your email as actor and the org as target | | |
| 9 | Click "Stop acting as org" in the banner | Banner disappears; you are back in the platform org context | | |
| 10 | Open Support sessions | The session with your ticket text is listed as "active"; "End support session for Demo Property Management" is available | | |
| 11 | End the session, then set Show to "all" | The row is gone from the active list and shows "ended" in the all view | | |
| 12 | Open Feature flags, click "New flag", key `uat.flag.<yourinitials>`, Rules (JSON) `{"rollout": 25}`, Create flag | "Flag ... created"; row shows scope `global` and state `disabled` | | |
| 13 | Click "Enable <key>" | Row shows `enabled` and the button becomes "Disable <key>" | | |
| 14 | Enter invalid JSON in a new flag (for example `{rollout}`) and submit | Validation error on the Rules field; no flag created | | |
| 15 | Open Users | Users of the platform org are listed; demo-pm users are not shown unless acting as the org | | |
| 16 | Sign out, sign in as tenant@demo.bolar.test, open `/admin`, `/admin/feature-flags`, `/admin/support-sessions` | Each shows the denied state; the network panel shows no request to `/orgs`, `/platform`, `/feature-flags` or `/support-sessions` | | |

## Business rules to confirm during the walk-through

- A support session is time-boxed (15 to 480 minutes), needs a written reason and is audited in both the platform
  org and the target org (`support.session_started`, `support.session_ended`).
- Acting as an org sends `X-Tenant-Org` on every request; every such request writes `support.cross_tenant_access`.
- Feature flags and support sessions are MFA-level routes: a staff account with MFA enrolled is prompted for the code
  on a fresh session (demo accounts have no MFA so no prompt appears; note this in the sign-off).

## Severity guidance for this script

Steps 7, 8 and 16 failing are S1 (cross-tenant access control). Steps 5, 6, 10, 11 are S2. Steps 12 to 14 are S3
unless a flag silently applies to the wrong org (S1). Full rubric: [defect-triage.md](defect-triage.md).

## Sign-off

| Field | Value |
| --- | --- |
| Tester (name, role) | |
| Build commit (from last-run.md) | |
| Date and environment | |
| Steps passed / total | / 16 |
| Defects filed (issue numbers, severity) | |
| Tester verdict (pass / pass with S3-S4 / fail) | |
