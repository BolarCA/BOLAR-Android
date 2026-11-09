# Core data QA: properties and units (Day 20)

Scope: blueprint Days 16-20 (property/portfolio CRUD, unit CRUD and status transitions, property UI slice,
search/hierarchy with cursor pagination, core data QA). Module: `packages/api/src/modules/property`,
contracts `packages/contracts/src/property.ts`, tests `packages/api/src/__tests__/property.test.ts`,
e2e `tests/e2e/property.spec.ts`. All data referenced here is synthetic.

## 1. Cross-tenant tests

Fixture: `twoTenantFixture()` creates two orgs that share names ("Northside Property Management",
"Shared Name Tower") with an org admin and a property manager each.

| Check | Org B actor against org A data | Result |
| --- | --- | --- |
| `GET /properties` | list never contains org A ids | pass |
| `GET /properties/:id` | 404 | pass |
| `PATCH /properties/:id` | 404, row unchanged | pass |
| `POST /properties/:id/archive` | 404 | pass |
| `GET/POST /properties/:id/units` | 404 | pass |
| `GET /properties/:id/hierarchy` | 404 | pass |
| `GET /units/:id` | 404 | pass |
| `POST /units/:id/status` | 404, status unchanged | pass |

Every tenant-scoped query goes through `tenantDb(ctx)` (`forTenant` extension stamps and filters `tenantOrgId`);
the only root-client reads are `relationshipEdge` lookups in `access.ts`, which are filtered by `ctx.tenantOrgId`.
Denied and missing records are indistinguishable (404), so existence does not leak.

## 2. Denied paths

| Actor | Action | Expected | Audit |
| --- | --- | --- | --- |
| `tenant` (no `property:read`) | `GET /properties` | 403 `forbidden` | coarse gate (no resource) |
| `tenant` | `POST /properties` | 403 | coarse gate |
| `landlord` (org role, no relationship) | `GET /properties/:id` | 404 | `access.denied` row with `resourceType=property`, `resourceId`, `outcome=deny`, `metadata.permission=property:read` |
| `landlord` | `POST /properties` | 403 (role lacks `property:write`) | coarse gate |
| `landlord` with `owner_of` | `POST /units/:id/status` | 403 (role lacks `unit:write`) | coarse gate |
| property-scoped `property_manager` | `GET /properties/:other` | 404 + `access.denied` | yes |
| property-scoped `property_manager` | `POST /properties` | 403 + `access.denied` (create needs org/subaccount-covering write scope) | yes |

### Access model notes (RBAC + ReBAC)

- Same decision engine as `shared/access.ts` (`rolesCovering`, `hasRelationship`), see `modules/property/access.ts`.
- **Landlord is relationship-gated**: an org-scoped `landlord` role means "member of the org", not "owner of
  every property". Landlords see exactly the properties they are `owner_of`, properties inside a portfolio they are
  `owner_of`, or properties covered by a property/subaccount-scoped assignment. This is what makes the demo landlord
  (org-scoped role + `owner_of` on three properties) see three properties and not a fourth created by the manager.
- `owner_of` a portfolio implies read access to the portfolio and all properties in it.
- `manages` / `bookkeeper_for` / `member_of` on a subaccount implies access to properties in that subaccount.
- List endpoints apply the same scope as a `WHERE` clause (`propertyScopeWhere`); an actor with a valid role but no
  reachable properties gets an empty page, not a 403.

## 3. Index verification (EXPLAIN)

Run by the test "EXPLAIN uses the composite indexes" after inserting 1,500 synthetic properties and units and
`ANALYZE`, with `SET LOCAL enable_seqscan = off` so the planner must pick an index (small tables otherwise make
every index cost the same). Output captured from `pnpm --filter @bolar/api test -- property`:

```
-- SELECT id FROM "Property" WHERE "tenantOrgId" = $1 AND status = $2 AND city = $3
Bitmap Heap Scan on "Property"  (cost=5.30..38.70 rows=80 width=26)
  Recheck Cond: (("tenantOrgId" = $1) AND (status = 'active') AND (city = 'Austin'))
  ->  Bitmap Index Scan on "Property_tenantOrgId_status_city_idx"  (cost=0.00..5.28 rows=80 width=0)
        Index Cond: (("tenantOrgId" = $1) AND (status = 'active') AND (city = 'Austin'))

-- SELECT id FROM "Unit" WHERE "tenantOrgId" = $1 AND "propertyId" = $2 AND status = $3
Bitmap Heap Scan on "Unit"  (cost=7.76..41.54 rows=273 width=26)
  Recheck Cond: (("tenantOrgId" = $1) AND ("propertyId" = $2) AND (status = 'vacant'))
  ->  Bitmap Index Scan on "Unit_tenantOrgId_propertyId_status_idx"  (cost=0.00..7.69 rows=273 width=0)
        Index Cond: (("tenantOrgId" = $1) AND ("propertyId" = $2) AND (status = 'vacant'))

-- SELECT id FROM "Property" WHERE "tenantOrgId" = $1 ORDER BY "createdAt" DESC, id DESC LIMIT 26
Limit  (cost=0.28..3.42 rows=26 width=34)
  ->  Index Only Scan Backward using "Property_tenantOrgId_createdAt_id_idx" on "Property"
        Index Cond: ("tenantOrgId" = $1)
```

