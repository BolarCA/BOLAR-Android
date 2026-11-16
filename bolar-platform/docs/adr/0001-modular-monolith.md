# ADR 0001: Modular monolith first

- Status: accepted
- Date: 2026-11-09

## Context
The blueprint (p9) requires a buildable MVP in 60 days by a small team using AI agents, with strict tenant
isolation, audit and compliance gates. Microservices would multiply deployment, auth and consistency surfaces.

## Decision
One Node API process (`packages/api`) with domain modules that share a kernel (context, access, audit, events).
One Next.js app with portal route groups. Workers run as a separate process consuming the same code via packages.
Module boundaries are enforced by folder ownership and the `modules/index.ts` registry; cross-module calls go through
service functions, not direct table access.

## Consequences
- Single database transaction boundary and simple local setup (`docker compose up`).
- Extraction seams exist: adapters (`packages/integrations`), event bus -> queue, module routers.
- A new service requires an ADR; agents are instructed not to create one.
