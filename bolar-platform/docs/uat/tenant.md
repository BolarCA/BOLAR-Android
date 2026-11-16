# UAT script: tenant (/tenant, phone and desktop)

| | |
| --- | --- |
| Persona | Resident with an active lease: pays rent, files maintenance requests, reads documents and messages, manages profile security |
| Demo account | tenant@demo.bolar.test ("Theo Tenant", Maple Court Apartments unit 101), password `Bolar!Demo2026` |
| Portal | `/tenant` with Home, Pay rent, Maintenance, Documents, Profile; on screens narrower than 1024 px a bottom bar replaces the sidebar |
| Automated by | `tests/e2e/portals-tenant-owner.spec.ts` ("tenant mobile home"), `finance.spec.ts` (pay), `maintenance.spec.ts` (intake), `documents.spec.ts`, `access.spec.ts` (gating) |
| Estimated time | 35 minutes; run steps 1 to 6 on a phone or a 412 px wide browser window |

## Preconditions

- [last-run.md](last-run.md) GREEN.
- Seed present: active lease on Maple Court 101 at $1,450; invoice INV-000001 open and INV-000000 paid; a kitchen
  sink work order assigned to the vendor; in-app messages about the work order and the invoice; the signed lease
  document (confidential) and the insurance certificate.
- An authenticator app on the tester's phone for the TOTP step.

## Steps

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| 1 | On the phone, sign in as tenant@demo.bolar.test | Lands on `/tenant`; greeting "Hi, Theo"; bottom bar with Home, Pay, Maintenance, Documents, Profile, each tap target at least 44 px high; Home is marked current | | |
| 2 | Read the home cards | Property card "Maple Court Apartments", "Unit 101"; balance shows an amount due with a Pay button; pending maintenance count at least 1; Documents lists "Residential Lease Agreement" with a lock and "Request access to Residential Lease Agreement"; Messages mention INV-000001 | | |
| 3 | Tap Pay in the bottom bar | `/tenant/pay`, heading "Pay rent"; the Pay tab is current; nothing overlaps the bar | | |
| 4 | Tap "Pay invoice INV-..." for the open invoice | Dialog "Pay INV-..."; Card number is pre-filled with the mock test card 4242 4242 4242 4242 | | |
| 5 | Click "Pay $..." | "Payment received"; after Done the balance decreases and Payment history lists the invoice as `succeeded` | | |
| 6 | Tap Home | Back on `/tenant`; the balance card now reads paid or shows the remaining amount | | |
| 7 | On desktop, open Maintenance | Heading "Maintenance" with "New request" and "My requests" | | |
| 8 | Fill Title "Burst pipe under sink", Category plumbing, Priority emergency, Description, Entry permission granted, "Submit request" | Priority guidance mentions 24 hours and calling 911 for danger to life; confirmation "Request WO-XXXXXX received" with "Target response: within ..."; "My requests" shows the row as `new` | | |
| 9 | Submit a second request with the same category for the same unit | A warning says it may duplicate an open request (manager merges); the request is still created | | |
| 10 | Open the request from "My requests" | Drawer "Your request" with the timeline; status updates appear as the manager and vendor act | | |
| 11 | Open Documents | Heading "My documents"; "Residential Lease Agreement" marked `confidential`; "Messages" inbox with the two seeded messages | | |
| 12 | Open Profile | Sections Account, Sign-in security, Contact methods, Emergency contacts, Household, Privacy; email tenant@demo.bolar.test shown | | |
| 13 | In Sign-in security click "Set up", add the setup key to the authenticator, enter the 6-digit code | MFA status flips to enabled. On the next sign-in the portal loads without a code prompt (this build has no login-time step-up, launch task L-08); MFA-level actions answer "review required" until the code is entered again under Sign-in security | | Leaves the demo account with MFA on; `pnpm db:seed` does not clear `mfaEnabled`, so engineering resets it through a change ticket before other sessions reuse the account |
| 14 | Open `/manager`, `/subaccount/users`, `/legal`, `/gov`, `/admin` | Denied state on each; the network panel shows no requests other than `/me` | | |
| 15 | Enter a wrong password five times on `/login` | The same generic message "Invalid email, password, or organization" each time; the sixth attempt with the right password is refused for 15 minutes (lockout) | | Coordinate with the UAT lead: do this last |

## Business rules to confirm

- The resident sees only their own lease, invoices, work orders and documents (relationship `tenant_of`).
- Confidential documents are gated behind an access request even for the resident on the home card.
- Payments go through the mock Stripe adapter; no real card is ever charged in staging (`STRIPE_MODE` is `mock` or
  `sandbox`).

## Severity guidance

Step 14 failing is S1. Steps 4, 5, 8, 13, 15 are S2. Steps 1 to 3, 6, 7, 9 to 12 are S3 unless wrong amounts or
another resident's data show (S1). Rubric: [defect-triage.md](defect-triage.md).

## Sign-off

| Field | Value |
| --- | --- |
| Tester (name, role) | |
| Build commit (from last-run.md) | |
| Date, device and environment | |
| Steps passed / total | / 15 |
| Defects filed (issue numbers, severity) | |
| Tester verdict (pass / pass with S3-S4 / fail) | |
