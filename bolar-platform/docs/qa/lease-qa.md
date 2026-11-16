# Lease and occupancy QA (blueprint Day 25)

Scope: tenant profiles (Day 21), lease draft model and overlap (Day 22), lifecycle state machine (Day 23), lease UI (Day 24) and the DocuSign e-sign boundary (Day 57). Everything below was exercised against a real PostgreSQL database with the mock signature provider; no real provider APIs were called and all data is synthetic.

## How to reproduce

```bash
cd bolar-platform
pnpm --filter @bolar/api exec vitest run src/__tests__/tenant-profile.test.ts src/__tests__/lease.test.ts src/__tests__/signature.test.ts
export API_PORT=4102 WEB_PORT=3102 QUEUE_DRIVER=memory
pnpm exec playwright test --config tests/playwright.config.ts --trace off tests/e2e/lease.spec.ts tests/e2e/access.spec.ts
```

## Permission matrix (verified by `lease.test.ts`, `tenant-profile.test.ts`, `signature.test.ts`, `lease.spec.ts`)

| Action | Property manager | Landlord | Org admin | Lawyer | Bookkeeper | Tenant (party) | Tenant (not a party) | Vendor | Other org |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| List tenant profiles | 200 (confidential/restricted redacted) | 200 (redacted) | 200 (full with `X-Access-Purpose`) | 200 (redacted) | 403 | 403 | 403 | 403 | own org only |
| Read tenant profile detail | 200, restricted fields nulled + `redactedFields` | 200 redacted | 200 full with purpose | 200 redacted | 404 | 200 full (own record) | 404 + `access.denied` | 404 | 404 |
| `GET /tenant-profiles/:id/sensitive` | 403 `review_required` until approved request | 403 `review_required` | 200 with purpose header | 403 `review_required` (can approve others' requests) | 404 | 200 (own) | 404 | 404 | 404 |
| Create / update tenant profile | 200/201 | 403 | 201 | 403 | 403 | 403 | 403 | 403 | n/a |
| List leases | all in scope | all in scope | all | all (read-only) | all (read-only) | only leases where party or `tenant_of` | — | 403 | own org only |
| Read lease detail | 200 | 200 | 200 | 200 | 200 | 200, `allowedNextStates: []` | 404 + `access.denied` | 403 (collection) / 404 | 404 |
| Create draft lease | 201 (property in scope) | 403 | 201 | 403 | 403 | 403 | 403 | 403 | 400 (unit unknown in tenant) |
| draft -> review | 200 | 403 | 200 | 403 | 403 | 403 | 404 | 403 | 404 |
| review -> approved | 403 | 200 (not creator) | 200 unless creator (403 "Approver cannot be the lease creator") | 403 | 403 | 403 | 404 | 403 | 404 |
| review -> draft (reject) | 200 with note | 200 with note (400 without) | 200 with note | 403 | 403 | 403 | 404 | 403 | 404 |
| approved -> sent | 200 (needs a version) | 403 | 200 | 403 | 403 | 403 | 404 | 403 | 404 |
| Create e-sign envelope | 201 | 403 | 201 | 403 | 403 | 403 | 404 | 403 | 404 |
| sent -> signed | 200 with `signedAt` or completed envelope; 409 otherwise | 403 | 200 | 403 | 403 | 403 | 404 | 403 | 404 |
| signed -> active | 200 (explicit `activate` when start > 30 days out) | 403 | 200 | 403 | 403 | 403 | 404 | 403 | 404 |
| active -> renewal, renewal -> active | 200 (new version required for renewal -> active) | 403 | 200 | 403 | 403 | 403 | 404 | 403 | 404 |
| active/renewal -> terminated | 403 | 200 with note (400 without) | 200 with note | 403 | 403 | 403 | 404 | 403 | 404 |
| draft/review/approved/sent -> canceled | 200 | 403 | 200 | 403 | 403 | 403 | 404 | 403 | 404 |
| Property-scoped manager (other property) | list empty; detail 404; `form-options` limited to own property | | | | | | | | |

Notes
- Denied resource reads answer 404 and write an `access.denied` audit row; collection-level denials answer 403 (coarse permission gate).
- A transition the actor may never reach (for example a tenant or lawyer asking for `canceled`) is refused with 403 before any state is revealed.
- Approver cannot be the requester (blueprint p300): enforced by the state machine guard, surfaced in the approvals queue as "you drafted this".

## Occupancy results

| Scenario | Result |
| --- | --- |
| Two drafts on the same unit and dates | Allowed (drafts do not occupy). |
| Draft on a unit with an approved/sent/signed/active/renewal lease over intersecting dates | 409 `conflict` on create and on PATCH of dates. |
| Adjacent, non-intersecting dates on the same unit | Allowed. |
| Approving a draft that now overlaps an occupying lease | 409 `conflict`; detail shows the overlap in `overlaps` and the workspace shows the blocked banner. |
| signed -> active | Unit status becomes `occupied`, `UnitStatusHistory` row written, `unit.status_changed` and `lease.transitioned` events published. |
| active -> terminated | Unit status becomes `notice` with history row. |
| Activation more than 30 days before start | Blocked until `activate: true` is sent (workspace asks for explicit confirmation). |
| Activation within 30 days of start | Allowed without the flag. |
| Terminated/canceled leases | Never occupy; a new lease can be drafted on the unit. |

## Lifecycle audit

Every transition writes `lease.transition` (before/after status, note, system flag) and publishes `lease.transitioned {leaseId, from, to}`; `lease.signed` is published on signing. Verified path in tests: `draft -> review -> approved -> sent -> signed -> active -> renewal -> active -> terminated` (8 audit rows, 6 `lease.transitioned` events for the last six steps, plus `lease.signed` and `unit.status_changed`). `GET /leases/:id/timeline` exposes these rows (plus version/party/charge/envelope events) to anyone who can read the lease.

## E-sign (Day 57)

- Envelope creation links `leaseVersionId` (new nullable column on `SignatureEnvelope`, migration `20261109062251_signature_lease_version`) and `documentVersionId` when the version references a document; the signed payload is a generated placeholder PDF because file bytes belong to the documents module.
- Webhooks are persisted once per `(provider, externalId)` where `externalId = envelopeId:event`; replays answer `duplicate`; late `delivered` events never regress a terminal envelope status; `envelope-completed` signs the lease exactly once (verified by counting `lease.transition` rows with `after.status = 'signed'`); `envelope-declined`/`envelope-voided` reopen a sent lease as draft with an audit note; voiding from the API does the same.
- Bad HMAC signatures are rejected with 400 before persistence.

## Test runs

| Command | Result |
| --- | --- |
| `pnpm --filter @bolar/api test` (tenant-profile 9, lease 8, signature 5, plus existing 29) | pass |
| `pnpm --filter @bolar/db test` (tenant client, after the additive migration) | pass |
| `pnpm --filter @bolar/web typecheck`, `pnpm lint`, `pnpm typecheck` | pass |
| `pnpm openapi:generate` (66 operations) + `redocly lint` | valid |
| Playwright `tests/e2e/lease.spec.ts` (5 `@smoke` journey steps + 2 `@a11y` axe checks) + `access.spec.ts` (9) on ports 4102/3102 | pass (16/16) |
| `seedTenancyDemo` run twice against the demo org | idempotent (1 review lease, 2 profiles, 2 parties after both runs) |

Issues found and fixed during QA: accessible names of wrapped `<select>` controls include the selected option text (locators use `getByRole('combobox', { name: /^Label/ })`); a loose `<div>` inside the terms `<dl>` failed axe `definition-list`; the shared `warning` badge tone (`#b9540d` on `#fde7d6`, 4.05:1) fails WCAG AA at 12px, so classification badges use the `violet` tone. The shared `Badge` warning tone itself is owned by the portals wave and is listed as a follow-up for them.

## Blockers and hand-offs before finance and documents

1. Documents module: `LeaseVersion.documentId` and `SignatureEnvelope.documentVersionId` are linked, but the lease module cannot read stored bytes; the envelope sends a generated placeholder PDF. When `GET /documents/:id/versions/:versionId/download` exists, the signature module should fetch the real file and store the completed, signed copy as a new document version on `envelope-completed`.
2. Finance module: `RecurringCharge` rows (rent auto-created from `rentCents`, account code `4000`) are the input for invoice generation; activation (`lease.transitioned` to `active`) is the event finance should react to for the first invoice and the deposit (`2100` liability). Proration for mid-month starts is not modelled here.
3. Compliance module: the workspace reads `GET /rules/evaluations?resourceType=lease&resourceId=` and shows an empty state until evaluations exist. No rule blocks a lease transition yet; once `rule.evaluated` with `result: block` exists, the `review -> approved` guard should consult it.
4. Notifications: `lease.transitioned` and `lease.signed` are published; templates for "lease sent", "lease signed" and "approval requested" belong to the notification module.
5. Seed: `seedTenancyDemo(orgId)` in `packages/db/seed/modules/tenancy.ts` must be wired after `seedDemo` by the integrator (adds the applicant profile and a `review` lease on Maple Court 102).
6. Audit in the manager portal: property managers do not hold `audit:read`, so the workspace timeline uses `GET /leases/:id/timeline` (lease-scoped audit rows) instead of `GET /audit`.
7. Renewal terms: `renewal -> active` requires at least a second version; the guard does not yet verify that the version was created after the renewal started.
8. Tenant self-service edits to contact methods are not exposed (tenants can read, not write, their profile) pending the tenant portal wave.
