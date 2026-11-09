# Documents and communications QA (Days 26-30)

Scope: document storage base (Day 26), media upload (Day 27), notification adapters (Day 28),
template registry (Day 29) and the Day 30 QA pass. Blueprint invariants under test (p21): signed URL
expiry, classification gates, template approval workflow. Environment: local Postgres 16, `STORAGE_DRIVER=local`,
`QUEUE_DRIVER=memory`, email/SMS adapters in sink/mock mode (no provider calls).

## How to run

```bash
pnpm --filter @bolar/api test                                   # document, media, template, notification suites
API_PORT=4103 WEB_PORT=3103 QUEUE_DRIVER=memory \
  pnpm exec playwright test --config tests/playwright.config.ts tests/e2e/documents.spec.ts tests/e2e/access.spec.ts
```

## Test matrix

| Area | Check | Where | Result |
| --- | --- | --- | --- |
| Upload/download | Create -> signed PUT -> finalize computes sha256/size from storage, scan verdict `clean`, `currentVersionId` promoted, `document.uploaded` published | `document.test.ts` "two-step upload" | pass |
| Upload/download | Inline (`contentBase64`) upload finalizes immediately; v2 switches the current version; empty payload is 400 | `document.test.ts` "inline upload" | pass |
| Upload/download | sha256 mismatch on finalize is 409 and audited as `document.finalize` outcome `error` | `document.test.ts` | pass |
| Link expiry | Signed GET returns the bytes with the stored MIME type; tampered `sig` 404; past `exp` 404; wrong method 404 | `document.test.ts`, `documents.spec.ts` | pass |
| Storage policy | Every key is `org/<tenantOrgId>/...`; a key outside the prefix is 404 even with a valid HMAC; empty PUT 400; malformed query 400 | `document.test.ts` "storage endpoint" | pass |
| Classification gate | Confidential detail/download are `review_required` for staff without clearance; `document:read_restricted` + `X-Access-Purpose` clears; restricted rows hidden from lists unless cleared; `sensitive.access` audit rows for allow and review_required | `document.test.ts` "classification gate" | pass |
| Relationship scoping | Tenant with `tenant_of` sees only lease documents; vendor without a relationship gets 404 and `access.denied`; tenant cannot upload (403) | `document.test.ts` "relationship scoping" | pass |
| Tenant isolation | Cross-org list/detail/delete are empty/404; cross-org owner id is a validation error | `document.test.ts`, `media.test.ts`, `template.test.ts`, `notification.test.ts` | pass |
| Legal hold | Delete blocked with 409 `legal_hold` by the document flag and by an active `LegalHold.scopeJson.documentIds`; new versions blocked too; soft delete sets `deletedAt` and hides the row | `document.test.ts` "delete is soft" | pass |
| Media upload | Inline PNG upload sets `uploaded`, `thumbnailKey` null, signed `downloadUrl`, `media.uploaded` event; signed PUT + finalize path for larger files | `media.test.ts` | pass |
| Media limits | Disallowed MIME 400, > 10 MB 400, missing size 400, unknown owner 400 | `media.test.ts` "size and type limits" | pass |
| Media access | Assigned vendor and requester tenant read/upload; unrelated vendor 404 + `access.denied` (`media:read`); uploader may delete own media only | `media.test.ts` "relationship gate" | pass |
| Notifications | Email: template rendered, status `queued`, job `{notificationId, channel, to, subject, body, tenantOrgId, requestId}` enqueued; DTO omits the address | `notification.test.ts` | pass |
| Notifications | Logs/audit exclude sensitive content: audit rows contain no address, body or variables; `safeLogFields` exposes ids only; pino redacts `recipientAddress` | `notification.test.ts`, `packages/api/src/logger.ts` | pass |
| Notifications | Idempotency key returns the same notification and enqueues nothing; cross-org reuse is `idempotency_conflict` | `notification.test.ts` | pass |
| Notifications | SMS resolves the tenant profile phone; no phone -> `suppressed` with `lastError=no_phone`, no job | `notification.test.ts` | pass |
| Notifications | In-app delivered immediately; recipient lists own with rendered body, marks read; others 404; senders list all | `notification.test.ts` | pass |
| Delivery retry | Retry re-renders, `attempts` +1, re-enqueues with jobId `<id>:<attempts>`; delivered/sent cannot be retried (409); audited | `notification.test.ts` | pass |
| Mailhog smoke | Queued job delivered through `SinkEmailAdapter` (the Mailhog SMTP adapter shares the interface); `EMAIL_DRIVER=mailhog` needs a running Mailhog, not available in this environment | `notification.test.ts` | pass (sink) |
| Template render | `{{var}}` interpolation, HTML escaping (email/notice), plain SMS, 400 listing every missing variable | `template.test.ts` "render engine" | pass |
| Template registry | Platform templates listed read-only and renderable; org override with the same key wins; platform template edit by org user 403 | `template.test.ts` | pass |
| Approval workflow | Low risk auto-approves on submit; high risk waits in `pending_approval`; author cannot approve (403); non-approver 403; approving a draft is 409 `invalid_transition`; new approval retires the previous version; reject path; resubmitting a rejected version 409 | `template.test.ts`, `documents.spec.ts` | pass |
| Audit | `document.create/version_create/finalize/download/delete`, `media.upload/finalize/download/delete`, `template.create/version_create/submit/approve/reject`, `notification.create/retry`, `access.denied`, `sensitive.access` rows asserted | all suites | pass |
| Web | Manager uploads through the drawer (progress, retry handle), downloads via signed link; tenant sees lease document + messages inbox; vendor denied on `/manager/documents`; lawyer approval reflected in `/manager/templates`; render preview | `documents.spec.ts` | pass |
| Accessibility | axe (wcag2a/aa) on `/manager/documents`: no serious/critical violations | `documents.spec.ts` @a11y | pass |

