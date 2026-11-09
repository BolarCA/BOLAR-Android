# Reporting and analytics QA (blueprint Days 75-90)

Scope: governed KPI views (`rpt_*` materialized views), headline KPIs, per-report endpoints, landlord/tenant filters,
scheduled report definitions, audited CSV/JSON exports, worker refresh and the three report screens
(`/finance/reports`, `/owner/reports`, `/manager/reports`). Metric definitions: `docs/metrics-definitions.md`.
Synthetic data only; the storage adapter ran in `local` mode.

## How to reproduce

```bash
cd bolar-platform
pnpm --filter @bolar/db migrate:deploy                     # 20261109081020_reporting_models, 20261109081301_reporting_views
pnpm --filter @bolar/db test                               # tenant client + append-only audit (5 tests)
pnpm --filter @bolar/api exec vitest run reporting         # 13 API tests (reconciliation, scope, exports, scheduler, timings)
export API_PORT=4122 WEB_PORT=3122 QUEUE_DRIVER=memory
pnpm exec playwright test --config tests/playwright.config.ts --trace off tests/e2e/reporting.spec.ts tests/e2e/access.spec.ts
```

The API tests truncate the configured database (`financeFixture` -> `twoTenantFixture`); the Playwright global setup
re-seeds (`db:seed`, `db:seed:demo`). The demo definition and completed run appear once the integrator wires
`seedReportingDemo(org.id)` (`packages/db/seed/modules/reporting.ts`), which also refreshes the views. Without it the
first `/reports/kpis` call refreshes the views inline (they are older than `REPORTING_STALE_SECONDS`, default 900 s),
and staff can press "Refresh data".

## Results

