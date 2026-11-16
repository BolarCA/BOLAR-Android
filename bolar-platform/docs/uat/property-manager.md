# UAT script: property manager (/manager)

| | |
| --- | --- |
| Persona | Day-to-day operator: properties and units, tenants, leases, applications and screening, notices, maintenance, vendors, documents, templates |
| Demo account | manager@demo.bolar.test ("Marcus Manager"), password `Bolar!Demo2026` |
| Portal | `/manager` (Operations cockpit) plus Properties, Tenants, Leases, Applications, Notices, Maintenance, Vendors, Documents, Templates |
| Automated by | `tests/e2e/manager-ops.spec.ts`, `property.spec.ts`, `lease.spec.ts`, `compliance.spec.ts`, `maintenance.spec.ts`, `documents.spec.ts` |
| Estimated time | 75 minutes (split across two sessions if needed: A operations and property, B compliance and documents) |

## Preconditions

- [last-run.md](last-run.md) GREEN.
- Seed present: Maple Court Apartments (units 101 to 203), Riverside Lofts, Sunset Bungalows; active lease on Maple
  Court 101 (Theo Tenant); lease in `review` on Maple Court 102 (Ava Applicant); work orders in several lanes including
  the overdue "Bathroom exhaust fan not working"; approved vendor "Vera Vendor Plumbing LLC" and suspended "Sparky
  Electric Co"; a pending late-rent notice; an application in review for "Casey Candidate"; two seeded documents.
- A landlord tester (or the UAT lead with owner@demo.bolar.test) is available for step A13.

## Part A: operations, property, tenant, lease, maintenance

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| A1 | Sign in as manager@demo.bolar.test | Lands on `/manager`, heading "Operations"; KPI strip shows non-zero Overdue work orders, Leases awaiting action, Compliance hits, Notices pending, Applications in review, Vacant units | | |
| A2 | Read the queue | Overdue items sort first ("Overdue by ..."); rows of type Work order, Lease ("Awaiting approval", Maple Court Apartments), compliance and notice exist; the counter reads "N of M items" | | |
| A3 | Filter Property = Maple Court Apartments | Only Maple Court rows remain; compliance rows (portfolio-wide) disappear; "Clear filters" restores the full count | | |
| A4 | Due date = overdue, then Priority = critical | Every remaining row says "Overdue by"; then every row shows "critical" | | |
| A5 | Click "Open Bathroom exhaust fan not working" | Navigates to `/manager/maintenance?workOrderId=...` with the drawer open on that work order | | |
| A6 | Properties: switch Cards and back to Table, click "Add property", fill name `UAT Harbor <initials>`, 12 Pier St, Galveston, TX, 77550, Initial status active, "Create property" | New row with status `active`; detail page shows the empty state "No units yet" | | |
| A7 | "Add unit": Unit number `PH1`, Bedrooms 2, Bathrooms 1.5, Target rent 2450, "Create unit" | Row PH1 `vacant` `$2,450`; "Change status of unit PH1" offers only down, make ready, occupied, reserved; Confirm is disabled until a reason is typed | | |
| A8 | Choose reserved, reason "Application approved, holding for move-in", Confirm | Row shows `reserved`; the Hierarchy view lists Unit PH1 | | |
| A9 | Tenants: "New tenant profile" with Display name `UAT Tenant <initials>`, Email `uat.<initials>@demo.bolar.test`, Phone, SSN last 4 `7777`, "Create profile" | Detail page opens; confidential fields show "redacted"; "Reveal sensitive fields" shows the review-required state with "Request access" | | |
| A10 | Click "Request access", purpose lease administration, justification of at least one sentence | Request submitted; it appears for the org admin under Access requests (see org-admin script step 8) | | |
| A11 | Leases: "New lease": Property Maple Court Apartments, a `vacant` unit, Find tenant = your UAT tenant, dates two years ahead (1 Feb to 31 Jan), rent 1575, deposit 1575, "Create draft" | Lease workspace opens; lifecycle shows `draft`; Lease parties table lists the tenant | | |
| A12 | "Submit for review" | Current step `review`; text "Awaiting a second person"; audit timeline "draft → review"; the Approve action is not offered to you (creator) | | |
| A13 | Landlord approves from `/owner/approvals` (landlord script step 6) | Reloading the lease shows `approved` and "review → approved" in the timeline | | |
| A14 | "Send for e-signature" | Step `sent`; "1 recipient" (mock envelope); timeline "approved → sent" | | |
| A15 | "Cancel lease" | Step `canceled`; the unit is released (shows `vacant` again on the property page) | | |
| A16 | Maintenance board: open the New lane card created by the tenant tester (or the seeded "Hallway light flickering"), "Triage" | Drawer shows "Assign vendor" with an eligible-vendor list; Sparky Electric Co is absent or marked ineligible (suspended, insurance expired) | | |
| A17 | Vendor = Vera Vendor Plumbing LLC, "Assign"; then "Schedule" with a time tomorrow, "Confirm schedule" | "Status assigned → scheduled"; card moves to the Scheduled lane; "Start work" visible for the vendor side | | |
| A18 | Click "Run SLA scan" (board header) | Overdue open orders get a red SLA chip; "Overdue only" filter shows a count of at least 1 | | |
| A19 | Vendors: "Add vendor" with Company name `UAT Roofing`, Trade, Email, Phone, Budget limit 5000, Insurance expires one year ahead | Vendor listed with status pending; detail page says to approve once insurance and contracts are on file | | |

