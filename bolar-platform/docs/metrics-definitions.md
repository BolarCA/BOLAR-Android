# Metrics definitions (reporting and analytics, blueprint Days 75-90)

Every dashboard number in BOLAR comes from a governed Postgres materialized view, never from an ad-hoc query over
operational tables. This document is the contract for those numbers: what each KPI means, which rows feed it, how it
is computed and which reconciliation rule the API tests enforce (`packages/api/src/__tests__/reporting.test.ts`).

Conventions

- Money is integer cents. Percentages are stored as `numeric(5,2)` in the views and returned as numbers.
- Every view carries `"tenantOrgId"` as its first column with an index; the API always filters on it
  (`WHERE "tenantOrgId" = ctx.tenantOrgId`). There is no unfiltered read path.
- Each view has a unique index so `REFRESH MATERIALIZED VIEW CONCURRENTLY` keeps readers unblocked. `rpt_refresh_all()`
  refreshes all of them and stamps `rpt_freshness."refreshedAt"`, which the API returns as the freshness timestamp.
- Landlords see only rows whose `propertyId` is a property they are `owner_of` (edge on the property or on its portfolio)
  or whose `Property.ownerUserId` is them. Staff roles (`org_admin`, `subaccount_admin`, `property_manager`, `bookkeeper`,
  `platform_admin`, `support_agent`) see the whole org. Tenants, occupants, vendors, corporate admins and government users
  are denied with `403` and an `access.denied` audit row even though some of them hold `finance:read`.

## Rent roll (`rpt_rent_roll`)

| Field | Value |
| --- | --- |
| Name | Rent roll |
| Definition | Every lease currently in status `active`, with its unit, property, primary tenant and contracted monthly rent. |
| Grain | One row per active lease (`leaseId`). |
| Source tables | `Lease`, `Unit`, `Property`, `LeaseParty` (role `primary`), `TenantProfile` |
| Formula | `monthlyRentCents = SUM(Lease.rentCents) WHERE status = 'active'`; `activeLeases = COUNT(*)` |
| Reconciliation rule | `SUM(rpt_rent_roll.rentCents)` for an org equals `SUM(Lease.rentCents) WHERE tenantOrgId = org AND status = 'active'`, and row count equals the active lease count. |
| Notes | Leases in `renewal` are excluded until they return to `active`; `targetRentCents` from the unit is carried so the gap to market rent can be shown. |

## AR aging (`rpt_ar_aging`)

| Field | Value |
| --- | --- |
| Name | Accounts receivable aging |
| Definition | Outstanding balance of every issued invoice that is not settled, bucketed by days past due at refresh time. |
| Grain | One row per outstanding invoice (`invoiceId`). |
| Source tables | `Invoice` (status in `open`, `partially_paid`, `overdue`), `Lease`, `Property`, `Unit`, `TenantProfile` |
| Formula | `balanceCents = GREATEST(totalCents - paidCents, 0)`; `daysPastDue = current_date - dueDate::date`; bucket `current` (<= 0), `1_30`, `31_60`, `61_90`, `90_plus`. Rows with a zero balance are dropped. |
| Reconciliation rule | `SUM(rpt_ar_aging.balanceCents)` equals `SUM(totalCents - paidCents)` over open/partially_paid/overdue invoices of the org, and equals `/invoices/aging` `totals.totalCents` from the finance module. |
| Notes | Mirrors `aging()` in `modules/finance/invoice/service.ts` (same statuses, same bucket edges) so the two reports never disagree on the total. Buckets are relative to the refresh time; the freshness timestamp tells the reader how old they are. |

## Occupancy (`rpt_occupancy`)

| Field | Value |
| --- | --- |
| Name | Occupancy by property |
| Definition | Share of a property's units that are occupied right now, plus the unit status mix and scheduled rent. |
| Grain | One row per property (`propertyId`), including properties with zero units. |
| Source tables | `Property`, `Unit` (status), `Lease` (active, for scheduled rent) |
| Formula | `occupancyPct = occupiedUnits / totalUnits * 100` (0 when `totalUnits = 0`), where `occupiedUnits = COUNT(Unit WHERE status = 'occupied')`; `scheduledRentCents = SUM(Lease.rentCents WHERE status = 'active')` |
| Reconciliation rule | `SUM(totalUnits)` equals `COUNT(Unit)` for the org; `SUM(occupiedUnits)` equals `COUNT(Unit WHERE status = 'occupied')`; `SUM(scheduledRentCents)` equals the rent roll total. |
| Notes | Unit status is the source of truth for occupancy (a unit can be occupied under a lease that is still `signed`); `notice` and `make_ready`/`down`/`reserved` are reported separately so the vacancy pipeline is visible. |

## Maintenance SLA (`rpt_maintenance_sla`)

