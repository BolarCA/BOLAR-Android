# Portal QA: tenant mobile home and landlord dashboard (blueprint Days 52-53)

Scope: the resident home screen (`/tenant`, UI page 48), the resident profile (`/tenant/profile`), the resident
bottom navigation, and the landlord portfolio dashboard (`/owner`, UI page 39). Both screens compose the existing
domain hooks (lease, finance, maintenance, document, notification, property, tenant-profile) and add no API routes.
Synthetic demo data only (`pnpm db:seed && pnpm db:seed:demo`).

## Commands

```bash
cd bolar-platform
pnpm lint && pnpm typecheck                                          # monorepo
export API_PORT=4111 WEB_PORT=3111 QUEUE_DRIVER=memory
pnpm exec playwright test --config tests/playwright.config.ts --trace off tests/e2e/portals-tenant-owner.spec.ts tests/e2e/access.spec.ts
```

The `mobile` Playwright project (Pixel 7) runs every test tagged `@mobile`; the `desktop` project runs all tests, so
the tenant home assertions are exercised at both widths. The bottom-nav journey skips itself on desktop, where the
shell sidebar replaces the bar.

## Data sources (no new API clients)

| Screen element | Endpoint (existing hook) | Scoping enforced by the API |
| --- | --- | --- |
| Property card, lease term, rent | `GET /leases` (`useLeases`) | tenants see only leases they are a party to |
| Rent balance, next due, overdue | `GET /invoices` (`useInvoices`) | `financeScope`: leases the tenant is party to / properties the landlord owns |
| Pending maintenance count, recent requests | `GET /work-orders?mine=true` (`useWorkOrders`) | requester or assignee only |
| Documents (incl. lock state) | `GET /documents?ownerType=lease&ownerId=` (`usePagedList` on the documents key) | relationship gate + classification gate (`gated` flag) |
| Notices and messages | `GET /notifications?channel=in_app` (`useNotifications`); notices = `templateKey` starting `notice.` | recipient only |
| Profile | `GET /tenant-profiles/:id` for the party whose `userId` is the signed-in user | self-access path (tenants cannot list profiles) |
| MFA | `POST /auth/mfa/setup`, `POST /auth/mfa/verify` | session; the returned token pair replaces the current one and `/me` is refetched |
| Owner KPIs, property cards | `GET /properties` (all pages) with `unitCounts` | landlord sees `owner_of` properties/portfolios only |
| Approvals inbox | `GET /leases?status=review` (`useLeases`), only with `lease:approve` | relationship-scoped; approving stays on `/owner/approvals` |
| Rent collected / overdue / open AR | `GET /invoices` + `GET /payments` computed client-side; `GET /finance/summary` used when the actor is finance staff | `/finance/summary` and `/invoices/aging` are staff-only (403 for landlords), so the dashboard never calls them for a landlord |
| Maintenance spend (90 days) | `GET /work-orders` -> sum of `actualCents` on `complete` orders completed in the last 90 days | property visibility |

## States covered

| State | Where | How it is triggered | Covered by |
| --- | --- | --- | --- |
| Loading skeleton | `/tenant`, `/owner` | first paint before the lease / property list resolves; each secondary card has its own `role="status"` skeleton | visual check; `StateView` contract |
| Offline | `/tenant` | `navigator.onLine === false` shows the "You're offline" banner; cached cards stay visible, skeleton copy changes when nothing is cached yet | manual (DevTools offline); `useOnline` |
| Zero balance | Rent balance card | no outstanding invoice -> `data-state="zero"`, "Paid up" badge, secondary "Payment history" CTA | pay the open invoice on `/tenant/pay` (finance.spec) then reload |
| Due | Rent balance card | open invoice not yet past due -> amount, due date, primary "Pay $…" CTA | e2e "home shows…" (`data-cents > 0`, `data-state` due/overdue) |
| Overdue | Rent balance card | invoice `overdue` or `dueDate < today` -> red border, red amount, `role="alert"` with count and oldest due date | manual: bookkeeper "Scan for overdue" after moving the due date; unit of logic in `isOverdueInvoice` |
| Restricted document | Documents card | `gated: true` (confidential/restricted without clearance) -> lock icon, "Approval required" badge, "Request access" link to `/tenant/documents` where the request-access panel lives | e2e "home shows…" (`data-gated="true"`, link name) |
| Pending maintenance | Maintenance card + quick action | open work orders (`WORK_ORDER_OPEN_STATUSES`) counted; recent three listed with status badges | e2e (`data-count > 0`) |
| No active lease | `/tenant` | no lease in an occupying state -> "No active lease yet" empty state with profile / messages links | manual (tenant without a lease party) |
| No notices / no messages | Notices, Messages cards | empty lists -> explanatory empty states | e2e (`home-notices` visible); seed has no `notice.*` notification |
| MFA off / enrolling / on | `/tenant/profile` | `me.actor.mfaEnabled`; setup reveals the secret and a 6-digit code form; verify flips the badge | e2e asserts the status attribute; enrolment manual (`otpauthUrl` secret -> authenticator) |
| No tenant profile linked | `/tenant/profile` | no lease party with the signed-in `userId` | manual |
| Empty portfolio | `/owner` | `GET /properties` returns nothing -> "No properties in your portfolio yet" with a documents link | manual (landlord without `owner_of` edges) |
| Denied property | `/owner/properties/:id` | landlord opens a property without an `owner_of` edge; API answers 404 + `access.denied` audit, `StateView` shows the denied state; property absent from the dashboard list | e2e "owner opening a property they do not own" |
| Finance hidden | `/owner` | without `finance:read` the income/overdue KPIs are replaced by a permission note and the finance card is omitted | `useCan('finance:read')` |
| Approvals hidden | `/owner` | without `lease:approve` the inbox is omitted and the KPI shows "—" | `useCan('lease:approve')` |
| Map placeholder | `/owner` | always; explains that map tiles arrive with the reporting phase (no map library added) | e2e (`map-placeholder`) |

