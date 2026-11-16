# Portal navigation and accessibility QA (Days 51, 54, 55)

Checks for the portals wave B slice: master admin control plane (p37), property manager operations cockpit (p40)
and the cross-portal navigation/accessibility audit (p55). Automated coverage is listed next to each item; manual
steps use the demo org (`pnpm db:seed && pnpm db:seed:demo`, password `Bolar!Demo2026`).

## Commands

```bash
pnpm --filter @bolar/api test -- platform                      # packages/api/src/__tests__/platform.test.ts
export API_PORT=4112 WEB_PORT=3112 QUEUE_DRIVER=memory
pnpm exec playwright test --config tests/playwright.config.ts \
  tests/e2e/portal-matrix.spec.ts tests/e2e/manager-ops.spec.ts tests/e2e/access.spec.ts
```

Run the Playwright files in one invocation: `globalSetup` re-seeds the demo org and the documents seed is not safe
to run twice concurrently (unique `(documentId, version)`).

## Route matrix

`tests/e2e/portal-matrix.spec.ts` logs in as each of the 12 demo personas, reads `GET /me`, asserts the login
redirect equals `portals[0]`, then visits all 12 portal base routes. Allowed cells must render `main` with no
`[data-state="denied"]`, show exactly the sidebar items the persona's permissions allow (and a portal switcher that
lists only the granted portals, in the API's canonical order), and pass axe. Denied cells must render the denied state,
show no portal navigation section, and issue zero requests to that portal's domain endpoints (request listener on the
API origin, `/me`, `/auth/*` and `/health` excluded).

| Persona (role) | admin | subaccount | manager | owner | finance | compliance | legal | tenant | corporate-admin | occupant | vendor | gov |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| platform (platform_admin) | landing | denied | denied | denied | denied | denied | denied | denied | denied | denied | denied | denied |
| orgadmin (org_admin) | denied | landing | allowed | allowed | allowed | allowed | denied | denied | denied | denied | denied | denied |
| manager (property_manager) | denied | denied | landing | denied | denied | denied | denied | denied | denied | denied | denied | denied |
| owner (landlord) | denied | denied | denied | landing | denied | denied | denied | denied | denied | denied | denied | denied |
| tenant (tenant) | denied | denied | denied | denied | denied | denied | denied | landing | denied | denied | denied | denied |
| books (bookkeeper) | denied | denied | denied | denied | landing | denied | denied | denied | denied | denied | denied | denied |
| legal (lawyer) | denied | denied | denied | denied | denied | denied | landing | denied | denied | denied | denied | denied |
| vendor (vendor) | denied | denied | denied | denied | denied | denied | denied | denied | denied | denied | landing | denied |
| compliance (compliance_officer) | denied | denied | denied | denied | denied | landing | denied | denied | denied | denied | denied | denied |
| gov (government) | denied | denied | denied | denied | denied | denied | denied | denied | denied | denied | denied | landing |
| corp (corp_admin) | denied | denied | denied | denied | denied | denied | denied | denied | landing | denied | denied | denied |
| occupant (occupant) | denied | denied | denied | denied | denied | denied | denied | denied | denied | landing | denied | denied |

"landing" = `portals[0]`, the post-login redirect. Every cell above is asserted by the spec; the denied cells also
assert the zero-fetch rule. Result on the ports above: 12/12 persona journeys pass (one run of 144 route visits).

Domain endpoint patterns per portal (what a denied visit must never request):

| Portal | Patterns |
| --- | --- |
| admin | `/orgs`, `/platform/*`, `/feature-flags`, `/support-sessions`, `/users`, `/audit` |
| subaccount | `/users`, `/invitations`, `/subaccounts`, `/retention`, `/privacy-requests`, `/sensitive-access`, `/audit` |
| manager | `/properties`, `/work-orders`, `/leases`, `/applications`, `/notices`, `/vendors`, `/rules`, `/tenant-profiles`, `/templates`, `/documents`, `/sensitive-access` |
| owner | `/properties`, `/leases`, `/portfolios`, `/documents` |
| finance | `/invoices`, `/payments`, `/ledger`, `/journal`, `/accounts`, `/bank` |
| compliance | `/rules`, `/notices`, `/applications` |
| legal | `/cases`, `/legal-holds`, `/privacy-requests`, `/agency-requests`, `/sensitive-access` |
| tenant | `/leases`, `/work-orders`, `/invoices`, `/documents`, `/payments`, `/notifications` |
| corporate-admin | `/tenant-profiles`, `/leases`, `/documents` |
| occupant | `/leases`, `/work-orders`, `/documents` |
| vendor | `/work-orders`, `/vendors`, `/media` |
| gov | `/agency-requests`, `/exports`, `/packet` |

## Axe results (wcag2a + wcag2aa, serious and critical must be empty)

