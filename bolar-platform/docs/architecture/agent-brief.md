# Build agent brief (parallel domain slices)

You are one of several implementation agents building BOLAR domain modules in parallel. Each agent works in
its own git worktree and database. Follow this brief exactly; it exists so the slices merge cleanly.

## Environment facts
- PostgreSQL 16 runs locally at `localhost:5432` (user `bolar`, trust auth, no password). Redis at `localhost:6379`.
  There is no Docker daemon; do not run `docker compose`.
- Node 22, pnpm via corepack (`export COREPACK_ENABLE_DOWNLOAD_PROMPT=0`). Playwright + Chromium are preinstalled;
  never run `playwright install`.
- Outbound network is proxied; npm registry works. Do not call real provider APIs; all adapters run in `mock` mode.

## Bootstrap your worktree (run once, from the repo root of your worktree)
```bash
cd bolar-platform
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
PG_URL_BASE=postgresql://bolar@localhost:5432 scripts/dev-bootstrap.sh <YOUR_DB_NAME>
```
This writes `.env` with your DATABASE_URL, installs, builds shared packages, migrates and seeds demo data.
All tests and dev servers read `bolar-platform/.env`. Use your assigned `API_PORT`/`WEB_PORT` for e2e:
```bash
export API_PORT=<yours> WEB_PORT=<yours> QUEUE_DRIVER=memory
pnpm exec playwright test --config tests/playwright.config.ts --trace off tests/e2e/<your-spec>.spec.ts tests/e2e/access.spec.ts
```

## Read before coding
1. `docs/architecture/module-conventions.md` (the implementation contract) and `docs/architecture/overview.md`
2. `packages/api/src/shared/*.ts` (context, route registry, access, audit, events, queue, db)
3. Exemplar module: `packages/api/src/modules/iam/routes.ts`, tests in `packages/api/src/__tests__/iam.test.ts`
4. Fixtures: `packages/testing/src/fixtures.ts`; test helpers: `packages/api/src/__tests__/helpers.ts`
5. Your models in `packages/db/prisma/schema.prisma`; seed data in `packages/db/seed/demo-data.ts`
6. Web exemplar: `apps/web/components/iam/users-admin.tsx`, `apps/web/components/ui/*`, `apps/web/lib/hooks/iam.ts`, `apps/web/lib/nav.ts`
7. Provider adapters you may use: `packages/integrations/src/*` (storage, email, sms, payments, signature, screening)
8. Blueprint page excerpts for your days (quoted in your assignment)

## Ownership rules (prevent merge conflicts)
- Write only inside: your `packages/api/src/modules/<module>/` folders, your `packages/contracts/src/<module>.ts`
  files, your `packages/api/src/__tests__/<module>*.test.ts`, your `apps/web/lib/hooks/<module>.ts`, your web pages/
  components folders, your `tests/e2e/<module>.spec.ts`, `packages/db/seed/modules/<module>.ts`, and
  `packages/workers/src/handlers/reactions/<module>.ts`.
- Routers and contracts are already registered/exported (`modules/index.ts`, `contracts/src/index.ts`): do not edit
  those two files. Replace the stub `routes.ts` content in your module folder.
- Do not edit `schema.prisma` unless a field is truly missing. If you must: additive only, inside your models, then
  `pnpm --filter @bolar/db migrate:dev --name <module>_<change>` and run `pnpm --filter @bolar/db test`.
- Do not edit `packages/db/seed/demo-data.ts`. Put extra demo data in `packages/db/seed/modules/<module>.ts` exporting
  `export async function seed<Module>Demo(orgId: string): Promise<void>` (look up users/properties via prisma by
  email/name). The integrator wires it.
