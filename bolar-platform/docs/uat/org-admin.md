# UAT script: org admin (/subaccount)

| | |
| --- | --- |
| Persona | Administrator of a customer organization: staff, roles, sensitive-access approvals, privacy requests, retention, audit |
| Demo account | orgadmin@demo.bolar.test (org `demo-pm`), password `Bolar!Demo2026` |
| Portal | `/subaccount` with Overview, Staff & roles, Access requests, Privacy requests, Retention, Audit. The role also unlocks `/owner`, `/manager`, `/finance` and `/compliance` |
| Automated by | `tests/e2e/access.spec.ts` ("staff administration"), `tests/e2e/portal-matrix.spec.ts` |
| Estimated time | 30 minutes |

## Preconditions

- [last-run.md](last-run.md) GREEN.
- Seed present: a pending sensitive access request from manager@demo.bolar.test for the tenant profile "Theo Tenant"
  (purpose `lease_administration`); one privacy access request in `discovery`; retention policies
  `documents.general` and `lease.records` with assignments on the two seeded documents and the active lease.
- The tester has an email address they control for the invitation (any synthetic address under `@demo.bolar.test`
  is fine; the invite link is read from the invitations table, mail is not delivered in mock mode).

## Steps

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| 1 | Sign in as orgadmin@demo.bolar.test | Lands on `/subaccount`; KPI cards "Active staff", "Open invitations", "Access approvals"; quick links to Staff and roles and Audit | | |
| 2 | Open Staff & roles | Heading "Staff and roles"; the eleven demo users are listed with their roles and status `active` | | |
| 3 | Click "Invite user", enter `uat.<initials>@demo.bolar.test`, Role `property_manager`, "Send invitation" | "Invitation sent to <email>"; after Done the invitations row shows `pending` | | |
| 4 | Click "Revoke invitation for <email>" | Row shows `revoked` | | |
| 5 | Invite the same address again, then open `/accept-invite` in a private window using the token from the invitation (ask engineering for `GET /invitations` output or the seeded mail sink) | Account is created and lands in `/manager`; the invitation row shows `accepted` | | Optional when no mail sink is available; record as skipped |
| 6 | On the row for Vera Vendor click "Suspend" | Status badge shows `suspended`; the user's sessions are revoked (a signed-in vendor window is sent back to login on its next request) | | |
| 7 | Click "Reactivate" on the same row | Status badge shows `active`; audit shows two `user.update` rows | | |
| 8 | Open Access requests | Heading "Sensitive access requests"; the seeded request from Marcus Manager for Theo Tenant is listed with purpose and justification | | |
| 9 | Click "Approve 8h" | Request shows approved with an expiry eight hours ahead; an audit row records the decision with your user as approver | | |
| 10 | Sign in as manager@demo.bolar.test in another window, open the Theo Tenant profile, "Reveal sensitive fields" | Fields now show (SSN last 4 `0000`, date of birth) instead of the review-required state | | |
| 11 | Back as org admin, revoke the grant | Manager's reveal returns to review-required on reload | | |
| 12 | Open Privacy requests | The seeded access request in `discovery` is listed with a countdown chip; opening it shows discovery counts | | |
| 13 | Open Retention | Sections "Policies" and "Assignments"; policies `documents.general` and `lease.records` are listed; "Run sweep" is available | | |
| 14 | Click "Run sweep" | Sweep completes; assignments due for disposition move to a proposed state; nothing is deleted without "Approve" | | |
| 15 | Under "New retention policy" enter Key `uat.test`, a Name, Retain days `30`, pick any Disposition from the list, save | Policy appears under "Policies" | | |
| 16 | Open Audit, filter Action prefix `invitation.` | Rows `invitation.create` and `invitation.revoke` from steps 3 and 4 with your email as actor | | |
| 17 | Filter Outcome `deny` | Any denied attempts recorded during the session appear (for example from step 18) | | |
| 18 | Sign in as tenant@demo.bolar.test, open `/subaccount/users` | Denied state; no `/users` request is sent | | |

## Business rules to confirm

- An invitation carries exactly one role and the org scope; roles outside `ROLE_SCOPES` are refused.
- Sensitive access decisions cannot be made by the requester; the grant is time-boxed and revocable.
- Retention sweep proposes dispositions; an accountable human approves before anything is disposed.
- Every create, update, revoke and decision leaves an audit row that the org admin can see in `/subaccount/audit`.

## Severity guidance

Steps 9 to 11 and 18 failing are S1 (sensitive data gate). Steps 3, 4, 6, 14 are S2. Steps 1, 2, 12, 13, 15, 16, 17
are S3 unless data from another org appears (S1). Rubric: [defect-triage.md](defect-triage.md).

## Sign-off

| Field | Value |
| --- | --- |
| Tester (name, role) | |
| Build commit (from last-run.md) | |
| Date and environment | |
| Steps passed / total | / 18 |
| Defects filed (issue numbers, severity) | |
| Tester verdict (pass / pass with S3-S4 / fail) | |
