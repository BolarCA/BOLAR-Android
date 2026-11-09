# UAT script: occupant (/occupant)

| | |
| --- | --- |
| Persona | Person housed under a corporate or household arrangement who is not the lease holder: sees housing status, files requests and reads shared documents |
| Demo account | occupant@demo.bolar.test ("Omar Occupant"), password `Bolar!Demo2026` |
| Portal | `/occupant` with Home, Requests, Documents |
| Automated by | `tests/e2e/portal-matrix.spec.ts` ("corporate admin and occupant landings render dashboards with empty states") |
| Estimated time | 10 minutes |

## Preconditions

- [last-run.md](last-run.md) GREEN.
- The demo seed creates the occupant user without a lease or unit relationship, so the script verifies the designed
  empty states, the "cannot file requests" guidance and the gating. For a pilot, link the occupant to a lease
  (relationship `occupant_of` or a tenant party) and extend the script with the request journey from the tenant
  script steps 7 to 10.

## Steps

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| 1 | Sign in as occupant@demo.bolar.test | Lands on `/occupant`, heading "Welcome, Omar"; sections "My housing" and "My requests" render with explicit empty states, never "Nothing to show yet" | | |
| 2 | Open Requests | Heading "Maintenance" (shared intake); because no lease is linked the form is replaced by "Your account cannot file requests" with the advice to ask the property manager to link the lease | | |
| 3 | Open Documents | Documents list with its empty state (no documents shared with this occupant) | | |
| 4 | Run axe on the home page | No serious or critical WCAG 2.0 A/AA violations | | |
| 5 | On a phone-width window check the layout | Content fits without horizontal scrolling; navigation is reachable | | |
| 6 | Paste `/tenant`, `/manager`, `/corporate-admin` | Denied state on each; no domain requests | | |
| 7 | Sign out, open `/occupant` | Redirected to `/login` | | |

## Business rules to confirm

- An occupant without a relationship to a lease or unit sees nothing but their own account; the intake form is not
  offered rather than failing on submit.
- Portal gating is role-based (`occupant`) and the denied state fetches no data.

## Severity guidance

Step 6 failing is S1. Steps 1 to 3 are S3 (S2 if the page errors). Steps 4, 5 are S3. Rubric:
[defect-triage.md](defect-triage.md).

## Sign-off

| Field | Value |
| --- | --- |
| Tester (name, role) | |
| Build commit (from last-run.md) | |
| Date and environment | |
| Steps passed / total | / 7 |
| Defects filed (issue numbers, severity) | |
| Tester verdict (pass / pass with S3-S4 / fail) | |
