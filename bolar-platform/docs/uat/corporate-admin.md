# UAT script: corporate admin (/corporate-admin)

| | |
| --- | --- |
| Persona | Administrator at a corporate tenant that houses employees: sees the corporate accounts, occupants, leases and documents in scope |
| Demo account | corp@demo.bolar.test ("Cory Corpadmin"), password `Bolar!Demo2026` |
| Portal | `/corporate-admin` ("Corporate housing overview") and `/corporate-admin/occupants` |
| Automated by | `tests/e2e/portal-matrix.spec.ts` ("corporate admin and occupant landings render dashboards with empty states") |
| Estimated time | 10 minutes |

## Preconditions

- [last-run.md](last-run.md) GREEN.
- The demo seed creates the corporate admin user but no corporate accounts, occupants or corporate leases, so this
  script verifies the designed empty states and the gating. When a pilot customer supplies corporate data, extend the
  script with their records.

## Steps

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| 1 | Sign in as corp@demo.bolar.test | Lands on `/corporate-admin`, heading "Corporate housing overview"; KPI cards Corporate accounts, Occupants, Active leases, Monthly spend render with zero values, not loading skeletons | | |
| 2 | Read the sections | "Occupants", "Leases" and "Documents" each show a designed empty state with a sentence explaining what will appear; the text "Nothing to show yet" does not appear | | |
| 3 | Open Occupants | The occupants list renders its empty state; no error or blank page | | |
| 4 | Click the sidebar item "Spend" | Known limit: no page exists yet; the framework not-found screen appears (launch task L-07). Record, do not file | | |
| 5 | Run axe (browser extension) on the overview | No serious or critical WCAG 2.0 A/AA violations | | |
| 6 | Use only the keyboard: Tab from the skip link to the first navigation link, Enter | Focus is visible at every step; the main region receives focus from the skip link | | |
| 7 | Paste `/manager`, `/tenant`, `/finance`, `/legal` | Denied state on each; no domain requests | | |
| 8 | Sign out, open `/corporate-admin` | Redirected to `/login` | | |

## Business rules to confirm

- The corporate admin role reaches only its own portal; occupant and lease visibility will be relationship-scoped to
  the corporate account once corporate data exists.
- Empty states are explicit and never show placeholder copy.

## Severity guidance

Step 7 failing is S1. Steps 1 to 3 are S3 (S2 if the page errors). Step 4 is a known limit. Steps 5, 6 are S3.
Rubric: [defect-triage.md](defect-triage.md).

## Sign-off

| Field | Value |
| --- | --- |
| Tester (name, role) | |
| Build commit (from last-run.md) | |
| Date and environment | |
| Steps passed / total | / 8 |
| Defects filed (issue numbers, severity) | |
| Tester verdict (pass / pass with S3-S4 / fail) | |
