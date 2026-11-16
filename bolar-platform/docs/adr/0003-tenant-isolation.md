# ADR 0003: Tenant isolation strategy (Days 8, 10)

- Status: accepted
- Date: 2026-11-09

## Decision
Every tenant-scoped table carries `tenantOrgId`. The API never queries those tables with the root client in
request handlers; it uses `tenantDb(ctx)` which is a Prisma client extension (`forTenant`) that:

- injects `tenantOrgId` into every `findMany/findFirst/count/aggregate/groupBy/updateMany/deleteMany` where clause,
- stamps `tenantOrgId` on `create/createMany`,
- turns `findUnique/update/delete` on another tenant's row into not-found.

The set of scoped models is derived from the Prisma DMMF, so new models are covered automatically.
Tenant resolution comes from the session token; `X-Tenant-Org` is only honoured for platform actors.

## Verification
`packages/db/src/__tests__/tenant-isolation.test.ts` (client extension) and
`packages/api/src/__tests__/tenant-isolation.test.ts` (HTTP: two orgs with overlapping names, list/detail/update/
delete, header abuse, audit scoping). Any failure is a launch blocker.

## Later hardening
PostgreSQL row-level security with `SET LOCAL app.tenant_id` per transaction as defense in depth (Days 91-104).
