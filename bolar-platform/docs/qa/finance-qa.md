# Finance reconciliation QA (blueprint Day 40)

Scope: chart of accounts (Day 36), ledger posting engine (Day 37), invoices and rent schedules (Day 38), payment adapter
stubs (Day 39). All adapters run in `mock` mode; no real provider was called. Synthetic data only.

## How to reproduce

```bash
cd bolar-platform
pnpm --filter @bolar/api exec vitest run finance          # 18 API tests (ledger, invoices, payments)
export API_PORT=4105 WEB_PORT=3105 QUEUE_DRIVER=memory
pnpm exec playwright test --config tests/playwright.config.ts --trace off tests/e2e/finance.spec.ts
```

The API tests truncate the configured database (`twoTenantFixture`); re-run `pnpm db:seed && pnpm db:seed:demo` before
using the dev servers again. The demo ledger is balanced only once the integrator wires `seedFinanceDemo(org.id)`
(`packages/db/seed/modules/finance.ts`) after `seedDemo()`.

## Fixtures run

| Fixture | Where | Result | What it proves |
| --- | --- | --- | --- |
| Balanced journal | `finance-ledger.test.ts` "posts a balanced opening balance" | pass | sum(debit) == sum(credit) > 0 enforced; unbalanced, two-sided and unknown-account lines are 400; trial balance and `/ledger/proof` report balanced with 0 unbalanced entries |
| Idempotent posting | same test | pass | same `idempotencyKey` returns the existing entry; exactly one `JournalEntry` row |
| Immutable posted entries | "posted entries are immutable" | pass | DB triggers reject UPDATE/DELETE on posted `JournalEntry`/`LedgerEntry`; `guardImmutable` maps the violation to 409 `conflict` |
| Reversal | "reversal mirrors the entry once" | pass | mirrored entry with `reversalOfId`; second reversal and reversing a reversal are 409; trial balance returns to zero and stays balanced |
| Approval gate | "adjustments wait for a different approver" | pass | adjustment created pending (`postedAt` null, excluded from trial balance); bookkeeper without `finance:approve_adjustment` is 403; requester cannot approve own (409); admin approval posts it and is audited |
| Invoice generation | `finance-invoices.test.ts` "generates one issued invoice per active lease" | pass | one issued invoice per active lease with monthly charges; AR 1100 debit / 4000 credit posted; `invoice.issued` published; re-run creates 0 and skips; terminated lease excluded; lease without charges skipped; period after lease end creates nothing |
| Lease dependency / isolation | "generation is tenant-isolated" | pass | org B generation touches only org B leases; `INV-<seq>` numbering is per org; cross-tenant detail is 404 |
| Manual invoice lifecycle | "manual invoice: draft -> issue -> void" | pass | draft has no journal; issue posts; re-issue is 409 `invalid_transition`; mark-overdue flips past-due open invoices; aging buckets 1-30/31-60 correct; void reverses the issue entry and proof stays balanced |
| Duplicate webhook | `finance-payments.test.ts` "pending payment converges through the webhook" | pass | pending (ACH) payment -> signed `payment_intent.succeeded` processed once; identical redelivery is `duplicate`; re-sent event with a new id is `ignored`; exactly one journal entry; bad signature 400; unknown intent ignored; late `payment_failed` ignored |
| Failed payment | "failed payment is recorded" | pass | mock decline (`amount % 100 == 99`) -> `failed` + `card_declined`; invoice untouched; no journal; `payment.failed` published; listed in exceptions |
| Partial payment | "requires an Idempotency-Key and replays" | pass | 50% payment -> `partially_paid`, `paidCents` updated, Cash 1000 debit / AR 1100 credit once; `Idempotency-Key` required (400 without); replay returns the same payment with `Idempotent-Replayed`; changed payload 409; over-payment 400 |
| Refund | "refund is approval-gated" | pass | bookkeeper 403; recorder cannot approve own refund (409); approver refunds, reversal entry posted (`reversal:<entryId>`), invoice reopened to `partially_paid`, payment `refunded`, `charge.refunded` event stored; second refund 409 |
| Ledger after full run | same test | pass | proof balanced, Cash 1,000.00 / AR 500.00 as expected; `/finance/summary` KPIs match (open AR, collected this month, failed payments) |
| Bank link | "bank links require bank:read" | pass | tenant 403; bookkeeper gets a mock link token; exchange returns `accessTokenRef` + mask only, `persisted: false`, never a raw token; both calls audited |
| Seed | `seedFinanceDemo` run twice against `bolar_agent5` | pass | 3 entries posted on first run, 0 on second; debits 435,000 == credits 435,000; one failed mock payment event |
| E2E | `tests/e2e/finance.spec.ts` (`@smoke`, `@a11y`) on ports 4105/3105 | pass (6/6, twice) | bookkeeper generates invoices and sees created count, re-run skips; tenant pays in `/tenant/pay` and sees `succeeded`; proof card green and trial balance balanced; vendor denied on `/finance` with no finance requests; axe clean on `/finance` and `/tenant/pay` |

## Role matrix (verified by tests unless marked)