## Accessibility

- Bottom navigation: `nav[aria-label="Resident"]`, `aria-current="page"` on the active tab, every tab >= 56px tall
  (asserted >= 44px in e2e), hidden at `lg` so it never duplicates the sidebar landmark.
- All CTAs are >= 44px (`min-h-11` / `min-h-12`); quick-action tiles >= 72px.
- Occupancy bars are `role="progressbar"` with `aria-valuenow` and `aria-valuetext` ("2 of 6 units rented").
- Overdue balance uses `role="alert"`; skeletons use `role="status" aria-busy`.
- Colors come from the BOLAR tokens in `globals.css`; axe (wcag2a/wcag2aa, serious/critical) is clean on the tenant home
  (mobile and desktop) and the owner dashboard (`@a11y` tests).

## Screenshots (described, no binaries committed)

1. `tenant-home-mobile` (Pixel 7, 412px): greeting "Hi, Theo"; navy gradient property card "Maple Court Apartments /
   Unit 101 / Austin, TX" with lease, rent, start and end; "Rent balance $1,450.00 / Due Dec 1, 2026" with the blue
   "Pay $1,450.00" button; four quick-action tiles; Maintenance card "3 pending" listing three requests; Documents card
   with the locked "Residential Lease Agreement (signed)" and "Request access"; Notices empty state; Messages with two
   unread items; Profile card "Two-step verification: off"; white bottom bar Home / Pay / Maintenance / Documents / Profile
   with Home highlighted.
2. `tenant-profile-mobile`: Account, Sign-in security ("Two-step off", "Set up two-step verification"), Contact methods
   (email, phone), Emergency contacts empty state, Household, Privacy ("classified confidential").
3. `owner-dashboard` (1280px): seven KPI cards (Properties 3, Units 13, Occupancy 46%, Open approvals 1, Rent collected
   this month $0.00, Overdue balance $0.00, Maintenance spend (90 days) $680.00); three property cards with occupancy
   bars (Sunset Bungalows 67%, Riverside Lofts 50%, Maple Court 33%); Map placeholder; Approvals inbox with "Maple Court
   Apartments · Unit 102 / Ava Applicant" and "Review and approve"; Finance summary; Documents link.
4. `owner-denied` (desktop): `/owner/properties/<unowned id>` shows "You don't have access to this".

## Results

| Check | Result |
| --- | --- |
| `pnpm lint` | pass (14/14 tasks) |
| `pnpm typecheck` | pass (14/14 tasks) |
| `pnpm openapi:generate` | no diff (no API changes in this slice) |
| `tests/e2e/portals-tenant-owner.spec.ts` + `tests/e2e/access.spec.ts` on 4111/3111 | pass: 18 passed, 1 skipped (bottom-nav journey on the desktop project, by design). First run after a cold `next dev` start hit the 20s login timeout once in `access.spec` ("manager lands…"); the warm re-run passed in under 1s, so treat it as a cold-compile flake, not a regression |
| `pnpm docs:lint` | pass (27 files) |

## Known limits

- Rent collected / overdue for landlords are computed from the relationship-scoped invoice and payment lists, not the
  ledger summary (staff-only). They match the ledger for the demo org; large portfolios page through at most 8 x 25 rows.
- The map is a placeholder by design (no tile provider approved yet).
- Contact and emergency-contact edits remain with the property manager (`tenant_profile:write`); the resident view is
  read-only apart from MFA enrolment.