## Failures and gaps

| # | Finding | Severity | Owner | Status / mitigation |
| --- | --- | --- | --- | --- |
| 1 | Virus scanning is a placeholder: `NoopVirusScanner` marks every object `clean`. A real engine (ClamAV / managed scanner) must be wired behind `VirusScanner` before production; `infected` handling (409, status `failed`) is implemented but only exercised through the interface. | high | platform / integrator | Open. Interface + swap point `setVirusScanner()` in `packages/api/src/modules/storage/scanner.ts`. |
| 2 | Inline (`contentBase64`) uploads are capped at 1 MB because `app.ts` applies `express.json({ limit: '2mb' })` app-wide. Larger files must use the signed PUT URL (documents up to 25 MB, media up to 10 MB), which both web components do automatically. | low | docs-comms (documented), integrator if the JSON limit should rise | Mitigated. |
| 3 | Media thumbnails are not generated (`thumbnailKey` stays null; gallery shows typed placeholders and uses the signed URL for image previews). | medium | media worker (later wave) | Open. `media.uploaded` is published for a thumbnail worker to consume. |
| 4 | Mailhog SMTP smoke (`EMAIL_DRIVER=mailhog`) could not run: no Mailhog/Docker in this environment. Delivery is verified through `SinkEmailAdapter`; the SMTP adapter is untested end to end here. | low | integrator (CI with docker-compose `mailhog`) | Open. |
| 5 | Worker delivery status: `notificationsHandler` now records `sent`/`failed` on the Notification row and throws on failure so BullMQ retries (5 attempts, exponential). The worker itself was typechecked and linted but not executed against Redis in this slice. | medium | docs-comms / integrator | Open: run `pnpm dev:workers` against Redis in integration. |
| 6 | Tenant portal cannot open its own confidential lease without an approved sensitive-access request (the p14 gate applies to everyone). The UI shows the review-required state with the request form. Product may want an exemption for lease parties. | medium | product / compliance | Open design question; invariant kept strict on purpose. |
| 7 | Template approvers (lawyer, compliance officer) have no screen of their own; approval in the UI is available to roles that can enter `/manager` with `template:approve` (org admin). Lawyers approve via API/`/legal` once the legal portal wave adds a queue. | low | portals wave | Open. API grants read to `template:approve` holders so a queue can be built directly. |
| 8 | Retention: `Document.retentionPolicyId` is accepted but no retention job acts on it yet (governance wave, Day 47). | low | governance | Out of scope. |
| 9 | `media.finalize` on the S3 driver trusts `HeadObject` content type; with the local driver the type is whatever the PUT sent. Finalize rejects content types outside the allow-list unless they match the declared MIME type. | low | docs-comms | Mitigated. |

## Demo seed and wiring

- `packages/db/seed/modules/documents.ts` exports `seedDocumentsDemo(orgId)`: writes real bytes for the two seeded documents
  into the local storage root (same layout as `LocalStorageAdapter`) and creates two in-app notifications for the demo tenant. Idempotent.
- Worker reaction `packages/workers/src/handlers/reactions/notification.ts` is imported by `reactions/index.ts` and maps
  `invitation.created`, `work_order.created`, `invoice.issued`, `notice.approved`, `privacy_request.received`, `notification.requested`.