Invariants from schema p16 are therefore backed by `Property_tenantOrgId_status_city_idx` and
`Unit_tenantOrgId_propertyId_status_idx`; keyset pagination on properties uses
`Property_tenantOrgId_createdAt_id_idx`. Unit lists are ordered by `(unitNumber, id)` inside one property, which the
`(tenantOrgId, propertyId, unitNumber)` unique index serves.

## 4. Pagination

- Properties: keyset on `(createdAt desc, id desc)`; cursor is base64url `{createdAt, id}`. Test walks all
  properties with `limit=3` and compares with a single `limit=100` page (same order, no duplicates, no gaps).
- Units: keyset on `(unitNumber asc, id asc)`; test walks 23 units with `limit=5`.
- Unit history: keyset on `(changedAt desc, id desc)`.
- `limit` is bounded 1..100 (`limit=0` and `limit=101` are 400); an undecodable cursor falls back to the first page.
- Hierarchy returns at most 500 units and sets `truncated=true` beyond that; clients then use the paged unit list.

## 5. API schemas

`pnpm openapi:generate` adds 17 operations under tag `property` (portfolios 4, properties 4, buildings 2, units 6,
hierarchy 1). Every request/response is a zod schema in `packages/contracts/src/property.ts` with `.openapi()`
names (`Portfolio`, `Property`, `PropertyDetail`, `Building`, `Unit`, `UnitStatusChange`, `UnitStatusHistory`,
`PropertyHierarchy`, `UnitCounts`). Validation errors return `{code:'validation_error', fieldErrors:[{path,message}]}`
with `body.*` paths that the UI maps onto fields.

## 6. State machine

`modules/property/state-machine.ts`: `vacant -> reserved|make_ready|down|occupied`, `occupied -> notice|vacant`,
`notice -> vacant|occupied`, `make_ready -> vacant`, `down -> make_ready|vacant`, `reserved -> occupied|vacant`.
Illegal transitions are 409 `invalid_transition`. Each transition writes `UnitStatusHistory` (in the same DB
transaction as the unit update), an audit row `unit.status_change`, and publishes `unit.status_changed
{unitId, propertyId, from, to, reason}`. `reason` is required (3-500 chars). `availableFrom` is set to now when a
unit becomes vacant and cleared when it becomes occupied.

## 7. Search seam

Filters (`status`, `city`, `state`, `portfolioId`, `subaccountId`, `q` on name/address/city) run on PostgreSQL via
the indexes above and `ILIKE`-style `contains` for `q`. OpenSearch is a **later seam only**: if full-text or
geo search is needed, index `property.created|updated|archived` and `unit.*` domain events into OpenSearch from a
worker reaction and keep PostgreSQL as the source of truth. Nothing in this module depends on it.

## 8. Blockers / dependencies for lease and work-order modules

| Dependency | Owner | Contract exposed here |
| --- | --- | --- |
| Active-lease overlap prevention | lease module | Units expose `status`, `availableFrom`, `nextStatuses`; lease activation should `POST /units/:id/status {toStatus:'occupied'}` (or call the state machine) and termination should move to `notice`/`vacant`. The property module does not block transitions on lease rows, so the lease module must enforce date overlap on `Lease(unitId, startDate, endDate)`. |
| Lease -> unit lifecycle | lease module | Subscribe to `lease.transitioned` and drive unit status; subscribe to `unit.status_changed` for notice/vacancy reporting. |
| Work orders per unit/property | maintenance module | Work orders reference `propertyId`/`unitId`; use `requirePropertyAccess(ctx, 'work_order:read', property)` from `modules/property/access.ts` or `requireAccess` with `propertyId` so vendor/manager relationships resolve through the property. |
| Property archive | lease + maintenance | Archive is blocked while units are occupied/notice/reserved; open work orders are not checked yet (needs `work_order` ownership agreed). |
| Owner relationship provisioning | iam / onboarding | Landlord visibility depends on `owner_of` edges (property or portfolio); creating a property does not create an edge even when `ownerUserId` is set. Decide whether `ownerUserId` should auto-grant `owner_of`. |
| Demo seed wiring | integrator | Call `seedPropertyDemo(org.id)` from `packages/db/seed/modules/property.ts` after `seedDemo` creates properties. |

## 9. Results summary

- `pnpm --filter @bolar/api test`: 40/40 across 7 files; property suite 11/11 (CRUD, archive guard, filters,
  tenant isolation, denied + audit, ReBAC list filtering, unit CRUD, state machine, hierarchy, pagination, EXPLAIN).
- `pnpm lint` and `pnpm typecheck` at the monorepo root: 14/14 tasks green; `pnpm --filter @bolar/web typecheck` green.
- Playwright (`API_PORT=4101 WEB_PORT=3101`, `property.spec.ts` + `access.spec.ts`): 15/15 passed, including the
  mobile project for the detail axe check. Coverage: manager journey (create property, unit, status change with
  reason, hierarchy), owner sees only owned properties + denied unowned detail, tenant denied on
  `/manager/properties` with zero property/unit API calls, axe on list and detail (`@smoke`, `@a11y`).
- `seedPropertyDemo(orgId)` run twice against the demo org: 3 buildings, 22 history rows, 0 unassigned units, identical
  counts on the second run (idempotent).
- Operational note: the API dev server is `tsx watch`; rebuilding workspace `dist/` folders (e.g. `pnpm lint`) while
  Playwright runs restarts it and surfaces as a transient "Sign in failed" in whichever test is logging in.
