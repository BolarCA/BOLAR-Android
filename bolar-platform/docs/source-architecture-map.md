# Source architecture map (Day 1)

Every box in the blueprint's layered architecture (p3) mapped to a module, owner and build phase.

| Layer | Blueprint box | Module / location | Owner role | Phase | Status |
| --- | --- | --- | --- | --- | --- |
| L1 Portals | Master admin | `apps/web/app/(portals)/admin` | Frontend builder | Day 51 | shell built |
| L1 Portals | Subaccount admin | `apps/web/app/(portals)/subaccount` | Frontend builder | Day 11/15 | built |
| L1 Portals | Landlord | `apps/web/app/(portals)/owner` | Frontend builder | Day 53 | in build |
| L1 Portals | Property manager | `apps/web/app/(portals)/manager` | Frontend builder | Day 54 | in build |
| L1 Portals | Tenant mobile/web | `apps/web/app/(portals)/tenant` | Frontend builder | Day 52 | in build |
| L1 Portals | Corporate admin / occupant | `apps/web/app/(portals)/corporate-admin`, `occupant` | Frontend builder | V1 | stub |
| L1 Portals | Bookkeeper | `apps/web/app/(portals)/finance` | Finance slice | Day 36-40 | built |
| L1 Portals | Lawyer | `apps/web/app/(portals)/legal` | Governance slice | Day 46-50 | built |
| L1 Portals | Vendor | `apps/web/app/(portals)/vendor` | Maintenance slice | Day 31-35 | built |
| L1 Portals | Government restricted | `apps/web/app/(portals)/gov` | Governance slice | Day 46-50 | built |
| L2 Access | Auth, sessions, MFA | `packages/api/src/modules/auth` | Backend builder | Day 7/9 | built |
| L2 Access | Tenancy (org, business account, subaccount) | `modules/tenant` | Backend builder | Day 8 | built |
| L2 Access | RBAC matrix | `packages/shared/src/rbac.ts`, `modules/iam` | Backend builder | Day 12 | built |
| L2 Access | ReBAC relationships | `modules/iam`, `shared/access.ts` | Backend builder | Day 13 | built |
| L2 Access | Sensitive access gate | `modules/sensitive-access`, `shared/access.ts` | Backend builder | Day 14 | built |
| L3 Governance | Audit | `modules/audit`, DB trigger | Backend builder | Day 15/46 | built |
| L3 Governance | Retention | `modules/retention` | Governance slice | Day 47 | built |
| L3 Governance | Deletion/DSAR | `modules/privacy` | Governance slice | Day 48 | built |
| L3 Governance | Legal hold | `modules/legal-hold` | Governance slice | Day 49 | built |
| L4 Compliance | Rule engine, jurisdiction | `modules/compliance` | Compliance slice | Day 41-42 | built |
| L4 Compliance | Screening + adverse action | `modules/screening` | Compliance slice | Day 43/58 | built |
| L4 Compliance | Fair housing / SOI guard | `modules/compliance/fair-housing.ts` | Compliance slice | Day 44 | built |
| L4 Compliance | Notices | `modules/notice` | Compliance slice | Day 45 | built |
| L5 Core | Properties/units | `modules/property` | Property slice | Day 16-20 | built |
| L5 Core | Tenants/leases | `modules/tenant-profile`, `modules/lease` | Tenancy slice | Day 21-25 | built |
| L5 Core | Documents/media/notifications/templates | `modules/document`, `media`, `notification`, `template`, `storage` | Docs slice | Day 26-30 | built |
| L5 Core | Maintenance/vendors | `modules/maintenance`, `modules/vendor` | Maintenance slice | Day 31-35 | built |
| L5 Core | Finance/ledger | `modules/finance` | Finance slice | Day 36-40 | built |
| L6 Legal/Gov | Cases, agency requests, exports | `modules/legal`, `modules/packet-export` | Governance slice | Day 46-50 | built |
| L7 AI/Reporting | Assistant, reports | `modules/ai` (deferred), materialised views | V1 | Day 61-90 | deferred |
| L8 Data | PostgreSQL, Redis, object storage | `packages/db`, `shared/queue.ts`, `integrations/storage` | Data reviewer | Day 5/8/26 | built |
| L9 External | Stripe, Plaid, SendGrid, Twilio, DocuSign, TransUnion, ID.me | `packages/integrations` | Integrations | Day 56-58 | mock + sandbox boundaries built |
