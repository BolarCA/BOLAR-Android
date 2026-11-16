# Governance QA (Days 46-50: audit export, retention, privacy requests, legal holds, evidence packets, legal/gov API)

Scope: `modules/{retention,privacy,legal-hold,legal,packet-export}`, web `/legal/**`, `/gov/**`,
`/subaccount/{privacy-requests,retention}`, worker reactions `reactions/governance.ts`, seed `seedGovernanceDemo`.
Blueprint: schema p22, API p34 (Legal/gov), UI p47 (government restricted portal) and p52 (legal case workspace),
human approval map p300.

## Invariants every reviewer should re-check

| # | Invariant | Where enforced | Test |
| --- | --- | --- | --- |
| 1 | Approver is never the requester (holds release, privacy decision, agency decision, export approval, retention approval) | `legal-hold/routes.ts` release, `privacy/routes.ts` decide, `legal/routes.ts` decide, `packet-export/routes.ts` approve/deny, retention approve (proposer is system) | `legal-hold.test.ts`, `privacy.test.ts`, `legal.test.ts`, `packet-export.test.ts` |
| 2 | Every decision writes an audit row with `metadata.note` | all `audit(ctx, { ..., metadata: { note } })` calls | each test asserts the row and the note |
| 3 | Held records are never deleted or disposed; disposal under hold is `409 legal_hold` | `retention/service.ts` `disposeAssignment`, sweep marks `held`; privacy fulfil skips held profiles/documents | `retention.test.ts`, `privacy.test.ts` |
| 4 | Holds resolve parents: a document owned by a held lease/property/case/tenant profile is held; a lease on a held property is held | `legal-hold/service.ts` `resolveHoldTargets` | `legal-hold.test.ts` |
| 5 | Sweep proposes only; nothing is deleted without a human approval and an explicit dispose action | `sweepRetention` | `retention.test.ts` (idempotent second sweep scans 0) |
| 6 | Privileged cases are 404 (not 403) for anyone without lead/creator/`represents`/case-scoped role, with an `access.denied` audit row | `legal/routes.ts` `loadCase`, list filter `visibleCaseFilter` | `legal.test.ts` |
| 7 | Law-enforcement requests require a `legalReference` and counsel approval; approval only opens a *gated* export job | `createAgencyRequest` refine, `decideAgencyRequest` | `legal.test.ts` |
| 8 | Export manifests contain only the owning tenant's documents and audit events (two-tenant fixture) and apply redaction fields recursively | `packet-export/service.ts` (`forTenant` only, `applyRedaction`) | `packet-export.test.ts` |
| 9 | Manifest sha256 equals the sha256 of the stored object; `GET /audit/export` sha256 equals sha256 of its rows | `runExportJob`, `buildAuditManifest` | `packet-export.test.ts` |
| 10 | Audit log is never deleted by privacy fulfilment or retention (append-only trigger) | privacy fulfil keeps audit; retention has no audit disposition path | `privacy.test.ts` counts audit rows after fulfilment |
| 11 | Public intake is rate limited and never leaks whether an org exists beyond slug lookup | `checkIntakeRate` (5 / 15 min / IP) | `privacy.test.ts` |
| 12 | Government users see only their own requests and exports | `isCounsel()` filter, `ownFilter()` | `legal.test.ts`, `packet-export.test.ts` |

## Manual QA script (demo org, after `pnpm db:seed && pnpm db:seed:demo` and `seedGovernanceDemo`)

Users: `legal@demo.bolar.test` (lawyer), `orgadmin@demo.bolar.test`, `gov@demo.bolar.test`, `compliance@demo.bolar.test`,
`manager@demo.bolar.test`, `tenant@demo.bolar.test`. Password `Bolar!Demo2026`.

1. Legal workspace (`/legal`, lawyer): seeded case "Maple Court 101 - non-payment (demo)" shows status `open`,
   deadline chip for "Serve notice to cure or quit", flags `privileged` and `legal hold`. KPIs populate.
2. Case detail: banner "Privileged and confidential"; related lease/property/tenant links; deadlines; "Mark done"
   updates the chip; status select only offers legal transitions; closed cases offer none.
3. Legal hold from case: "Place legal hold" is hidden when a hold is active; on a new case it creates a hold scoped to
   case + lease + property + tenant profile; `/legal/legal-holds` lists it; the creator sees "needs other counsel";
   org admin can release with a note; the released hold disappears from the active filter.
4. Evidence packet: lawyer requests export (status `requested`, "Awaiting a different approver"); org admin approves
   via `/legal/cases/[id]` (or API) with a note; manifest card shows files/audit/subjects counts, sha256 and
   "Download manifest" (local storage signed URL; the `/storage/object` route belongs to the docs slice).
5. Privacy queue (`/legal/privacy-requests` and `/subaccount/privacy-requests`): seeded access request in `discovery`.
   POST intake from the public form (or `curl -X POST /privacy-requests/intake`) -> row with `identity verification`
   and SLA chip; drawer shows "Discovery unlocks once the subject completes identity verification". After `verify`,
   manager runs discovery and exception review; lawyer records the decision with a note; manager fulfils; the
   confirmation draft renders from the `privacy.confirmation` template; close.
6. Retention (`/subaccount/retention`, org admin or compliance): platform defaults are badged; "New policy" with
   key `documents.general` creates an org override that shadows the default; "Run sweep" proposes due records; the
   proposed queue offers Approve (lawyer/compliance) then Dispose (retention:write); held records show `held`.
7. Government portal (`/gov`): "Stored-data gate" notice; seeded request in `legal review`; new request form requires
   a legal reference for `law enforcement`; `/gov/exports` lists exports with manifest and download once complete.
8. Denied states: tenant on `/legal` and `/gov` -> denied view and no governance API calls; government user on
   `/legal` -> denied; manager on a privileged case URL -> denied (404 rendered as "You don't have access").

## Automated coverage

- API (`pnpm --filter @bolar/api test`): `legal-hold.test.ts` (6), `retention.test.ts` (7), `privacy.test.ts` (10),
  `legal.test.ts` (8), `packet-export.test.ts` (5). Each file covers happy path, two-tenant isolation, denied path
  (403 collection / 404 resource with `access.denied` row where a resource is involved), invalid transitions (409
  `invalid_transition`), legal-hold blocks (409 `legal_hold`) and idempotency (sweep, export job re-run, assignment upsert).
- E2E (`tests/e2e/governance.spec.ts`, tags `@smoke` / `@a11y`): lawyer case + hold journey, government request ->
  counsel review -> approval, export request -> approval by a different actor -> manifest visible, public privacy
  intake visible in the queue, tenant/government denied on restricted portals, axe on `/legal` and `/gov`.

## Known limits (MVP)

- Lease/document/tenant pickers are id inputs because the lease, document and tenant-profile APIs land in other
  slices; the case form explains the optional ids. Related-record links point at the manager portal routes.
- In `QUEUE_DRIVER=memory` the export job runs inline on approval so dev/e2e complete without Redis; with Redis the
  `exports` queue is consumed by `exportsJobHandler` once the integrator wires it into `handlers/index.ts`.
- Identity verification uses the ID.me mock; the callback endpoint accepts the mock `externalId`. Production needs
  the OAuth callback wired to `POST /privacy-requests/:id/verify`.
- Download of the manifest uses the storage adapter signed URL; serving `/storage/object` is owned by the docs slice.