| Check | Where | Result | Evidence |
| --- | --- | --- | --- |
| Migrations | `migrate:dev` x2, `migrate:test` on a scratch DB | pass | 7 materialized views + `rpt_refresh_all()`; `prisma migrate status` clean; `migrate-test OK` |
| Concurrent refresh | `rpt_refresh_all()` in a rolled-back transaction and via `POST /reports/refresh` | pass | every view has a unique index; `REFRESH ... CONCURRENTLY` runs inside the plpgsql function; refresh of the demo seed takes 30-33 ms |
| Rent roll reconciliation | `reporting.test.ts` "rent roll reconciles" | pass | `SUM(rentCents)` 249,000 == `Lease.aggregate(status active)`; row ids == active lease ids; keyset pagination limit=1 -> 2 pages, no overlap, `nextCursor` null at the end; `propertyId` filter narrows totals |
| AR aging reconciliation | "AR aging reconciles" | pass | `totals.totalCents` 204,000 == `SUM(totalCents - paidCents)` over open/partially_paid/overdue == `/invoices/aging` `totals.totalCents`; buckets current 199,000 / 31-60 5,000; `bucket=current` filter -> 2 rows |
| Occupancy reconciliation | "occupancy reconciles" | pass | `SUM(totalUnits)` == `COUNT(Unit)`, `SUM(occupiedUnits)` == occupied count, 66.67 %; per-property 50 % with 1 active lease / 150,000 scheduled rent; `scheduledRentCents` == rent roll total |
| Maintenance SLA reconciliation | "maintenance SLA reconciles" | pass | completed 4 == `COUNT(status complete AND completedAt not null)`; within SLA 2 (incl. an order without SLA); late 1; breached open 1; property x priority row: 2 completed, 1 on time, 50 %, avg 48 h |
| Collections reconciliation | "collections reconcile" | pass | `collectedCents` 50,000 == succeeded payments == `SUM(LedgerEntry.debitCents)` on account 1000 from `sourceType = payment` (`reconciled: true`); `byMonth` one month with invoiced 254,000; KPI `thisMonthCents` == `/finance/summary.collectedThisMonthCents` |
| Compliance hits reconciliation | "compliance hits reconcile" | pass | hits 2 == `COUNT(RuleEvaluation result <> allow)`, open 1 == resolution null; `allow` row excluded; bySeverity/byResolution totals match |
| Headline KPIs | "headline KPIs carry freshness" | pass | `refreshedAt` < 60 s old, `staleSeconds` < 60, `propertyCount` 2, every block equals the per-report totals above |
| Tenant isolation | "tenant isolation: org B" | pass | 6 endpoints for org B contain none of org A's property/lease ids; every row's `propertyId` is org B's property; org B KPIs equal org B source (1 lease 120,000; AR 0; collections 120,000; 1 hit); org A definition is 404 for org B's run and absent from its list |
| Landlord scope | "landlord scope" | pass | owner_of one property: KPIs `scope: properties`, `propertyCount` 1, `complianceHits: null`; rent roll / occupancy / collections / SLA rows only for the owned property; `propertyId` outside scope -> 200 with 0 rows and zero totals (no existence leak); AR aging, compliance hits and refresh -> 403 with `access.denied` audit rows |
| Denied roles | "tenants and vendors are denied" | pass | tenant (holds `finance:read`) -> 403 on KPIs, rent roll and definition create with `access.denied` (`permission: finance:read`); vendor (no permission) -> 403 at the route gate |
| Definitions and exports | "scheduled definitions run to an audited, downloadable export" | pass | invalid cron / kind -> 400; create -> 201 with cron, recipients, format; run -> 201 `complete`, `rowCount` 2, `storageKey org/<org>/reports/<runId>.csv`, `reports` job enqueued (`report-run:<id>`) and executed inline in memory mode; CSV header is the documented column order with 2 data rows; `report.export` audit carries `rowCount`, `kind`, `format`, `sha256`, `requestedBy`; `report.run_requested` by the actor; detail returns a signed URL and audits `report.downloaded`; `lastRunAt` set |
| Export scope | same test | pass | landlord definition stored with `scopeJson.propertyIds = [ownedProperty]`; its JSON run has 1 row for that property only; landlord cannot run or read the bookkeeper's definition/run (404); run list filtered to own |
| Daily scheduler | "daily scheduler runs definitions" | pass | `cronMatchesDay` for day-of-month, month, weekday ranges and steps; `runDueScheduledReports` runs the due definition once (`trigger: schedule`, 3 AR rows), skips the paused one and nothing on the second call the same day; running a paused definition -> 409 |
| Seed | `seedReportingDemo(demoOrg)` run twice against `bolar_agent2` | pass | 1 definition ("Monthly rent roll (CSV)", cron `0 6 1 * *`), 1 completed run with the CSV written under `packages/api/.storage/org/<org>/reports/<runId>.csv`, views refreshed; second run creates nothing |
| Full API suite | `pnpm --filter @bolar/api test` | pass | 30 files, 209 tests |
| Lint / typecheck | `pnpm lint`, `pnpm typecheck` (monorepo root) | pass | 14/14 tasks each |
| OpenAPI | `pnpm openapi:generate` | pass | 261 operations, 12 under `/reports/*`, `packages/contracts/openapi.yaml` committed |
| E2E | `tests/e2e/reporting.spec.ts` + `access.spec.ts` on 4122/3122 | pass (15/15) | see below |

### E2E journeys (`@smoke`, `@a11y`)

1. Bookkeeper opens `/finance/reports`, presses "Refresh data" (`POST /reports/refresh` 200), the KPI strip shows the
   seeded $1,450.00 (rent roll == active lease, open receivables == INV-000001), the rent roll lists Maple Court
   Apartments / Unit 101 / Theo Tenant, the AR aging tab shows the invoice and totals, the collections tab renders the
   SVG chart as an accessible image.
2. Bookkeeper creates a scheduled CSV rent-roll definition (cron `0 6 1 * *`, one recipient) from the drawer, the row
   shows the schedule, "Run now" returns 201 `complete` with rows >= 1, the run row shows `complete`, "Download"
   fetches the signed URL and the "Open CSV" link appears with `/storage/object?key=`.
3. Owner opens `/owner/reports`: KPI strip with Occupancy, no refresh button, the occupancy table has exactly 3 rows
   (Maple Court, Riverside Lofts, Sunset Bungalows), the rent roll shows the owner's tenant.