| Field | Value |
| --- | --- |
| Name | Maintenance SLA compliance |
| Definition | Share of completed work orders that were completed on or before their SLA due time, by property and priority, plus the open orders that already breached. |
| Grain | One row per (`propertyId`, `priority`) that has at least one work order. |
| Source tables | `WorkOrder`, `Property` |
| Formula | `completedOrders = COUNT(status = 'complete' AND completedAt IS NOT NULL)`; `completedWithinSla = COUNT(completed AND (slaDueAt IS NULL OR completedAt <= slaDueAt))`; `slaCompliancePct = completedWithinSla / completedOrders * 100` (0 when none completed); `breachedOpen = COUNT(status NOT IN (complete, canceled) AND slaDueAt < now())`; `avgHoursToComplete = AVG(completedAt - createdAt)` in hours. |
| Reconciliation rule | `SUM(completedOrders)` equals `COUNT(WorkOrder WHERE status = 'complete' AND completedAt IS NOT NULL)` for the org and `SUM(completedWithinSla)` equals the same count with `completedAt <= slaDueAt OR slaDueAt IS NULL`. |
| Notes | Orders without an SLA target cannot be late, so they count as within SLA; the `measured` column (completed orders that had a target) is carried for readers who want the strict ratio. |

## Collections (`rpt_collections_monthly`)

| Field | Value |
| --- | --- |
| Name | Monthly collections |
| Definition | Cash collected from succeeded payments per property per calendar month, next to what was invoiced that month and what the ledger recorded as cash from payments. |
| Grain | One row per (`propertyId`, `month`) with at least one succeeded payment or issued invoice. |
| Source tables | `Payment` (status `succeeded`, month of `COALESCE(receivedAt, createdAt)`), `Invoice` (month of `issuedAt`), `JournalEntry` (`sourceType = 'payment'`, `postedAt`) + `LedgerEntry` on `Account.code = '1000'` |
| Formula | `collectedCents = SUM(Payment.amountCents)`; `invoicedCents = SUM(Invoice.totalCents WHERE status NOT IN (draft, void))`; `ledgerCashCents = SUM(LedgerEntry.debitCents) - SUM(LedgerEntry.creditCents)` on account `1000` from payment journals |
| Reconciliation rule | `SUM(collectedCents)` equals `SUM(Payment.amountCents WHERE status = 'succeeded')` for the org and equals `SUM(LedgerEntry.debitCents)` on account `1000` from `JournalEntry.sourceType = 'payment'` (net of reversals, `ledgerCashCents`). The `/reports/kpis` `collections.thisMonthCents` equals `/finance/summary` `collectedThisMonthCents`. |
| Notes | A payment and its journal entry are posted in the same request so they land in the same month; a refund posts a `reversal` journal and the payment moves to `refunded`, so both sides drop together. |

## Compliance hits (`rpt_compliance_hits`)

| Field | Value |
| --- | --- |
| Name | Compliance hits by severity and resolution |
| Definition | Rule evaluations that did not pass (`warn`, `block`, `review`) grouped by rule severity, result, resolution and domain. |
| Grain | One row per (`severity`, `result`, `resolution`, `domain`), where `resolution` is `open` while `RuleEvaluation.resolution` is null. |
| Source tables | `RuleEvaluation`, `ComplianceRule` (severity, domain) |
| Formula | `hits = COUNT(*)`; `firstHitAt = MIN(createdAt)`; `lastHitAt = MAX(createdAt)` |
| Reconciliation rule | `SUM(hits)` equals `COUNT(RuleEvaluation WHERE result <> 'allow')` for the org; `SUM(hits WHERE resolution = 'open')` equals the count of those with `resolution IS NULL`. |
| Notes | `allow` evaluations are governance evidence, not hits, and are excluded. The view has no property dimension because evaluations attach to leases, listings and applications; it is staff-only. |

## Headline KPIs (`GET /reports/kpis`)

All headline numbers are aggregates over the views above for the caller's org and property scope:

| KPI | Source view | Aggregate |
| --- | --- | --- |
| Active leases / monthly rent | `rpt_rent_roll` | `COUNT(*)`, `SUM(rentCents)` |
| Open AR / overdue AR | `rpt_ar_aging` | `SUM(balanceCents)`, `SUM(balanceCents WHERE bucket <> 'current')` |
| Occupancy | `rpt_occupancy` | `SUM(occupiedUnits) / SUM(totalUnits)` |
| Collected this month / trailing 12 months | `rpt_collections_monthly` | `SUM(collectedCents)` for the current month / last 12 months |
| SLA compliance / breached open | `rpt_maintenance_sla` | `SUM(completedWithinSla) / SUM(completedOrders)`, `SUM(breachedOpen)` |
| Compliance hits (staff only) | `rpt_compliance_hits` | `SUM(hits)`, `SUM(hits WHERE resolution = 'open')`, `SUM(hits WHERE severity = 'critical')` |

Freshness: `refreshedAt` from `rpt_freshness`. The API refreshes inline when the views are older than
`REPORTING_STALE_SECONDS` (default 900 s) and the caller is loading KPIs; the worker refreshes 60 s after a finance,
lease, unit or work-order event and once a day, and staff can force it with `POST /reports/refresh`.

## Scheduled reports and exports

A `ReportDefinition` is a report `kind` (one of the six views), a filter set (`propertyId`, `from`, `to`, `months`), an
optional 5-field cron schedule, a recipient list and a `format` (`csv` or `json`). Running it creates a `ReportRun`
that writes the rows to `org/<org>/reports/<runId>.<ext>` through the storage adapter, records `rowCount` and `sha256`
and audits `report.export` with the row count. Runs created by a landlord are scoped to the properties captured on the
definition when it was created (`scopeJson`), so an export can never contain more than the dashboard would show.
