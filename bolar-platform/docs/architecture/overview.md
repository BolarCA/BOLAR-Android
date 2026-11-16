# Architecture overview

BOLAR is a modular monolith (blueprint p9) with clean seams for later extraction.

```
apps/web (Next.js 15, React 19)  ──HTTP/JSON──▶  packages/api (Express 5 modules)
        │                                              │
        │ typed client + React Query                   ├─ shared kernel: context, access (RBAC+ReBAC),
        │                                              │  sensitive gate, audit, events, idempotency
        ▼                                              ▼
 packages/contracts (zod + openapi.yaml)      packages/db (Prisma 6 / PostgreSQL 16)
                                                       │
            packages/workers (BullMQ/Redis) ◀── domain events ──┘
                       │
            packages/integrations (adapters: storage, email, sms, payments, bank link,
                                   e-sign, screening, identity; mock | sandbox | production)
```

## Layers to blueprint map

| Blueprint layer | Implementation |
| --- | --- |
| L1 Portals | `apps/web/app/(portals)/*`, role-gated `AppShell`, portal registry `lib/nav.ts` |
| L2 Access | `modules/auth`, `modules/iam`, `shared/access.ts`, `shared/context.ts` |
| L3 Governance | `modules/audit`, `modules/retention`, `modules/privacy`, `modules/legal-hold`, `modules/packet-export` |
| L4 Compliance | `modules/compliance` (rules, jurisdiction, evaluator, fair-housing/SOI), `modules/notice` |
| L5 Core | `modules/property`, `tenant-profile`, `lease`, `document`, `media`, `maintenance`, `vendor`, `finance` |
| L6 Legal/Gov | `modules/legal` (cases, agency requests), `modules/packet-export` |
| L7 AI/Reporting | `modules/ai` (Days 61-74, deferred), reporting views (Days 75-90, deferred) |
| L8 Data | PostgreSQL primary, Redis queues, S3/MinIO objects, `TENANT_SCOPED_MODELS` guard |
| L9 External | `packages/integrations` adapters behind `ProviderAdapter` with feature flags via `*_MODE` |

## Request lifecycle

1. `buildContext` resolves `requestId`, bearer session, tenant org, roles, permissions, declared purpose.
2. `mount()` validates params/query/body with zod, applies auth level and coarse permission, handles idempotency.
3. Handler uses `tenantDb(ctx)` (auto tenant filter), `requireAccess` (scoped RBAC or relationship), `requireSensitiveAccess`.
4. Mutations write `AuditLog` (append-only, DB trigger) and `publish` domain events to the queue.
5. Errors are `{code,message,requestId,fieldErrors?}`; denied resources answer 404 so existence is not leaked.

## Data classification

`public < internal < confidential < restricted`. Confidential/restricted reads need an approved, time-boxed
`SensitiveAccessRequest` or an explicit `*_sensitive` permission plus `X-Access-Purpose`. All such reads are audited.