- Do not edit `apps/web/lib/nav.ts` unless adding an item under your own portal array; keep existing hrefs.
- Portal landing pages `app/(portals)/<portal>/page.tsx` belong to the portals wave unless your assignment says you own one.
- Worker reactions: add `packages/workers/src/handlers/reactions/<module>.ts` calling `onEvent(...)` from `../registry.js`
  and add exactly one import line to `reactions/index.ts`.
- Never commit `.env`, `.storage*`, screenshots with real data, or credentials. Synthetic data only.

## Cross-module contracts (agree on these shapes; do not wait for the other agent)
- Domain events (publish with `publish(ctx, name, payload)`): `property.created`, `unit.status_changed`,
  `tenant_profile.created`, `lease.transitioned {leaseId, from, to}`, `lease.signed`, `document.uploaded`,
  `media.uploaded`, `notification.requested {recipientUserId, channel, templateKey, variables}`,
  `work_order.created`, `work_order.transitioned {workOrderId, from, to}`, `work_order.sla_breached`,
  `invoice.issued`, `payment.succeeded`, `payment.failed`, `notice.approved`, `rule.evaluated`,
  `adverse_action.final`, `privacy_request.received`, `legal_hold.created`, `export.completed`.
- Media (owned by docs-comms): `GET /media?ownerType=&ownerId=&limit=` -> `{items:[{id,fileName,mimeType,sizeBytes,status,thumbnailKey,createdAt,downloadUrl}],nextCursor}`;
  `POST /media {ownerType, ownerId, fileName, mimeType, contentBase64}` -> MediaAsset dto (<= 10 MB);
  `GET /media/:id/download` -> `{url, expiresAt}`.
- Documents (owned by docs-comms): `GET /documents?ownerType=&ownerId=` -> page of `{id,title,classification,category,currentVersionId,createdAt}`;
  `GET /documents/:id/versions/:versionId/download` -> `{url, expiresAt}`.
- Rule evaluations (owned by compliance): `GET /rules/evaluations?resourceType=&resourceId=` -> page of
  `{id,ruleKey,ruleVersion,result,evidenceJson,createdAt}`; `POST /rules/evaluate {domain, resourceType, resourceId, facts, jurisdiction?}`.
- Legal hold check (owned by governance): `GET /legal-holds/check?resourceType=&resourceId=` -> `{held: boolean, holdIds: string[]}`.
  Other modules may also check `prisma.legalHold` directly via a tiny local helper if they must block deletion.
- Notifications (owned by docs-comms): other modules only `publish` events; the notification module maps events to templates.

## Definition of done for your slice
1. API routes with zod contracts, `tenantDb`, `requireAccess`/`requireSensitiveAccess`, `audit`, `publish`, cursor pagination.
2. Tests: happy path, tenant isolation (two orgs), denied path with `access.denied` audit row, state-machine
   invalid transition (if any), idempotency (if any). `pnpm --filter @bolar/api test` green.
3. Web: hooks + pages using `StateView` (loading/empty/error/denied/review-required), role gating via `useCan`,
   responsive, labelled form fields. `pnpm --filter @bolar/web typecheck` green.
4. Playwright spec `tests/e2e/<module>.spec.ts` with at least: one role journey, one denied check, one axe check
   on your main screen (`@smoke` and `@a11y` tags like `tests/e2e/access.spec.ts`). Must pass on your ports.
5. `pnpm openapi:generate` run and `packages/contracts/openapi.yaml` committed.
6. `pnpm lint && pnpm typecheck` green at the monorepo root.
7. Commit on your worktree branch (do not push) with a clear message ending with these two lines:
```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0193TZUPTz1oUhEg7xw7e7by
```
8. Final report (plain text): summary; files changed; commands run with pass/fail; tests added and what each proves;
   shared files touched (if any) and why; risks/blockers; what the integrator must wire (seed function name, reaction file).

Prefer a complete vertical slice over breadth. If a blueprint item cannot be finished, implement the contract and a
clear `501`-free TODO-free fallback (e.g. a documented "not available in MVP" state) and say so in the report.
