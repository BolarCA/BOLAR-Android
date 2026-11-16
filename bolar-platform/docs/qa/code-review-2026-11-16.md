# Code review notes: bolar-platform (branch `claude/youthful-goodall-1i8j1f`, head `b3c71a8`)

Date: 2026-11-16. Scope: the full platform diff against `master` (608 files, 85,304 additions). Method: file-by-file read
of the kernel, auth, tenancy, access control, audit, finance, lease, IAM, webhooks, storage, AI, reporting and web client
code, then the complete verification pipeline run locally. Findings are ranked by severity; nothing has been changed yet.

## Test run (all green)

| Step | Command | Result |
| --- | --- | --- |
| Env | `pnpm env:check` | PASS |
| Lint | `pnpm lint` | PASS (14 tasks) |
| Schema | `pnpm prisma:validate` | PASS |
| Migrations | `pnpm db:migrate`, `pnpm db:migrate:test` | PASS (9 migrations) |
| Types | `pnpm typecheck` | PASS (14 tasks) |
| Unit / API | `pnpm test` | PASS: shared 1 file, integrations 2, db 2, workers 2, api 37 (44 files) |
| OpenAPI | `pnpm openapi:check` | PASS (269 operations, no drift) |
| Docs | `pnpm docs:lint` | PASS (74 files) |
| Build | `pnpm build` | PASS |
| E2E | `pnpm e2e` with `--retries 0`, cold production build | PASS: 101 passed, 1 skipped (mobile-only), 0 flaky, 3.2 min |

## Findings (26), most severe first

| # | Severity | Where | Note |
| --- | --- | --- | --- |
| 1 | High | `packages/api/src/modules/auth/routes.ts:20` | `/auth/mfa/setup` is `auth: 'session'`; a pre-MFA session can rotate an enrolled user's secret and verify with its own authenticator (MFA bypass). Require `mfa` when `mfaEnabled`, or password re-entry. |
| 2 | High | `auth/service.ts:96` | `mfaVerify` has no attempt counter; 600 req/min actor limit lets a 6-digit code be brute-forced in hours. Add per-session attempt lockout. |
| 3 | Medium | `auth/service.ts:46` | Failed attempts while locked re-extend `lockedUntil`; a trickle of bad passwords locks a real user out indefinitely. Do not count attempts while locked. |
| 4 | Medium | `packages/api/src/shared/queue.ts:33` | `QUEUE_DRIVER=memory` (the default) pushes jobs to an array nothing drains outside tests: events, notifications and scheduled jobs are dropped silently and memory grows. Run an in-process consumer in memory mode or refuse to start without Redis outside tests. |
| 5 | Medium | `packages/integrations/src/webhooks/index.ts:17` | Event row is written before the handler runs; a handler failure stores the error and every provider retry answers `duplicate`, so the event is lost. Record on success, or allow reprocessing when `error` is set. |
| 6 | Medium | `packages/api/src/shared/route.ts:68` | Idempotency record is written only after success, so concurrent duplicates both execute; key is per tenant, not per actor. Insert an in-flight row first (unique key) and include the actor in the key. |
| 7 | Medium | `finance/payment/service.ts:71` | `applyPaymentSuccess` check-then-act is not transactional; sync result and webhook can both allocate to the invoice. Wrap in a transaction with a conditional `updateMany({ where: { status: 'pending' } })`. |
| 8 | Medium | `iam/routes.ts:120` | Invitation accept upserts by email and overwrites an existing active user's password/name; no org-status check. Refuse unless the existing row is `invited`. |
| 9 | Medium | `auth/service.ts:64` | Refresh ignores org status and `lockedUntil`; "reuse revokes the session" is documented but not implemented. |
| 10 | Medium | `packages/db/src/tenant-client.ts:55` | RLS reads open a new `$transaction` on the base client, so reads inside a caller's transaction run on another connection and miss uncommitted writes. Reuse the caller's tx or set the setting on the same connection. |
| 11 | Medium | `tenant-client.ts:104` | Unlisted operations (`updateManyAndReturn` in Prisma 6.19) fall through unscoped. Scope it, and make the default branch throw for unknown write operations. |
| 12 | Low | `lease/service.ts:225` | Overlap and compliance guards race with the status update (no transaction, no exclusion constraint). |
| 13 | Low | `shared/totp.ts:188` | TOTP codes replayable within the window; `===` compare. Store last-used counter; use `timingSafeEqual`. |
| 14 | Low | `auth/service.ts:40` | Multi-org email answers 400 `orgSlug required` instead of the generic 401 (existence leak). |
| 15 | Low | `auth/service.ts:52` | scrypt only runs for known users (timing leak). Hash a dummy password on the unknown path. |
| 16 | Low | `finance/payment/service.ts:135` | Webhook lookup by `externalId` is cross-tenant and the mock provider derives it from the client idempotency key (collisions in mock/sandbox). |
| 17 | Low | `storage/routes.ts:91` | `application/json` uploads are parsed by `express.json` then re-serialized, changing the stored bytes. Skip JSON parsing for `/storage/object`. |
| 18 | Low | `apps/web/lib/api-client.ts:71` | Non-JSON error bodies throw `SyntaxError` instead of `ApiError`. Guard `JSON.parse`. |
| 19 | Low (reuse) | `privacy/routes.ts:29` | `checkIntakeRate` duplicates the middleware `public_ip` policy for the same path. |
| 20 | Low (simplify) | `finance/payment/service.ts:146` | Refund bookkeeping duplicated between `refundPayment` and the webhook path; extract one `applyRefund`. |
| 21 | Low (efficiency) | `shared/context.ts:75` | `support.cross_tenant_access` audit row on every request while acting as org. Audit once per session or per path per window. |
| 22 | Low | `packages/db/seed/index.ts:9` | Seeds have no production guard; demo password accounts could be created in prod. |
| 23 | Low | `apps/web/next.config.ts:2` | No security headers (CSP, frame-ancestors, Referrer-Policy) on the web app. |
| 24 | Low | `apps/web/lib/api-client.ts:29` | Refresh token in `localStorage`; prefer an httpOnly cookie. |
| 25 | Low (reuse) | `packages/shared/src/events.ts:35` | Event bus logs handler failures with `console.error`, bypassing pino and error reporting. |
| 26 | Low (simplify) | `packages/db/src/tenant-client.ts:88` | Model delegate lookup written three times; one helper. |

