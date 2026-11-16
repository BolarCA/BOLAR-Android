# UAT script: vendor (/vendor)

| | |
| --- | --- |
| Persona | External contractor who sees only the work orders assigned to their company and reports progress on them |
| Demo account | vendor@demo.bolar.test ("Vera Vendor", company "Vera Vendor Plumbing LLC", trades plumbing and HVAC, approved, insured), password `Bolar!Demo2026` |
| Portal | `/vendor` ("My jobs") and `/vendor/jobs/<id>` |
| Automated by | `tests/e2e/maintenance.spec.ts` (vendor steps and denied checks) |
| Estimated time | 15 minutes |

## Preconditions

- [last-run.md](last-run.md) GREEN.
- Seed present: "Kitchen sink leaking" (high priority) assigned to Vera; unassigned orders "No heat in bedroom" and
  "Hallway light flickering"; the property manager tester has assigned and scheduled one more job to Vera
  (property-manager script step A17).

## Steps

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| 1 | Sign in as vendor@demo.bolar.test | Lands on `/vendor`, heading "My jobs"; only jobs assigned to Vera Vendor Plumbing LLC are listed with their status (`assigned`, `scheduled`) | | |
| 2 | Open the job scheduled by the manager | `/vendor/jobs/<id>`; title, property, unit, priority, SLA due time, scheduled time, timeline and notes | | |
| 3 | Click "Start work" | Timeline shows "Status scheduled → in_progress"; buttons "Mark blocked" and "Submit for review" appear; there is no "Mark complete" (manager-only) | | |
| 4 | Click "Mark blocked" with reason "Waiting for a replacement cartridge" | Status `blocked`; the reason is in the timeline; the manager's board shows the blocked state | | |
| 5 | Resume and click "Submit for review" | Status `review`; the manager now sees "Mark complete" on their side | | |
| 6 | Add a note with a cost estimate on the "Kitchen sink leaking" job | Note appears in the timeline and the manager can read it | | |
| 7 | Paste the URL of an unassigned work order (`/vendor/jobs/<id>` of "Hallway light flickering") | Denied state; no "Start work" button; the API answered 404 (existence not leaked) | | |
| 8 | Open `/finance`, `/compliance`, `/manager/documents`, `/manager/maintenance` | Denied state on each; no domain requests fired | | |
| 9 | Click the sidebar items "Schedule" and "Documents" | Known limit: the links have no page yet and show the framework not-found screen (launch task L-07); record as observed, do not file | | |
| 10 | Ask the manager to use "Decline / unassign" on one of your jobs, then reload My jobs | The job disappears from your list and its URL shows the denied state | | |

## Business rules to confirm

- Vendor access is granted by the `assigned_to` relationship on each work order and ends when the order is
  unassigned, declined or completed.
- Vendors move jobs only along scheduled, in_progress, blocked, review; completion and cancellation are manager
  actions.
- Suspended vendors keep access to current jobs but are not offered for new assignments.

## Severity guidance

Steps 7, 8, 10 failing are S1. Steps 1 to 5 are S2. Step 6 is S3; step 9 is a known limit. Rubric:
[defect-triage.md](defect-triage.md).

## Sign-off

| Field | Value |
| --- | --- |
| Tester (name, role) | |
| Build commit (from last-run.md) | |
| Date and environment | |
| Steps passed / total | / 10 |
| Defects filed (issue numbers, severity) | |
| Tester verdict (pass / pass with S3-S4 / fail) | |