| Screen | Persona | Result | Spec |
| --- | --- | --- | --- |
| /admin (health summary, orgs, access card) | platform | 0 serious/critical | portal-matrix, manager-ops |
| /admin/feature-flags | platform | 0 | manager-ops |
| /admin/support-sessions | platform | 0 | manager-ops |
| /subaccount | orgadmin | 0 | portal-matrix |
| /manager (operations cockpit) | orgadmin, manager | 0 | portal-matrix, manager-ops |
| /owner | orgadmin, owner | 0 | portal-matrix |
| /finance | orgadmin, books | 0 | portal-matrix |
| /compliance (review queue) | orgadmin, compliance | 0 | portal-matrix |
| /legal (cases) | legal | 0 | portal-matrix |
| /tenant | tenant | 0 | portal-matrix |
| /corporate-admin (corporate overview) | corp | 0 | portal-matrix |
| /occupant (occupant home) | occupant | 0 | portal-matrix |
| /vendor (my jobs) | vendor | 0 | portal-matrix |
| /gov (requests) | gov | 0 | portal-matrix |
| /login, /subaccount/users | anonymous, orgadmin | 0 | access.spec (pre-existing) |

Axe runs after every skeleton (`aria-busy="true"`) inside `main` has resolved, so the audited DOM is the loaded state,
not the loading state. Moderate/minor findings are not gated; none were observed on the screens above during the run.

## Keyboard and focus checks

| Check | Expectation | Spec |
| --- | --- | --- |
| First Tab on a portal page | focuses the "Skip to content" link (`href="#main"`) | portal-matrix "Tab from the skip link" |
| Second Tab | focuses the first sidebar item (Overview) | same |
| Enter on the skip link | focus lands in `#main` | same |
| Open invite Drawer with Enter | focus moves to the first field (Email), not the close button | portal-matrix "Drawer: focus moves inside" |
| Tab x12 and Shift+Tab inside the Drawer | focus never leaves `[role=dialog]` | same |
| Escape | Drawer closes and focus returns to the "Invite user" trigger | same |
| Close button | Drawer closes and focus returns to the trigger | portal-matrix "Drawer close button" |
| Mobile overlay | `aria-label="Close navigation"`, `aria-expanded` on the toggle (unchanged from the shell) | manual |

## Fixes made to shared components

1. `components/ui/index.tsx` — Drawer and Modal now manage focus: on open the first field receives focus, Tab/Shift+Tab
   are trapped inside the panel, Escape closes, and focus returns to the opener on close. The backdrop buttons are
   `tabIndex={-1}` so the trap does not land on an invisible control. Props are unchanged; every existing drawer and
   modal picks this up.
2. `components/shell/app-shell.tsx` — the portal switcher is ordered by the API's canonical `me.portals` order (the
   web registry listed Landlord before Property manager, so the switcher disagreed with the login redirect).
3. `components/shell/app-shell.tsx` — support/act-as banner (`data-testid="support-banner"`, `role="status"`) replaces
   the small badge, names the organization, and offers "Stop acting as org" which clears `bolar.actAsOrg` and reloads.
4. `lib/api-client.ts` — sends `X-Tenant-Org` from `localStorage.bolar.actAsOrg` on every request; cleared on sign-out.
5. `components/work-order-board/board.tsx` — accepts `?workOrderId=<id>` and opens the detail drawer (deep link from
   the operations queue).

## Navigation leaks and hidden fetches found

- None of the 132 denied cells issued a domain request: the shell renders the denied state instead of the page tree, so
  page-level hooks never mount. Placeholder landings (`PortalLanding`) for tenant and owner fetch nothing by design.
- The ops cockpit fetches each source only when the role holds the matching permission (`useCan`) for work orders,
  leases and properties; evaluations, notices, applications and access requests are fetched for every manager-portal
  role, all of which hold those permissions in the current RBAC matrix.

## Remaining findings (not fixed in this slice)

- `nav.ts` lists portals in a different order from `PORTAL_ORDER` in the API; the shell sorts around it, but the two
  registries should share one source.
- Nav items `/tenant/profile`, `/vendor/schedule`, `/vendor/documents`, `/corporate-admin/spend` have no pages yet
  (owned by other slices). The matrix tests portal base routes only.
- The mobile sidebar stays in the DOM (translated off-screen) while closed; its links remain tabbable on small
  screens. Fixing it needs `inert`/`aria-hidden` toggling keyed on the viewport; left for the responsive QA day.
- `org_admin` holds `support_session:start` in the RBAC catalog (it is `ALL` minus two permissions). The platform
  module refuses non-platform actors with an audited `access.denied`, but the catalog itself should drop the permission.
- Support agents without `platform:admin` see the public `/health` check instead of the health summary; counts are
  hidden for them by design.