## File-by-file notes

### Kernel (`packages/api/src/shared`)
- `route.ts`: `defineRoute` registers every route for OpenAPI generation and the bounded-list startup assertion; `mount`
  validates params/query/body with zod, applies auth level and coarse permission, then idempotency. Clean. Gaps: #6.
  `toDto` strips `passwordHash`, `mfaSecret`, `refreshTokenHash`, `tokenHash` on every serialization (good default).
- `context.ts`: bearer token -> session row -> user row on every request (no cache, so revocation is immediate); roles and
  permissions cached per (user, org, session) with explicit invalidation. Cross-tenant via `X-Tenant-Org` requires a
  platform actor plus a live support session or `platform_admin`. Gap: #21.
- `tokens.ts`: HS256 JWT with issuer/audience, opaque refresh tokens hashed at rest. Fine.
- `totp.ts`: RFC 6238 implementation by hand; correct output. Gaps: #13.
- `access.ts`: scoped RBAC (`rolesCovering`) plus ReBAC edges with time windows; denial on a specific resource is 404 and
  audited. Sensitive gate requires an approved request or a `*_sensitive` permission plus declared purpose. Sound.
- `audit.ts`: awaited append-only write with before/after redaction; request fails if audit fails (deliberate).
- `rate-limit.ts`: sliding-window counter, Redis or memory, fail-open, loopback trusted outside production. Correct and
  well tested. Note: MFA verification is not covered by a dedicated policy (#2).
- `cache.ts`, `db.ts`, `queue.ts`: TTL cache with targeted invalidation; `tenantDb(ctx)` throws without tenant context.
  Queue gap: #4.

### Tenancy (`packages/db/src`)
- `tenant-client.ts`: Prisma extension that filters reads, stamps creates, and turns cross-tenant unique lookups,
  updates and deletes into 404. Models are discovered from the DMMF so new models are covered automatically. Gaps: #10,
  #11, #26. Nested `connect` writes are not checked (document this as a known limit).
- `rls.ts`: policy SQL generated from the schema and pinned by a test; `bolar_app` role, owner bypass. Good.
- Module scan: every handler either uses `tenantDb(ctx)` or adds `tenantOrgId` to the global client's `where`; no
  unscoped read of tenant data was found in iam, privacy, document, retention, maintenance, vendor, legal-hold, finance,
  compliance, template, packet-export or audit routes. Global rules/templates are intentionally org-nullable.

### Auth and IAM
- `auth/service.ts`: scrypt passwords, generic login error, lockout, MFA step-up at login, rotating refresh tokens.
  Gaps: #1, #2, #3, #9, #14, #15.
- `iam/routes.ts`: invitations hashed at rest, scope validation against tenant rows, approver cannot revoke own admin
  role, cache invalidation on every grant/revoke. Gap: #8.
- `platform/routes.ts`: support sessions are time-boxed, reason-required and end-able by the agent or a platform admin.

### Finance
- `ledger/service.ts`: balanced-entry assertion, idempotent posting with P2002 race handling, reversal-once rule, pending
  adjustments need a second approver, trial balance and double-entry proof. Solid.
- `payment/service.ts`: provider adapter boundary, payment events recorded idempotently, refund approver must differ
  from the recorder. Gaps: #7, #16, #20.
- `invoice/*`, `accounts/*`: not re-read in depth; covered by 270 API tests.

### Lease, compliance, screening
- `lease/service.ts`: visibility filter by role scope and relationships, party-only roles, guarded state machine with
  overlap and envelope guards, compliance evaluation on `review`, approval blocked on unresolved block hits. Gap: #12.
- `compliance/engine.ts`: declarative condition tree (`eq/neq/gt/.../matches_any`), no dynamic code evaluation. Good.
- `screening/routes.ts`: consent gates the provider call, raw reports restricted behind the sensitive-access gate,
  decisions human-only. Matches the blueprint.

### Integrations and storage
- `integrations/src/adapter.ts`: `verifyHmacSignature` uses `timingSafeEqual`; mode guard forbids production modes outside
  production. `payments/index.ts`: Stripe signature parsing is correct (`t`/`v1`, `${t}.${body}`).
- `integrations/webhooks/index.ts` and `api/.../integrations/webhooks.ts`: persist-once by (provider, externalId), raw
  body preserved for signatures. Gap: #5.
- `storage/*`: keys forced under `org/<tenantOrgId>/`, path traversal rejected, HMAC-signed local URLs with expiry, 404 on
  bad signatures. Gap: #17; `verify` compares with `===` (minor).
- `signature/routes.ts`: DocuSign webhook resolves the envelope by provider id, terminal states never regress, lease
  transition runs as a system actor. Good.

### AI assistant (`modules/ai`)
- `service.ts`: command redacted before storage, plan from provider limited to 3 tool calls, each tool re-runs the route's
  own access checks, outputs redacted, citations enforced, budget pre-checked and charged, full audit row per command.
- `tools.ts`: read-only tools plus two draft tools that go through the human approval queues; document text is passed
  as untrusted data. This is the strongest part of the codebase from a safety standpoint.

### Reporting
- `reporting/service.ts` and `access.ts`: raw SQL over materialized views uses `Prisma.sql` parameters; identifiers are
  compile-time constants; property scope uses `Prisma.join`. No injection path found.

### Web app (`apps/web`)
- `lib/api-client.ts`: access token in memory, single-flight refresh, act-as-org header. Gaps: #18, #24.
- `next.config.ts`: standalone output, dev overlay disabled for e2e. Gap: #23.
- No `dangerouslySetInnerHTML` anywhere; templates escape every variable except on the SMS channel.

### Tests and harness
- 44 unit/API test files, 13 Playwright specs, axe on every portal; e2e now runs against a production build with no
  retries locally. The two e2e flakes found earlier are closed (see `smoke-results.md` items 6 and 7).

## Suggested fix order
1. #1, #2, #3 (auth hardening, small changes, high value).
2. #4 (memory queue) and #5 (webhook retry), since both silently lose work.
3. #6, #7, #12 (concurrency around money and occupancy).
4. #8, #9, #10, #11 (tenancy and session edge cases).
5. The low items as a cleanup batch.