4. Tenant navigating to `/finance/reports` sees the denied state and no `/reports/*` request is sent.
5. axe (wcag2a/wcag2aa) on `/finance/reports` and `/owner/reports`: no serious or critical violations.

An earlier run had one unrelated failure in `access.spec.ts` ("wrong password shows one generic error" saw the
network-error fallback) while `pnpm lint` was rebuilding the API package in parallel; the isolated re-run passed 15/15.

## Performance (target: every report endpoint < 300 ms on the demo seed)

Measured with `curl` against `pnpm --filter @bolar/api dev` on port 4122 after `db:seed:demo` + `seedReportingDemo`
(three samples each, after one warm-up):

| Endpoint | Bookkeeper (ms) | Landlord (ms) |
| --- | --- | --- |
| `GET /reports/kpis` | 16 / 10 / 13 | 11 |
| `GET /reports/rent-roll` | 7 / 7 / 6 | 9 |
| `GET /reports/ar-aging` | 6 / 7 / 7 | 403 in 6 |
| `GET /reports/occupancy` | 6 / 8 / 5 | 9 |
| `GET /reports/maintenance-sla` | 6 / 6 / 8 | - |
| `GET /reports/collections?months=12` | 6 / 5 / 9 | - |
| `GET /reports/compliance-hits` | 7 / 5 / 6 | - |
| `GET /reports/definitions` | 5 / 4 / 5 | - |
| `GET /reports/runs` | 6 / 9 / 5 | - |
| `POST /reports/refresh` (all 7 views) | 30 | - |

In the API test (two-org fixture, supertest, cold Prisma statements) the first calls took: kpis 17, rent-roll 9,
ar-aging 14, occupancy 13, maintenance-sla 6, collections 17, compliance-hits 7 ms; the test asserts each stays under a
1,500 ms guard so CI noise cannot flake it while the documented target is 300 ms.

Why it stays flat: the API never aggregates operational tables at request time. Each endpoint runs one keyset page
(`WHERE "tenantOrgId" = $1 ... ORDER BY "sortKey" LIMIT limit+1`, indexes on `("tenantOrgId", "sortKey")`) plus one
aggregate over the same filtered view, and lists are capped at 100 rows per page; exports read in 500-row batches up to
10,000 rows.

### EXPLAIN excerpts (demo seed, `EXPLAIN (ANALYZE, BUFFERS)`)

`rpt_collections_monthly` (heaviest: three aggregating CTEs over payments, invoices and payment cash postings, unioned
by (tenant, property, month)):

```
Hash Left Join (actual rows=2 loops=1)   Buffers: shared hit=18
  CTE pay  -> GroupAggregate (rows=1)  Seq Scan on "Payment" (Filter: status = 'succeeded') -> Index Scan Invoice_pkey -> Index Scan Lease_pkey
  CTE inv  -> HashAggregate (rows=2)   Seq Scan on "Invoice" (Filter: issuedAt IS NOT NULL AND status <> ALL('{draft,void}')) Hash Join Lease
  CTE led  -> GroupAggregate (rows=1)  Seq Scan "LedgerEntry" (propertyId IS NOT NULL) Hash Join "Account" (code = '1000') -> Index Scan JournalEntry_pkey
             Filter: postedAt IS NOT NULL AND (sourceType = 'payment' OR (sourceType = 'reversal' AND hashed SubPlan))
  -> HashAggregate over Append(pay, inv, led) -> Hash Join "Property"
Planning Time: 2.599 ms   Execution Time: 0.790 ms
```

`rpt_ar_aging` (one row per outstanding invoice with four lookups):

```
Nested Loop Left Join (actual rows=1 loops=1)   Buffers: shared hit=8
  Hash Join (l.id = i.leaseId): Seq Scan "Lease" x Hash(Seq Scan "Invoice" Filter: status = ANY('{open,partially_paid,overdue}') AND totalCents - paidCents > 0)
  -> Index Scan Property_pkey -> Index Scan Unit_pkey -> Index Scan TenantProfile_pkey
Planning Time: 0.600 ms   Execution Time: 0.126 ms
```