| Capability | bookkeeper | org_admin | property_manager | landlord | tenant | vendor |
| --- | --- | --- | --- | --- | --- | --- |
| Chart of accounts read/write, seed-default | yes | yes | read only (`finance:read`, staff role) | denied 403 + audit | denied 403 + audit | 403 |
| Journal list, trial balance, proof, account entries | yes | yes | yes | denied 403 + audit | denied 403 + audit (tested) | 403 |
| Post manual entry (`finance:post`) | yes | yes | no (403) | no | no | no |
| Approve adjustment / refund (`finance:approve_adjustment`) | no (403, tested) | yes, not own (409, tested) | no | no | no (tested) | no |
| Invoices list/detail | org | org | org | own properties (`owner_of`, tested) | own leases (`tenant_of` / TenantProfile.userId, tested) | 403 (tested) |
| Generate / issue / void / mark-overdue (`finance:write`) | yes | yes | no | no | no (tested) | no |
| Aging report | yes | yes | yes | no | no (tested) | no |
| Collect payment | staff path | staff path | no (`finance:write` missing) | no | own invoices only (`payment:collect`, tested; stranger 404 + audit) | no |
| Payments list/detail | org | org | org | own properties, `externalId` redacted (tested) | own leases, `externalId` + event ids redacted (tested) | no |
| Bank link token / exchange (`bank:read`) | yes (tested) | yes | no | no | no (tested) | no |

Bank-data rule: `Payment.externalId`, `PaymentEvent.externalEventId` and event payloads are returned only to actors holding
`bank:read`. Nothing stores card or bank account numbers; `paymentMethodRef` is passed to the adapter and audited as
`[redacted]`.

## Known gaps in this phase

- `BankLink` has no model; `/bank-links/exchange` returns the provider result without persisting (documented in the response
  `note`). Persistence lands with the Plaid sandbox phase behind a vaulted reference.
- Overdue is a scan (`POST /invoices/mark-overdue`) plus a computed `overdue=true` filter; no scheduler job yet (workers can
  call the same service nightly).
- Refund approver identity is derived from the `payment.create` audit row (Payment has no `createdBy` column).
- Partial refunds post a partial mirrored entry (`sourceType: reversal`, `reversalOfId` set) rather than a full reversal.
- The finance worker reaction only logs; notifications for `invoice.issued` / `payment.*` are owned by docs-comms.
- Shared `Badge tone="warning"` (orange-100 on orange-700) fails WCAG AA contrast under axe; finance screens map `warning` to
  `danger` via `financeTone`. The UI owner should fix the palette so other portals do not hit the same violation.

## Blockers before enabling real payments (STRIPE_MODE / PLAID_MODE = sandbox or production)

1. **PCI scope**: never let card numbers touch BOLAR servers. Replace the mock card form with provider-hosted fields
   (Stripe Elements / Payment Element) so only a `payment_method` token reaches `POST /payments`. Confirm SAQ-A posture.
2. **Stripe sandbox keys**: `STRIPE_SECRET_KEY` (must be `sk_test_` in sandbox), `STRIPE_WEBHOOK_SECRET`; register the
   webhook endpoint `/webhooks/stripe` with `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`
   (and `charge.dispute.*` once disputes are modelled). Verify the `t=,v1=` signature path against a real event.
3. **Bank token vaulting**: add a `BankLink` model storing only `accessTokenRef`, mask and institution; keep the Plaid access
   token in the secret manager keyed by that ref; restrict reads to `bank:read` with sensitive-access audit.
4. **Customer and payment-method mapping**: persist provider customer ids per TenantProfile and saved payment methods
   (reference only) so retries and autopay reuse them; today `customerRef` is the tenant profile id.
5. **Dispute / chargeback flow**: `disputed` status exists on Payment but no handler; add `charge.dispute.created` mapping,
   a hold on the invoice and a bookkeeper exception.
6. **Reconciliation job**: nightly compare provider balance transactions with `Payment` rows and the Cash account; surface
   mismatches on the exceptions card. Add the overdue scan to the same schedule.
7. **Money movement limits**: per-tenant daily limits, duplicate-payment heuristics (same invoice + amount within minutes)
   and a kill switch feature flag (`payments.live`) checked by `createPayment`.
8. **Trust accounting**: deposits currently flow through the general chart (1200/2100); confirm state trust-account rules
   and separate bank accounts before taking deposits electronically.
9. **Approval evidence**: refund and adjustment approvals are audited; export them in the monthly close packet and require
   MFA (`auth: 'mfa'`) on approvers in production (already declared on the routes).
10. **Webhook retries and ordering**: provider retries are deduplicated by `(provider, externalId)`; add a reconciliation
    for events that arrive before the synchronous `Payment` row exists (currently `ignored` and logged).

## Definition of done checklist (finance slice)

- [x] API routes with zod contracts, `tenantDb`, `requireAccess`/scoped checks, `audit`, `publish`, cursor pagination
- [x] Tests: happy path, tenant isolation, denied path with `access.denied` audit row, invalid transition, idempotency (18 tests)
- [x] Web: hooks + pages with `StateView`, `useCan` gating, labelled fields, responsive grids
- [x] Playwright `tests/e2e/finance.spec.ts`: role journeys, denied route, axe (`@smoke`, `@a11y`)
- [x] `pnpm openapi:generate` run; `packages/contracts/openapi.yaml` committed (65 operations)
- [x] `pnpm lint && pnpm typecheck` green at the root
- [x] Seed `seedFinanceDemo(orgId)` and worker reaction `reactions/finance.ts` delivered for the integrator
