# Maintenance QA (Days 31-35)

Checks for the maintenance and vendor slice: request intake, work order state machine, SLA, vendor rules, board UI,
and the Day 35 fixtures (emergency leak, duplicate, vendor denial, cancellation, reopened issue). Automated coverage
is listed next to each item; manual steps are for the demo org (`pnpm db:seed:demo`, then the integrator-wired
`seedMaintenanceDemo`).

## Commands

```bash
pnpm --filter @bolar/api test -- maintenance vendor          # API tests (packages/api/src/__tests__/{maintenance,vendor}.test.ts)
export API_PORT=4104 WEB_PORT=3104 QUEUE_DRIVER=memory
pnpm exec playwright test --config tests/playwright.config.ts tests/e2e/maintenance.spec.ts   # @smoke + @a11y
```

## State machine

| From | To | Allowed | Guard | Covered by |
| --- | --- | --- | --- | --- |
| new | triaged | manager | | API test "state machine", e2e "manager triages" |
| triaged | assigned | manager | assignee set (`POST /assign` does this and auto-moves) | API test |
| assigned | triaged | manager, vendor | note required; clears assignment and ends `assigned_to` edge | API test "vendor denial" |
| assigned | scheduled | manager, vendor | `scheduledFor` | API + e2e |
| scheduled | in_progress | manager, vendor | | API + e2e "vendor sees the job" |
| in_progress | blocked | manager, vendor | note required | API |
| blocked | in_progress | manager, vendor | | API |
| in_progress | review | manager, vendor | `actualCents` optional | API |
| review | complete | manager | sets `completedAt` | API |
| complete | reopened | manager, tenant requester | within 30 days; `reopenedCount++` | API (+ 45-day negative case) |
| reopened | triaged | manager | | API |
| any open | canceled | manager; tenant requester only from new/triaged | note required | API "tenant may cancel" |

Illegal transitions return `409 invalid_transition`; the wrong actor kind returns `403`. The detail endpoint returns
`allowedTransitions` and `actorKinds`, and the UI renders only those buttons; the API is authoritative.

## SLA

- `slaDueAt` by priority: emergency 24h, high 72h, normal 7d, low 14d (API test checks each via create and PATCH).
- `PATCH` with a new priority recomputes the SLA from `createdAt` and writes an `escalated` event.
- `POST /work-orders/sla/scan` marks each overdue open order once (`sla_breached` event, audit row, domain event) and
  is idempotent (second scan returns no new ids). `overdue=true` list filter and the `overdue` DTO flag agree.
- Board: red chip "Overdue", amber inside 4 hours, lane top border turns red when it holds an overdue order.

## Access invariants (p19)

| Actor | Can see | Can change | Covered by |
| --- | --- | --- | --- |
| Resident (tenant/occupant) | own requests, requests on their unit | create, notes/messages, cancel (new/triaged), reopen | API "residents only see their own" (404 + `access.denied` audit) |
| Vendor | only orders assigned to their VendorProfile or `assigned_to` edge | schedule, start, block, review, decline, notes, photos | API "vendor access is limited", e2e "vendor cannot open" |
| Property manager | orders on properties in role scope or `manages` edge | everything above plus triage, assign, complete, cancel, PATCH, SLA scan | API "property-scoped manager" |
| Landlord | orders on owned properties (read) | nothing | role matrix (`work_order:read` only) |
| Other org | nothing (404) | nothing | API tenant isolation tests for both modules |

## Vendor rules (Day 33)

`GET /vendors/eligible?workOrderId=` evaluates every non-archived vendor and returns reasons:
`vendor_not_approved`, `trade_mismatch`, `outside_coverage` (empty `coverageJson.propertyIds` = all properties),
`insurance_missing`, `insurance_expired`, `over_budget` (only when both estimate and budget are set).
`POST /work-orders/:id/assign` rejects with `400` and the same reasons as `fieldErrors`. Category to trade mapping is
`CATEGORY_TRADES` in `packages/contracts/src/vendor.ts`; `general` covers most categories and `other` accepts any trade.