API read path on the view (tenant filter + keyset order):

```
Limit (actual rows=1) -> Sort (Sort Key: "sortKey") -> Seq Scan on rpt_ar_aging  Filter: ("tenantOrgId" = $0)
Execution Time: 0.026 ms
```

The seq scans are the planner's choice for tables of a few rows; the `("tenantOrgId", "sortKey")` and
`("tenantOrgId", "propertyId")` indexes on each view take over as the views grow. Refresh cost scales with the source
tables, not with request volume, and runs off the request path (worker debounce 60 s after finance/lease/unit/work-order
events, daily job `0 4 * * *`, or `POST /reports/refresh`).

## Tenant filter proof

- Every SQL statement in `modules/reporting/service.ts` is a tagged `Prisma.sql` template that starts with
  `WHERE "tenantOrgId" = ${tenantOrgId}`; the property scope and user filters are appended fragments, never a
  replacement. `reportingScope()` is called before any view is read; it returns `org` for staff, the owned property ids
  for landlords and throws an audited 403 for every other role.
- `reporting.test.ts` "tenant isolation" asserts that none of org A's property/lease ids appear in any org B response
  and that org B totals equal org B's own source tables; "landlord scope" asserts a landlord sees exactly one property's
  rows and that a `propertyId` outside the scope yields zero rows rather than a 404.
- Materialized views are global objects, so they are refreshed for all tenants at once; the data a request sees is
  still only the rows matching its `tenantOrgId`.

## Export audit

| Action | Actor | When | Metadata |
| --- | --- | --- | --- |
| `report.definition_created` | requester | `POST /reports/definitions` | name, kind, cron, format, recipient count, scope kind |
| `report.run_requested` | requester | `POST /reports/definitions/:id/run` | definitionId, kind, format |
| `report.export` | system (`report_<runId>`) | run completes (inline or `reports` worker) | definitionId, kind, format, `rowCount`, truncated, storageKey, sha256, requestedBy, trigger, scope; `outcome: error` with the message on failure |
| `report.downloaded` | requester | `GET /reports/runs/:id` when complete | sha256, rowCount, storageKey |
| `report.refresh` | staff | `POST /reports/refresh` | durationMs, refreshedAt |
| `access.denied` | any | scope or staff-only check fails | permission, reason |

Files are written through `createStorageAdapter()` under `org/<org>/reports/<runId>.<csv|json>`; the API never serves
them directly, only a short-lived signed URL (`STORAGE_SIGNED_URL_TTL_SECONDS`).

## Role matrix

| Capability | bookkeeper / org_admin / property_manager | landlord | tenant / corp_admin | vendor / others |
| --- | --- | --- | --- | --- |
| KPIs, rent roll, occupancy, maintenance SLA, collections | org | owned properties only | 403 + audit | 403 (no `finance:read`) |
| AR aging, compliance hits | org | 403 + audit | 403 + audit | 403 |
| Refresh views | yes (audited) | 403 + audit | 403 + audit | 403 |
| Definitions / runs | all in org | own, pinned to owned properties | 403 + audit | 403 |
| Web | `/finance/reports`, `/manager/reports` | `/owner/reports` | denied by the portal shell | denied |

## Known gaps in this phase

- Scheduled definitions run once per day from the worker's daily job; the cron's minute/hour fields are stored but not
  used for sub-daily scheduling. Recipients are recorded and published on `report.completed`; the notification module
  maps that event to an email template in a later phase.
- Collections count only `succeeded` payments (net of refunds) while `/finance/summary.collectedThisMonthCents` also
  includes `refunded` payments gross; the two agree whenever no refunds exist in the month (asserted by the test).
- Compliance hits have no property dimension (evaluations attach to leases, listings and applications), so the view is
  staff-only and landlords get `complianceHits: null` in the KPIs.
- No Metabase/Superset or warehouse: the demo volume does not justify one; the views are the governed layer any BI tool
  would read.
