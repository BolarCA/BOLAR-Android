# Bounded contexts and domain events (Day 2)

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Identity &   │   │ Property     │   │ Tenancy      │   │ Maintenance  │
│ Access       │──▶│ (portfolio,  │──▶│ (profiles,   │──▶│ (work orders,│
│ (auth, org,  │   │ property,    │   │ applications,│   │ vendors)     │
│ roles, rels, │   │ unit)        │   │ leases)      │   │              │
│ sensitive)   │   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
└──────┬───────┘          │                  │                  │
       │                  ▼                  ▼                  ▼
       │           ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
       │           │ Finance      │   │ Documents &  │   │ Compliance   │
       │           │ (accounts,   │◀──│ Comms (docs, │──▶│ (rules,      │
       │           │ ledger,      │   │ media,       │   │ jurisdiction,│
       │           │ invoices,    │   │ templates,   │   │ screening,   │
       │           │ payments)    │   │ notifications│   │ notices)     │
       │           └──────────────┘   └──────────────┘   └──────┬───────┘
       ▼                                                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Governance (audit, retention, privacy requests, legal holds,         │
│ cases, agency requests, evidence exports)                            │
└──────────────────────────────────────────────────────────────────────┘
```

## Context responsibilities and boundaries

| Context | Owns | Depends on (read) | Must never |
| --- | --- | --- | --- |
| Identity & Access | users, sessions, roles, relationships, sensitive access | - | read domain tables |
| Property | portfolio, property, building, unit status | access | mutate leases |
| Tenancy | tenant profiles, applications, leases, parties, charges | property (unit), access | post ledger entries |
| Maintenance | work orders, events, vendors | property, tenancy (unit occupancy), media | pay vendors directly |
| Finance | accounts, journals, invoices, payments | tenancy (lease charges), property | change lease terms |
| Documents & Comms | documents, media, templates, notifications | every context by ownerType | decide classification downgrades |
| Compliance | rules, evaluations, jurisdiction, screening, adverse action, notices | property (address), tenancy, templates | send without approval |
| Governance | audit, retention, privacy, legal hold, cases, agency requests, exports | all (read-only, tenant-scoped) | delete held records |

Cross-context calls go through service functions or domain events, never through another context's tables with
write intent. Shared primitives (tenant guard, access, audit, events) live in the kernel.

## Domain events (published on the in-process bus and the `domain-events` queue)

| Event | Producer | Consumers |
| --- | --- | --- |
| `org.created`, `invitation.created`, `invitation.accepted` | Identity | Notifications |
| `sensitive_access.requested` | Identity | Notifications (approvers) |
| `property.created`, `unit.status_changed` | Property | Reporting, Finance (vacancy) |
| `tenant_profile.created`, `lease.transitioned`, `lease.signed` | Tenancy | Finance (invoice generation), Compliance (rule evaluation), Notifications |
| `document.uploaded`, `media.uploaded` | Documents | Retention (assignment), virus scan |
| `work_order.created`, `work_order.transitioned`, `work_order.sla_breached` | Maintenance | Notifications, Reporting |
| `invoice.issued`, `payment.succeeded`, `payment.failed` | Finance | Notifications, Reporting |
| `rule.evaluated`, `notice.approved`, `adverse_action.final` | Compliance | Notifications, Governance (audit packet) |
| `privacy_request.received`, `legal_hold.created`, `export.completed` | Governance | Notifications, Retention |