## Day 35 fixtures

| Fixture | Steps | Expected | Automated |
| --- | --- | --- | --- |
| Emergency leak | Tenant files `plumbing` + `emergency` at Maple 101 | 24h SLA, confirmation with request number and 911 guidance, `work_order.created` event, card in New lane with SLA chip | e2e test 1, API "tenant submits" |
| Duplicate | Tenant files a second plumbing request for the same unit within 7 days | `possibleDuplicateId` set, warning on confirmation; manager "mark duplicate" cancels and links | API "duplicate hint" |
| Vendor denial | Vendor opens an assigned job and uses "Decline / unassign" with a reason | back to `triaged`, assignment cleared, vendor loses access, `unassigned` event | API "vendor denial" |
| Cancellation | Tenant cancels a new request with a reason; tenant tries after assignment | first succeeds, second is `409`; manager can cancel any open order with a reason | API "tenant may cancel" |
| Reopened issue | Tenant reopens a completed job | `reopenedCount` 1, order in Triage lane with "reopened" badge; after 30 days `409` | API "state machine", "reopen window" |
| SLA breach | Seeded "Bathroom exhaust fan not working" (normal, 10 days old) + "Run SLA scan" | one `sla_breached` event, worker logs escalation, board shows red chip | API "SLA", seed `seedMaintenanceDemo` |

## Audit and notification events to verify

Audit actions: `work_order.create`, `work_order.update`, `work_order.transition`, `work_order.assign`,
`work_order.note`, `work_order.mark_duplicate`, `work_order.sla_breached`, `access.denied` (resource type
`work_order`), `vendor.create`, `vendor.update`, `vendor.approve`, `vendor.suspend`, `vendor.contract.create`,
`vendor.invite`. Domain events: `work_order.created`, `work_order.transitioned {workOrderId, from, to}`,
`work_order.assigned`, `work_order.message`, `work_order.sla_breached`, `vendor.created`, `vendor.approved`,
`vendor.suspended`, `invitation.created` (vendor invite). The notification module maps `work_order.created` to the
`workorder.created` template and scheduled visits to `sms.workorder.scheduled`.

## Manual UI checks

1. `/manager/maintenance`: lanes New, Triage, Assigned, Scheduled, In progress, Blocked, Done; list toggle; filters
   by property, priority, vendor, assignee; "Overdue only" count; empty state with "Clear filters" when filters hide
   everything; drawer shows timeline, vendor panel, photo evidence (or the "not available in this build" note when the
   media endpoint is absent), notes, actions, assign vendor with disabled ineligible options and their reasons.
2. Mobile width (`Pixel 7` project): lanes collapse to a "Lane" selector plus list; cards keep the SLA chip.
3. `/manager/vendors`: list, filters, "Add vendor" drawer; `/manager/vendors/[id]`: approve/suspend, contracts
   (insurance certificate end date updates expiry badge), invite with local accept link, assigned work orders.
4. `/tenant/maintenance`: priority guidance text changes with the selection and turns red for emergency; up to three
   availability windows; photos upload after creation or show the "not available" note; "My requests" opens the drawer
   where the tenant can message, cancel (new/triaged) or reopen (complete).
5. `/vendor`: KPI cards, assigned jobs only; `/vendor/jobs/[id]` for a job not assigned shows the denied state.
6. Permission denied: tenant at `/manager/maintenance` sees the denied state with no `/work-orders` request.

## Known limits (documented, not stubs)

- Linking `VendorProfile.userId` automatically when a vendor invitation is accepted is out of scope for this slice;
  until the integrator adds it to `POST /invitations/accept`, a manager links the login with `PATCH /vendors/:id {userId}`
  (the vendor page shows "not linked" until then).
- The property filter on the board is derived from loaded work orders because the property module routes are not in
  this slice; it will switch to `GET /properties` when that lands.
- Photo evidence depends on the docs-comms media contract; a 404 renders the documented "not available in this build" state.