## Part B: applications, notices, documents, templates

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| B1 | Applications: "New application", Property Maple Court, Applicant Theo Tenant, "Create application", then "Submit application" | Detail shows `submitted` | | |
| B2 | "Order screening" before consent | Alert names rule `us.fcra.consent_before_screening`; no order created | | |
| B3 | "Record applicant consent", then "Order screening", then "Run screening (mock provider)" | Status `ordered`, then `completed`; application moves to `review` | | |
| B4 | "View report (restricted)" | Review-required state; the recommendation text is never shown to the manager | | |
| B5 | "Record decision": denied, reason "credit history", "Confirm decision" | Adverse action panel shows "pre adverse", "Waiting period ends" and the reason; no notice is sent automatically | | |
| B6 | Notices: "Draft notice", Template notice.general, Recipient Theo Tenant, Body "Reminder for all residents: no section 8 vouchers are accepted in this building.", "Save draft" | Guard hits list "no section 8" and `us.soi.voucher_refusal`; the notice row shows a hit | | |
| B7 | Try to send the draft | No send action is available before approval; the notice stays in draft or pending approval | | |
| B8 | Documents: "Upload document", Title `UAT move-in checklist`, Linked to org, Category general, a small text file, "Upload" | "Uploaded ..." with scan `clean`; row shows `ready` | | |
| B9 | "Download <title>", click "Open signed link" | File opens; the URL contains `/storage/object?`; editing the `sig` parameter and reloading gives 404 | | |
| B10 | Templates: "New template" key `notice.uat_<initials>`, name, Channel notice, Risk level high, subject and body with `{{tenantName}}`, "Create draft"; "Submit for approval" | Drawer shows "Awaiting approval"; no Approve button for you | | |
| B11 | After the lawyer approves (lawyer script step 12), open the template, fill variables, "Render" | Render output shows the substituted text | | |
| B12 | Sign in as tenant@demo.bolar.test and open `/manager`, `/manager/leases`, `/manager/maintenance`, `/manager/properties` | Denied state on each; no domain requests fired | | |

## Business rules to confirm

- Unit status changes need a reason and follow the state machine; lease approval and template approval need a second
  person; screening needs recorded consent; a denial opens an adverse action with a waiting period that a human
  advances.
- Fair-housing and source-of-income guard hits are shown immediately and block sending until a compliance officer
  resolves them.
- Confidential tenant fields stay redacted until a time-boxed grant exists.

## Severity guidance

B2, B4, B7, A9/A10 and B12 failing are S1 (regulatory or data gate). A11 to A15, A16/A17, B1, B3, B5, B8/B9 are S2.
Remaining steps are S3 unless wrong data is shown (S2). Rubric: [defect-triage.md](defect-triage.md).

## Sign-off

| Field | Value |
| --- | --- |
| Tester (name, role) | |
| Build commit (from last-run.md) | |
| Date and environment | |
| Steps passed / total | / 31 |
| Defects filed (issue numbers, severity) | |
| Tester verdict (pass / pass with S3-S4 / fail) | |
