# Compliance slice QA (blueprint Days 41-45, 58)

Scope: rule catalog and deterministic evaluator, jurisdiction resolver, screening consent and adverse action workflow,
fair-housing / source-of-income guard, compliance review queue and remediation, notices with human approval.

Everything here is synthetic. Rule texts are engineering interpretations of public sources and **must be reviewed by
counsel before activation in any production tenant** (see "Counsel review items").

## How the pieces fit

| Concern | Implementation | Human gate (p300) |
| --- | --- | --- |
| Rule catalog | `ComplianceRule` (platform-global, `key@version`), `GET/POST /rules`, `/rules/:id/new-version`, `/activate`, `/retire` | `compliance:approve`; the author of a version cannot activate it (author resolved from the append-only audit log) |
| Evaluator | `modules/compliance/engine.ts` – pure, deterministic; result = block > review > warn > allow; evidence = conditions matched, facts used, matched terms, source URL | none (flags only) |
| Jurisdiction | `jurisdiction.ts` – chain `US → US-ST → US-ST-COUNTY → US-ST-CITY`, per-property `JurisdictionOverride`, effective-date window, highest version per key | overrides need `compliance:approve`, audited |
| Queue | `RuleEvaluation` rows (one per hit), `GET /rules/evaluations`, `POST /rules/evaluations/:id/resolve` (accepted / remediated / dismissed / overridden) | `overridden` needs `compliance:approve` + written note; every resolution audited with `policyVersion` |
| Guard | `fair-housing.ts` evaluates `us.fair_housing.protected_class_language` and `us.soi.voucher_refusal` against `{ text }`; `POST /compliance/screen-text`; runs on every notice draft | review routing only |
| Screening | `modules/screening` – consent recorded on the order, `POST /applications/:id/screening-orders` is blocked (409) by `us.fcra.consent_before_screening`, mock provider via `createScreeningProvider()`, report stored restricted at `org/<org>/screening/<orderId>.pdf` | `GET /screening-orders/:id/result` goes through `requireSensitiveAccess` (`screening:read_report` + purpose, or an approved request) |
| Decision | `POST /applications/:id/decide` (`adverse_action:manage`, reason codes from a fixed vocabulary) | human only; there is no AI code path into decide/advance |
| Adverse action | pre_adverse → waiting (pre-adverse notice must be **sent**) → final (only when `now >= waitingPeriodEndsAt`, else 409 by `us.fcra.adverse_action_waiting_period`); dispute pauses; withdraw returns the application to review | `adverse_action:manage`; final publishes `adverse_action.final` |
| Notices | `modules/notice` – template registry (tenant → platform → built-in default), `{{var}}` interpolation, guard + `domain=notice` rules on draft, submit blocked while a block hit is unresolved | `notice:approve`, approver ≠ author; `notice.approved` event; send publishes `notification.requested` |

## Fixture matrix (all automated)

| Domain | Fixture | Expected | Where |
| --- | --- | --- | --- |
| screening | consent missing | `block` by `us.fcra.consent_before_screening`, queue item, 409 on order | `compliance.test.ts` (engine), `screening.test.ts` |
| screening | consent recorded | `allow`, order moves to `ordered`, application to `screening` | `screening.test.ts` |
| screening | final adverse 2 business days after pre-adverse | `block` by `us.fcra.adverse_action_waiting_period` | engine + `screening.test.ts` |
| screening | final adverse after 5 business days (time travel) | `final`, final notice draft, `adverse_action.final` event | `screening.test.ts` |
| deposit | CA property, deposit 2× rent | `block` by `us-ca.deposit.max_one_month`, due in 7 days | engine + `compliance.test.ts` |
| deposit | TX property, same facts | `allow` (CA rule not in chain) | `compliance.test.ts` |
| deposit | TX move-out 45 days, deposit not returned | `warn` by `us-tx.deposit.return_30_days` | engine |
| rent | CA late fee 7.5% | `warn` by `us-ca.late_fee.reasonable`; 5% allows | engine |
| notice | entry lead 12h, not emergency | `block` by `us.notice.entry_24h`; submit blocked until queue item resolved | engine + `notice.test.ts` |
| notice | entry lead 12h, emergency | `allow` | engine |
| fair housing | "adults only", "no children" | `review`, matched terms listed | engine + `compliance.test.ts` |
| fair housing | "Caucasian oak floors, blackout curtains" | no hit (word boundaries) | engine |
| soi | "No Section 8" in a notice body | `review`, guard hits returned on create, queue item with evidence | `notice.test.ts`, e2e |
| jurisdiction | city override `US-CA-WEST_HOLLYWOOD` on an LA property | chain `US, US-CA, US-CA-WEST_HOLLYWOOD` | unit + API |
| jurisdiction | stale version (v1 expired, v2 active, v3 retired) | only v2 selected; v1 selected for a past `asOf`; nothing before AB 12 effective date | unit |
| catalog | author activates own draft | 403; another approver succeeds and retires the previous active version | `compliance.test.ts` |
| queue | manager overrides | 403 + `access.denied` audit; officer override without note 400 | `compliance.test.ts` |
| isolation | org B lists/reads/resolves org A data | empty / 404 | all three test files |

