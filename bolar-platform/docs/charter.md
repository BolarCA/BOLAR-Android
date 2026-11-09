# BOLAR product charter (Day 1)

## Purpose
BOLAR is a multi-tenant property management platform for landlords, property managers, residents, corporate
tenants, vendors, bookkeepers, lawyers and (in a restricted lane) government agencies. It automates the operational
paperwork of renting while keeping every legal, financial and compliance outcome under accountable human control.

## Scope by phase

| Phase | Days | Scope |
| --- | --- | --- |
| Foundation | 1-15 | Monorepo, local stack, CI, auth, tenancy, RBAC/ReBAC, sensitive-access gate, audit |
| Core MVP | 16-50 | Properties/units, tenants/leases, documents/media/notifications, maintenance/vendors, finance/ledger, compliance rules + screening + notices, retention/privacy/legal hold/exports |
| Portals + staging | 51-60 | Admin shell, tenant mobile home, landlord dashboard, manager cockpit, a11y QA, integration adapters, seeded smoke, staging deploy + launch gate |
| V1 | 61-104 | AI assistant (audit-first), reporting/analytics, performance and hardening |
| V2 | 105-120 | UAT, training, launch readiness, production controls |

## Non-goals (MVP)
- No production payments, screening, e-sign or SMS: all providers run in mock/sandbox mode behind adapters.
- No AI decisions. AI (Days 61+) summarises, drafts and flags; humans approve (see human-approval-map.md).
- No native mobile apps; the tenant portal is responsive web.
- No general-purpose accounting/ERP; the ledger covers rent, deposits, fees, maintenance and payables only.
- No OpenSearch/warehouse; PostgreSQL indexes and materialised views first.

## Success metrics (pilot)
- Cross-portal demo with seeded data: admin, manager, owner, tenant, vendor, finance, compliance, legal, gov.
- 100% of tenant-scoped endpoints covered by isolation tests; zero cross-tenant reads in e2e.
- Every mutation of money, access, legal or compliance state produces an audit row (verified by tests).
- Ledger trial balance balanced; invoices reconcile to payments and journal entries.
- Staging deploy green with health, logs, backups and rollback proven (docs/launch-gate.md).
- Accessibility: no serious/critical axe violations on primary screens.

## Key risks (summary; full register in risk-register.md)
FCRA screening workflow, fair housing / source-of-income discrimination, privacy deletion vs legal hold, payments
scope, law-enforcement data production, tenant data leakage. Each has a gate in code and a counsel checkpoint.

## Assumptions
- US market first (federal + state/city rules modelled as versioned policy-as-code with jurisdiction chains).
- One pilot organisation with up to ~500 units; one deployment target (containers) with managed PostgreSQL.
- Engineering by a small team plus AI implementation agents following docs/architecture/module-conventions.md.

## Unresolved questions register
| # | Question | Owner | Blocking |
| --- | --- | --- | --- |
| 1 | Which jurisdictions are in the pilot (sets rule catalogue and counsel review scope)? | Founder + counsel | Day 41 activation |
| 2 | Screening provider contract (TransUnion SmartMove vs ShareAble) and FCRA permissible-purpose filing | Founder | Day 58 sandbox |
| 3 | Payments entity (PM company vs owner trust accounts) and deposit trust-account rules per state | Finance lead | Real payments |
| 4 | Retention periods per record class and state (defaults are conservative placeholders) | Counsel | Day 47 approval |
| 5 | Government lane: which agencies, legal basis templates, and who signs productions | Counsel | Day 50 |
| 6 | Identity provider for SSO at enterprise customers (ADR 0002 keeps a seam) | Eng | V1 |
