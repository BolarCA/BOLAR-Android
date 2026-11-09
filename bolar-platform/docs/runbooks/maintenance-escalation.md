# Maintenance escalation runbook

Scope: work orders in the maintenance module (blueprint Days 31-35). This runbook covers the three situations
that stall a repair or put people at risk: a stuck vendor, a safety issue, and an SLA breach. Each path names an
owner, the timer that starts the clock, and the action at each step. Every action below leaves an audit row
(`work_order.*`) and a timeline event, so the escalation can be reconstructed afterwards.

## Reference

| Priority | SLA target (`slaDueAt`) | First escalation | Owner |
| --- | --- | --- | --- |
| emergency | 24 hours | at creation (page on-call manager) | On-call property manager |
| high | 72 hours | 48 hours after creation if not `scheduled` | Property manager |
| normal | 7 days | at SLA breach | Property manager |
| low | 14 days | at SLA breach | Property manager |

- SLA breaches are detected by `POST /work-orders/sla/scan` (manager button "Run SLA scan" on the board, or the
  scheduler). Each overdue open order gets exactly one `sla_breached` timeline event and one `work_order.sla_breached`
  domain event; the worker reaction (`packages/workers/src/handlers/reactions/maintenance.ts`) logs the escalation
  and the notification module maps the event to templates.
- Board signals: red SLA chip on the card, red top border on the lane, "Overdue only" filter with a count.
- States and who may move them are listed in `docs/qa/maintenance-qa.md`.

## Path A: stuck vendor

Trigger: a job is `assigned` without a schedule for 24 hours (emergency: 2 hours), `scheduled` and the visit time
has passed without `in_progress`, or `blocked` for more than 48 hours.

| Step | Timer | Owner | Action |
| --- | --- | --- | --- |
| 1. Nudge | T+0 | Property manager | Add a timeline note (`POST /work-orders/:id/notes`) and call the vendor using the phone on the vendor drawer. |
| 2. Decline on their behalf | T+4h (emergency: T+1h) | Property manager | If the vendor confirms they cannot do it, use "Decline / unassign" with the reason. The order returns to `triaged`, the `assigned_to` edge ends and the vendor loses access to the job. |
| 3. Reassign | immediately after step 2 | Property manager | Open the drawer, pick another vendor from the eligible list (rules: approved, trade, coverage, insurance, budget). Ineligible vendors show the failing rule; fix the vendor record (insurance certificate, coverage) rather than bypassing it. |
| 4. In-house fallback | T+24h with no eligible vendor | Property manager | Assign a staff user (`POST /work-orders/:id/assign {userId}`) and schedule from the manager side. |
| 5. Vendor review | weekly | Subaccount admin | Vendors with two declines or a no-show in 30 days: open the vendor page, add a note in the MSA contract metadata and consider "Suspend". Suspended vendors keep access to current jobs but receive no new ones. |

Blocked jobs: a `blocked` transition requires a reason. If the reason is a part or an approval, record the expected
date in a note. If the reason is tenant access, switch to Path B step 1 wording for entry notice rules; entry notices
go through the notice module.

## Path B: safety issue

Trigger: category `safety`, or any request mentioning gas, fire, flooding, electrical sparks, structural failure,
carbon monoxide, or a lock-out. Residents are told on the intake form to call 911 first for danger to life.

| Step | Timer | Owner | Action |
| --- | --- | --- | --- |
| 1. Confirm priority | within 15 minutes of creation | On-call property manager | Set priority to `emergency` (PATCH recomputes the SLA to 24 hours and writes an `escalated` event). Triage immediately. |
| 2. Make safe | within 1 hour | On-call property manager | Dispatch the nearest eligible vendor or in-house staff; if none, instruct the resident to shut off water/gas/breaker where safe and document the instruction as a `message` note. |
| 3. Habitability check | same day | Property manager + compliance officer | If the unit is uninhabitable, open a compliance review (notice module) and arrange alternative accommodation per the lease and jurisdiction rules. |
| 4. Close-out | at `review` | Property manager | Require photo evidence before `complete`. Verify the vendor's `actualCents`; if it exceeds the estimate by more than 20 percent, record the reason. |
| 5. Post-incident | within 5 business days | Subaccount admin | Review the timeline and audit rows; if the same unit or system has a repeat within 30 days (`reopened` or duplicate hint), raise a property-level inspection work order. |

## Path C: SLA breach

Trigger: `work_order.sla_breached` (scan run) or a red SLA chip on the board.

| Step | Timer | Owner | Action |
| --- | --- | --- | --- |
| 1. Acknowledge | within 1 business hour of the scan | Property manager | Open the order, add a note with the cause (vendor capacity, parts, access, triage delay) and the new target date. |
| 2. Unblock | same day | Property manager | Apply Path A if a vendor is the cause, Path B if safety is involved. Otherwise schedule the visit. |
| 3. Resident update | same day | Property manager | Send a `message` note; the notification module relays it. Emergency breaches: phone call plus message. |
| 4. Escalate | breach older than 48 hours (emergency: 4 hours) | Subaccount admin | Review open breaches with the "Overdue only" filter, reassign workload between managers, and record the decision as a note on each order. |
| 5. Report | weekly | Subaccount admin | Export breached orders (board list view, overdue filter) for the owner report; repeated breaches on one property feed the vendor review in Path A step 5. |

## Reopened and duplicate work

- A resident may reopen within 30 days of completion. A reopened order goes back to `triaged` and keeps its history;
  treat it as a breach candidate: re-triage the same day, prefer the original vendor if warranty applies.
- The intake API returns `possibleDuplicateId` for a same-unit, same-category open request within 7 days. Managers
  merge with "mark duplicate" (`POST /work-orders/:id/mark-duplicate`), which cancels the newer order with a reason and
  links it to the original. Never cancel a duplicate without the link; residents see both numbers.

## Contacts and hand-offs

- Vendor contact details are on the work order drawer (vendor panel) and the vendor page.
- Notifications, SMS and email templates: owned by the docs-comms module (`workorder.created`, `sms.workorder.scheduled`).
- Legal holds: before deleting or exporting work order data, check `GET /legal-holds/check?resourceType=work_order&resourceId=`.
