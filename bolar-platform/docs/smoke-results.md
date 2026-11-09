# Seeded smoke results (Day 59)

Run date: 2026-11-09. Environment: local PostgreSQL 16, Redis 7, API on :4000, web on :3000 (`next dev`),
`QUEUE_DRIVER=memory`, demo seed (`pnpm db:seed && pnpm db:seed:demo`). Chromium desktop project plus Pixel 7 for
`@mobile` tests. Command: `pnpm exec playwright test --config tests/playwright.config.ts --trace off`.

## Result

| Suite | Tests | Result |
| --- | --- | --- |
| Unit and API (`pnpm test`: shared, integrations, db, workers, api) | 9 + 12 + 9 + 6 + 270 | all passed |
| Playwright end to end (13 specs, Days 1-120) | 101 passed, 1 skipped by design (desktop run of a mobile-only test) | passed |
| OpenAPI (`pnpm openapi:check`, Redocly lint) | 269 operations | valid |
| Migration test (`pnpm db:migrate:test`) | 9 migrations on a scratch database (incl. RLS policies and reporting views) | passed |
| Docs lint, env check | 74 docs, 52 env keys | passed |

Final run on the complete Days 1-120 branch (MVP plus AI assistant, reporting, hardening and launch readiness).

## Cross-portal coverage (blueprint p301 "cross-portal demo")

| Portal | Persona | Journeys exercised in e2e |
| --- | --- | --- |
| Master admin | platform@bolar.test | health summary, orgs list and detail, feature flags, support session start/act-as/end, platform audit, denied for tenant |
| Subaccount admin | orgadmin@demo.bolar.test | staff invite/revoke, access approvals, audit, privacy requests, retention |
| Property manager | manager@demo.bolar.test | properties/units + status machine, tenants with redaction, lease draft/review/send, maintenance board triage/assign/schedule, vendors, applications + screening + adverse action, notices with guard hits, documents upload/download, templates, ops cockpit queue, filters and deep links |
| Landlord | owner@demo.bolar.test | portfolio dashboard KPIs, approvals inbox, approve lease, owned-only properties, denied on unowned detail |
| Tenant (mobile + desktop) | tenant@demo.bolar.test | home card/balance/maintenance/documents/bottom nav, pay invoice, maintenance intake with confirmation, documents and inbox, profile and MFA status, denied on every staff screen |
| Bookkeeper | books@demo.bolar.test | invoice generation per period, trial balance balanced, double-entry proof, payments |
| Lawyer | legal@demo.bolar.test | case + legal hold, agency request legal review and approval, evidence export approval by a second person, privacy queue |
| Vendor | vendor@demo.bolar.test | assigned job start, denied on unassigned job, denied on finance/compliance/documents |
| Compliance | compliance@demo.bolar.test | review queue evidence and resolution, rules catalog, notice approvals, manifest export |
| Government | gov@demo.bolar.test | records request submission, exports, denied on legal workspace |
| Corporate admin / occupant | corp@, occupant@demo.bolar.test | dashboards render with designed empty states, portal gating |
| Assistant (V1) | manager, compliance | cited lease summary, notice draft routed to approval, vendor has no assistant, AI audit page |
| Reports (V1) | bookkeeper, owner | KPIs reconciled to seed, scheduled CSV run and download, owner-scoped occupancy |

Route matrix: all 12 personas x 12 portal bases; allowed portals render content with sidebar items equal to the
permission-filtered nav; denied portals render the denied state with zero domain API calls. Axe (WCAG 2.0 A/AA,
serious and critical) reports no violations on any allowed portal landing or primary screen.

## Failures recorded during the run and their disposition

| # | Failure | Owner | Severity | Status |
| --- | --- | --- | --- | --- |
| 1 | Mobile bottom-nav tap intercepted by the Next.js dev indicator overlay in CI | web | medium | fixed: overlay disabled, bar isolated at z-40, test asserts top-most hit test |
| 2 | Shared Badge `warning` tone failed WCAG AA contrast | web | medium | fixed: `orange-900` text on `orange-100` |
| 3 | Drawer/Modal lacked focus trap and Escape handling | web | high | fixed in `components/ui/index.tsx` |
| 4 | Portal switcher order differed from API landing order | web | low | fixed: shell sorts by `/me` portals |
| 5 | zod 4 `z.record` single-argument calls from merged slices | contracts | low | fixed |

## Known limits carried to the launch gate
- Virus scanning is a no-op placeholder behind `VirusScanner`.
- Media thumbnails are not generated (`thumbnailKey` null).
- Providers run in mock mode; sandbox credentials and webhook registration are required before staging exercises
  real Stripe/DocuSign/TransUnion flows.
- Playwright global setup reseeds; do not run the API unit suite (which truncates the database) concurrently with e2e.
- Running two Playwright invocations at once against the same database is unsupported (documents seed uniqueness).
