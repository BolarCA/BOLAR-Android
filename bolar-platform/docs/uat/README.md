# User acceptance testing (Days 105-120)

UAT proves that real people in each persona can complete their day-to-day work on a staging build that passed the
automated gates. Every script in this folder walks one persona through journeys that already exist in the product and
that the Playwright suite exercises; the scripts add the human judgement (is it understandable, is it fast enough,
does it match the business rule) that automation cannot. Nothing here describes a feature that is not implemented.

## Who does what

| Role | Responsibility |
| --- | --- |
| UAT lead (release manager) | Owns the schedule, runs `scripts/uat-smoke.sh` before every session, triages defects daily with the engineering lead, signs the UAT row of the go/no-go record |
| Testers (one or two real users per persona) | Follow the script, fill the Pass/Fail column, file every deviation as a `UAT defect` issue |
| Scribe | Captures timings, confusion points and verbatim quotes; posts the session summary in the release issue |
| Counsel | Observes the compliance officer, lawyer and government sessions; signs the counsel row |
| Engineering on-call | Fixes blocking defects and reseeds the environment between sessions |

## Environment

- Staging (preferred) or a local checkout bootstrapped with `scripts/dev-bootstrap.sh <database>`.
- Demo data only: the seed in `packages/db/seed` creates the `demo-pm` organization, one user per persona and the
  properties, leases, invoices, work orders, rules and cases referenced below. Never import real tenant data.
- Before every session the UAT lead runs the smoke harness and commits the generated report:

```bash
API_PORT=4124 WEB_PORT=3124 scripts/uat-smoke.sh   # migrate + seed + Playwright @smoke -> docs/uat/last-run.md
```

The session only starts when [last-run.md](last-run.md) says GREEN. A RED run is triaged first
([defect-triage.md](defect-triage.md)).

- Between sessions: `pnpm db:seed && pnpm db:seed:demo` restores the seeded rows (idempotent). Records created by
  testers stay unless the database is reset with `pnpm db:reset` followed by both seed commands.

## Demo accounts

All accounts share the demo password `Bolar!Demo2026` (seed value, local and staging only). None has MFA enrolled, so
routes that require an MFA-verified session pass for these accounts; the tenant script enrols TOTP to prove the flow.

| Persona | Email | Portal | Script | Automated by |
| --- | --- | --- | --- | --- |
| Platform admin | platform@bolar.test | /admin | [platform-admin.md](platform-admin.md) | `tests/e2e/manager-ops.spec.ts`, `portal-matrix.spec.ts` |
| Org admin | orgadmin@demo.bolar.test | /subaccount | [org-admin.md](org-admin.md) | `tests/e2e/access.spec.ts`, `portal-matrix.spec.ts` |
| Property manager | manager@demo.bolar.test | /manager | [property-manager.md](property-manager.md) | `property`, `lease`, `maintenance`, `compliance`, `documents`, `manager-ops` specs |
| Landlord | owner@demo.bolar.test | /owner | [landlord.md](landlord.md) | `tests/e2e/portals-tenant-owner.spec.ts`, `property.spec.ts`, `lease.spec.ts` |
| Tenant | tenant@demo.bolar.test | /tenant | [tenant.md](tenant.md) | `portals-tenant-owner`, `finance`, `maintenance`, `documents` specs |
| Bookkeeper | books@demo.bolar.test | /finance | [bookkeeper.md](bookkeeper.md) | `tests/e2e/finance.spec.ts` |
| Lawyer | legal@demo.bolar.test | /legal | [lawyer.md](lawyer.md) | `tests/e2e/governance.spec.ts`, `documents.spec.ts` |
| Vendor | vendor@demo.bolar.test | /vendor | [vendor.md](vendor.md) | `tests/e2e/maintenance.spec.ts` |
| Compliance officer | compliance@demo.bolar.test | /compliance | [compliance-officer.md](compliance-officer.md) | `tests/e2e/compliance.spec.ts` |
| Government | gov@demo.bolar.test | /gov | [government.md](government.md) | `tests/e2e/governance.spec.ts` |
| Corporate admin | corp@demo.bolar.test | /corporate-admin | [corporate-admin.md](corporate-admin.md) | `tests/e2e/portal-matrix.spec.ts` |
| Occupant | occupant@demo.bolar.test | /occupant | [occupant.md](occupant.md) | `tests/e2e/portal-matrix.spec.ts` |

Run one spec by hand with `pnpm exec playwright test --config tests/playwright.config.ts --trace off tests/e2e/<spec>`
after exporting `API_PORT`, `WEB_PORT` and `QUEUE_DRIVER=memory`.

## How a session runs

1. UAT lead confirms GREEN, opens the script and the `UAT defect` issue form, and reads the preconditions aloud.
2. Tester works through the numbered steps without coaching. The scribe notes the time per step; the lead only
   intervenes when the tester is stuck for more than two minutes (recorded as a usability finding).
3. Every expected result that does not match is a defect: file it immediately with the step number, the persona and
   the severity from the rubric at the bottom of the script. Screenshots must not contain anything but seed data.
4. After the last step the tester fills the sign-off block. A script passes when every step is Pass or has a linked
   defect of severity S3 or S4.
5. The lead posts the summary (steps passed, defects by severity, timings) in the release issue and updates the
   launch checklist row for that persona ([../launch-checklist.md](../launch-checklist.md)).

## Exit criteria for the UAT phase

- All twelve scripts executed by at least one real user per persona on the release candidate build.
- Zero open S1 and S2 defects; every S3 has an owner and a date; S4 items are listed in the risk register or closed.
- `docs/uat/last-run.md` GREEN on the release candidate commit.
- Counsel observed the three regulated-persona sessions and signed the go/no-go record.

## Known limits carried into UAT (do not file as new defects)

These come from [../smoke-results.md](../smoke-results.md) and from preparing these scripts against the current build.
They are tracked in the launch checklist; testers note them but do not raise duplicates.

- Sidebar links `Schedule` and `Documents` in the vendor portal and `Spend` in the corporate admin portal are listed in
  `apps/web/lib/nav.ts` but have no page; the app shows the framework's default not-found screen (launch task L-07).
- Evidence export approval shows "Approve export" only to a different user with `export:approve` who can open the
  case (a second lawyer). The demo org has one lawyer, so the org admin approves through `POST /exports/:id/approve`
  (the lawyer and government scripts call it out).
- Sign-in does not prompt for the TOTP code when a user has MFA enabled; the code is entered under Sign-in security
  on the profile page before MFA-level actions succeed (launch task L-08).
- Virus scanning is a no-op (`scanStatus` always `clean`); media thumbnails are not generated.
- Provider adapters run in mock mode: card payments, e-signature envelopes, screening reports and identity
  verification return deterministic mock data.
- Photo attachment on the maintenance intake reports "Photo upload is not available in this build" when media
  storage is not configured.
