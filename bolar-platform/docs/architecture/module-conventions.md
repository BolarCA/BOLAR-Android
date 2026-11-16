# Module conventions (read before adding any feature)

This is the implementation contract every domain slice follows. It mirrors the blueprint's
hard constraints: modular monolith, tenant isolation, RBAC/ReBAC, sensitive-access gate, audit,
typed contracts, OpenAPI, required UI states, synthetic data only.

## Where things live

| Concern | Location |
| --- | --- |
| Domain module (API) | `packages/api/src/modules/<module>/{routes.ts,service.ts,state-machine.ts,...}` |
| Request/response schemas | `packages/contracts/src/<module>.ts` (exported from `src/index.ts`) |
| Database models | `packages/db/prisma/schema.prisma` (+ `migrations/`) |
| Shared kernel | `packages/shared/src` (errors, classification, rbac, relationships, pagination, state machine) |
| API kernel | `packages/api/src/shared` (context, route registry, access, audit, events, queue, db) |
| External providers | `packages/integrations/src/<provider>` (mock / sandbox / production modes) |
| Background jobs | `packages/workers/src/handlers` |
| Web screens | `apps/web/app/(portals)/<portal>/...`, hooks in `apps/web/lib/hooks/<module>.ts` |
| Tests | `packages/api/src/__tests__/<module>.test.ts`, `tests/e2e/<module>.spec.ts` |

## Adding an endpoint

1. Define zod schemas in `packages/contracts/src/<module>.ts` (`.openapi('Name')` on objects).
2. In `routes.ts` use `defineRoute({ method, path, operationId, summary, tags, auth, permission, idempotent?, request, responses, handler })`.
   - `auth`: `'public' | 'session' | 'mfa'`. Mutations of money, legal, compliance, access use `'mfa'`.
   - `permission`: coarse gate from `PERMISSIONS`. Fine-grained checks happen inside the handler.
3. Inside the handler:
   - Use `tenantDb(ctx)` for every query. Never use the root `prisma` for tenant-scoped tables except in
     carefully justified cross-tenant platform code.
   - Call `requireAccess(ctx, permission, { type, id, propertyId }, [relations])` for a specific resource
     (denied -> 404, never leaks existence) and `requireSensitiveAccess(ctx, { resourceType, resourceId, classification }, '<x>:read_sensitive')`
     before returning confidential/restricted fields. Redact with `redactFields` when listing.
   - `audit(ctx, { action: '<module>.<verb>', resourceType, resourceId, before, after })` on create/update/delete/transition/review.
   - `publish(ctx, '<module>.<event>', payload)` for side effects handled by workers.
   - Lists: `paginationQuery`, `decodeCursor`, `take: limit + 1`, `toPage(rows, limit)`. No unbounded lists.
   - Throw `errors.*` from `@bolar/shared`; never `res.status(...)` directly.
4. Register the router in `packages/api/src/modules/index.ts` (the stub already exists for every planned module).
5. Run `pnpm openapi:generate` and commit `packages/contracts/openapi.yaml`.

## State machines

Use `StateMachine` from `@bolar/shared`. Each transition declares `from`, `to`, `allowed(roles)` and optional
`guard(ctx)` for required artifacts. Every transition writes an audit event and publishes a domain event.

## Human approval gates (blueprint p300)

Legal, financial, compliance, screening, deletion and law-enforcement outputs are *drafts* until a human with
the approving permission acts (`lease:approve`, `notice:approve`, `finance:approve_adjustment`,
`privacy_request:approve`, `legal_hold:release`, `export:approve`, `adverse_action:manage`). Approver cannot be
the requester. AI assists only (summaries, drafts, flags) and never decides.

## Tests (required per module)

- Unit/API tests with a real Postgres via fixtures in `@bolar/testing` (`twoTenantFixture`, `createUser`, `relate`).
- Tenant isolation: list/detail/update/delete across two orgs returns only own data; cross-tenant is 404.
- Denied path: a role without permission gets 403 (collection) or 404 (resource), and an `access.denied` audit row exists.
- Audit: every mutation has an audit row.
- State machine: illegal transitions are 409 `invalid_transition`.
- Idempotency for payments/webhooks/notifications/imports.

## Web screens

- Client components with React Query hooks in `apps/web/lib/hooks/<module>.ts` using `api()`.
- Wrap data in `<StateView>` so loading / empty / error / denied / review-required are always rendered.
- Use `components/ui` primitives (Button, Input, Select, Card, Badge, Table, Drawer, Modal, KpiCard, PageHeader, Alert).
- Gate actions with `useCan('<permission>')`; never hide-only, the API enforces.
- Add a Playwright spec with: role journey, denied route, and an axe check for the main screen.
- Synthetic data only. Never real PII in fixtures, screenshots or seeds.

## Checklist before opening a PR

```
pnpm lint && pnpm typecheck && pnpm test && pnpm openapi:check && pnpm e2e:smoke
```
Attach migration status + rollback note (schema), screenshots/trace (UI), contract test output (API), and link a
human-approval issue when policy behaviour changes.
