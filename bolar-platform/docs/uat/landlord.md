# UAT script: landlord (/owner)

| | |
| --- | --- |
| Persona | Property owner who sees only the properties they own, approves leases and reads documents |
| Demo account | owner@demo.bolar.test ("Lena Landlord"), password `Bolar!Demo2026` |
| Portal | `/owner` with Dashboard, Properties, Approvals, Documents |
| Automated by | `tests/e2e/portals-tenant-owner.spec.ts` ("landlord portfolio dashboard"), `tests/e2e/property.spec.ts` ("access control"), `tests/e2e/lease.spec.ts` (approval step) |
| Estimated time | 20 minutes |

## Preconditions

- [last-run.md](last-run.md) GREEN.
- Seed present: Lena owns the "Austin Core Portfolio" with Maple Court Apartments, Riverside Lofts and Sunset
  Bungalows (owner_of edges); a lease in `review` for Ava Applicant on Maple Court 102; one open and one paid invoice
  on the Maple Court 101 lease.
- A property that Lena does not own exists (the property manager script step A6 creates one; otherwise the UAT lead
  creates it as the manager).

## Steps

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| 1 | Sign in as owner@demo.bolar.test | Lands on `/owner`, heading "Portfolio" | | |
| 2 | Read the KPI cards | Properties 3; Units greater than 0; Occupancy shows a percentage; Approvals at least 1; Collected, Overdue and Maintenance show dollar amounts | | |
| 3 | Read the property cards | Maple Court Apartments, Riverside Lofts, Sunset Bungalows each with an occupancy bar; the map area says it arrives in the reporting phase | | |
| 4 | Read the approvals inbox | "Ava Applicant", "Maple Court Apartments · Unit 102"; link "Review and approve" points to `/owner/approvals` | | |
| 5 | Open Approvals | Heading "Lease approvals"; the Ava Applicant lease is in `review` with "Approve lease" | | |
| 6 | Approve the lease submitted by the property manager tester (their step A12), not the seeded Ava Applicant lease | Row disappears from the queue; the manager sees `approved` | | Keep the seeded lease for later sessions |
| 7 | Open Properties | Heading "My properties"; only the three owned properties; no "Add property" button | | |
| 8 | Search "Unowned" (or the name of the unowned property) | Empty state; the property is not listed | | |
| 9 | Open Maple Court Apartments | Read-only detail: no "Add unit", no "Change status of unit" buttons; units and statuses visible | | |
| 10 | Paste the URL of the unowned property `/owner/properties/<id>` | Denied state; the property name is not rendered anywhere | | |
| 11 | Open Documents | Documents linked to owned properties and leases are listed (insurance certificate, lease agreement); confidential items show their classification | | |
| 12 | Try `/manager/leases` and `/finance` | Denied state (landlord is not a manager or bookkeeper); no domain requests | | |
| 13 | Sign out, then open `/owner` | Redirected to `/login` | | |

## Business rules to confirm

- Ownership is relationship-based: a landlord never sees properties without an `owner_of` edge, and the API answers
  404 for them (existence is not leaked).
- A landlord approves leases drafted by staff; the approver can never be the creator.
- Finance figures on the dashboard are computed only from invoices and payments on owned properties.

## Severity guidance

Steps 8, 10 and 12 failing are S1 (relationship scoping). Steps 5, 6 are S2. Steps 2 to 4, 7, 9, 11 are S3 unless a
figure is wrong (S2). Rubric: [defect-triage.md](defect-triage.md).

## Sign-off

| Field | Value |
| --- | --- |
| Tester (name, role) | |
| Build commit (from last-run.md) | |
| Date and environment | |
| Steps passed / total | / 13 |
| Defects filed (issue numbers, severity) | |
| Tester verdict (pass / pass with S3-S4 / fail) | |