Run: `pnpm --filter @bolar/api test` (compliance, screening, notice suites) and
`API_PORT=4106 WEB_PORT=3106 QUEUE_DRIVER=memory pnpm exec playwright test --config tests/playwright.config.ts tests/e2e/compliance.spec.ts`.

## Manual QA checklist (UI)

- `/compliance`: filters (severity/domain/result/status) narrow the table; Evidence drawer shows conditions, facts, terms and source link; Accept/Remediated/Dismiss open the note modal; Override is visible only with `compliance:approve` and requires a 10+ character note; Export manifest downloads the current filtered list as JSON.
- `/compliance/rules`: grouped by jurisdiction then domain; Activate appears only on drafts; "New version" opens the editor; "Evaluate preview" is a dry run (nothing persisted) and includes the unsaved candidate rule.
- `/compliance/notices`: pending approvals with guard evidence; Approve/Reject gated; approving your own draft fails with a clear message.
- `/manager/applications`: Order screening before consent shows the blocked message with the rule key; report panel shows the review-required state for managers (request access form pre-filled with `screening_result`); decision modal requires reason codes for denial/conditional; adverse action timeline shows the waiting period and advance/dispute/withdraw.
- `/manager/notices`: guard hits appear immediately after saving a draft; block-level hits stop submission.

## Counsel review items (before production activation)

1. **AB 12 deposit cap** – exemption for small landlords (≤ 2 properties / ≤ 4 units, natural persons) is not modelled; the rule blocks all CA leases with deposit > 1 month. Override with documented exemption is the current path.
2. **Adverse action waiting period** – 5 business days is an industry convention, not a statutory number; confirm per jurisdiction (e.g. NYC, Seattle have specific screening rules). Business days are computed in UTC Mon–Fri without holidays.
3. **Protected-class term list** – the term list is a starting point and includes terms with legitimate uses ("wheelchair" in accessibility descriptions). Hits are review-only; tune terms per counsel guidance and add regex entries (`/.../`) where phrases matter.
4. **SOI** – voucher refusal is lawful in some states; the guard flags for review everywhere and never blocks. A jurisdiction-specific `block` version can be created via new-version + activate.
5. **Entry notice** – 24h is the common floor; several states require 48h or "reasonable" notice. Add state versions (`US-WA`, `US-CA`) as needed.
6. **Final adverse action content** – template `notice.final_adverse` includes provider contact and the "provider did not make this decision" statement; counsel to confirm the summary-of-rights enclosure process.
7. **Late fee reasonableness (CA)** – 5% is a heuristic; counsel to confirm or replace with a local ordinance-based rule.

## Open questions on jurisdictions

- County vs city collisions: the chain uses upper-cased, underscore-normalised names (`US-CA-LOS_ANGELES` is both county and city). Rules that must target only the city should use the override mechanism or a disambiguated code (e.g. `US-CA-LOS_ANGELES_CITY`) agreed with the integrator.
- Unincorporated areas and ETJs: no automatic detection; use `JurisdictionOverride` with a reason.
- Effective dates are evaluated against `asOf` = now; backdated evaluations are supported via `asOf` on `POST /rules/evaluate` but the UI does not expose it yet.
- Platform rules are global; tenant-specific policies (stricter internal rules) are not modelled. If needed, add an optional `tenantOrgId` to `ComplianceRule` (additive) and include tenant rules in `loadRulesForChain`.

## Known limits in this MVP

- Rules carry no `createdBy` column; the author is resolved from the audit log (`compliance.rule.create` / `compliance.rule.new_version`). If the audit row is missing the activation gate is skipped.
- Signed report links use the local storage driver; the `/storage/object` route belongs to the storage slice, so downloads work once that module lands.
- `GET /applications/lookups` is a temporary helper for the create forms until the property and tenant-profile modules expose their lists.
- Lease rent/deposit evaluation is triggered by the lease module calling `POST /rules/evaluate` (or `evaluateAndPersist`) when a lease enters review/approved; the worker reaction only logs.
