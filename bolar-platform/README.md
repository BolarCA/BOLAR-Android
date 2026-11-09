# BOLAR platform

Multi-tenant, compliance-gated property management platform built from the
*BOLAR AI Property Management Blueprint v15*. Modular monolith: Next.js portals,
Node/Express API modules, Prisma on PostgreSQL, BullMQ workers, provider adapters.

> Secure by design · privacy first · compliance gated · human-in-loop AI

## Local bootstrap (blueprint p6)

Prerequisites: Node 22 LTS, Docker (or local PostgreSQL 16 + Redis 7), git.

```bash
corepack enable
docker compose up -d postgres redis minio mailhog     # or point DATABASE_URL at a local Postgres
scripts/dev-bootstrap.sh                               # installs, builds packages, migrates, seeds demo data
pnpm dev                                               # web :3000, api :4000, workers
```

Sign in at http://localhost:3000/login with any demo persona (password `Bolar!Demo2026`):

| Persona | Email | Portal |
| --- | --- | --- |
| Platform admin | platform@bolar.test | /admin |
| Org admin | orgadmin@demo.bolar.test | /subaccount |
| Property manager | manager@demo.bolar.test | /manager |
| Landlord | owner@demo.bolar.test | /owner |
| Tenant | tenant@demo.bolar.test | /tenant |
| Bookkeeper | books@demo.bolar.test | /finance |
| Lawyer | legal@demo.bolar.test | /legal |
| Vendor | vendor@demo.bolar.test | /vendor |
| Compliance | compliance@demo.bolar.test | /compliance |
| Government | gov@demo.bolar.test | /gov |
| Corporate admin | corp@demo.bolar.test | /corporate-admin |
| Occupant | occupant@demo.bolar.test | /occupant |

All data is synthetic. Never load real tenant data into a development database.

## Quality gates (blueprint p12)

```bash
pnpm lint && pnpm typecheck && pnpm test     # unit + API tests against Postgres
pnpm openapi:check                            # regenerates packages/contracts/openapi.yaml and fails on drift
pnpm db:migrate:test                          # applies all migrations to a scratch database
pnpm e2e:smoke && pnpm a11y:smoke             # Playwright journeys + axe
pnpm env:check && pnpm docs:lint
```

CI runs the same gates in `.github/workflows/ci.yml`; `security.yml` adds dependency audit and a secret scan.

Seeded smoke status: [docs/smoke-results.md](docs/smoke-results.md). Launch gate: [docs/launch-gate.md](docs/launch-gate.md).

## Repository layout (blueprint p10)

```
apps/web/                 Next.js portals: admin, subaccount, owner, manager, tenant, corporate-admin,
                          occupant, finance, legal, vendor, gov, compliance
packages/api/             Express modular monolith (src/modules/*, src/shared/*)
packages/shared/          Types, errors, RBAC catalog, relationships, classification, pagination, state machine
packages/contracts/       zod request/response schemas + generated openapi.yaml
packages/db/              Prisma schema, migrations, seed (base + demo)
packages/integrations/    Provider adapters (storage, email, sms, payments, bank link, e-sign, screening, identity)
packages/workers/         BullMQ job handlers
packages/testing/         Fixtures for API and e2e tests
tests/                    Playwright config and e2e specs
infra/                    Deployment assets
docs/                     Charter, glossary, ADRs, risk register, QA evidence, runbooks, launch gate
```

## What is implemented (blueprint Days 1-60)

| Area | Modules |
| --- | --- |
| Access | auth (sessions, TOTP MFA), tenant orgs/subaccounts, IAM (users, invitations, scoped roles, relationships), sensitive-access gate, audit, platform control plane (health, feature flags, support sessions) |
| Core | property/portfolio/unit with status machine, tenant profiles with field classification, leases with versions/parties/charges and lifecycle, e-sign envelopes, documents/media with signed URLs, notifications and templates, maintenance work orders with SLA and vendors, chart of accounts, double-entry ledger, invoices, payments and webhooks |
| Compliance | policy-as-code rule engine, jurisdiction resolver, fair housing / SOI guard, applications with consent-gated screening, FCRA adverse action, notices with approval |
| Governance | retention policies and gated disposition, privacy (DSAR) workflow, legal holds, cases and agency requests, evidence packet exports |
| Portals | admin, subaccount, manager (ops cockpit), owner dashboard, tenant mobile home, finance, legal, vendor, gov, compliance, corporate admin, occupant |

QA evidence per slice lives in `docs/qa/`; runbooks in `docs/runbooks/`.

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Module conventions (implementation contract)](docs/architecture/module-conventions.md)
- [ADRs](docs/adr/)
- API contract: `packages/contracts/openapi.yaml` (`pnpm openapi:generate`)
