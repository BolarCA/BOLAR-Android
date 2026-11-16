# Domain glossary (Day 2)

Terms are locked; code uses these names. Ambiguities are listed as blockers at the end.

| Term | Definition | Code name |
| --- | --- | --- |
| Tenant org | The customer organisation on the platform (a property management company or landlord entity). The hard isolation boundary; every scoped row carries its id. | `TenantOrg`, `tenantOrgId` |
| Business account | A legal entity inside a tenant org (an LLC, a corporate tenant company). | `BusinessAccount` |
| Subaccount | An operational division inside a business account (region, office). Roles can be scoped to it. | `Subaccount` |
| User | A person who can sign in; belongs to exactly one tenant org per profile. | `UserProfile` |
| Platform actor | A BOLAR employee user (`isPlatform`) who may act across orgs only with a support session or platform_admin role; always audited. | `isPlatform`, `SupportSession` |
| Role | A named bundle of permissions assigned within a scope (platform, org, subaccount, property, case). | `RoleAssignment`, `Role` |
| Permission | `resource:action` key checked by the API. | `Permission` |
| Relationship | A directed edge granting access by relation (owner_of, manages, tenant_of, assigned_to, represents, agency_for). | `RelationshipEdge` |
| Sensitive access request | Time-boxed approval to read confidential/restricted data for a declared purpose. | `SensitiveAccessRequest` |
| Classification | public, internal, confidential, restricted. Drives redaction and the sensitive gate. | `Classification` |
| Portfolio | A group of properties, usually one owner. | `Portfolio` |
| Property | A physical site with an address; belongs to a tenant org, optionally a portfolio and subaccount. | `Property` |
| Building | Optional structure inside a property. | `Building` |
| Unit | A rentable space in a property. Has a status lifecycle (vacant, occupied, notice, make_ready, down, reserved). | `Unit`, `UnitStatusHistory` |
| Tenant (resident) | A person or company renting a unit. Distinct from tenant org. Record is a tenant profile; portal login is a user with the `tenant` role. | `TenantProfile` |
| Occupant | A person living in a unit who is not a lease signer (family member, employee of a corporate tenant). | `Occupant`, role `occupant` |
| Applicant | A tenant profile with an application in progress. | `Application` |
| Screening order / result | A consumer report ordered with consent; the result is restricted data. | `ScreeningOrder`, `ScreeningResult` |
| Adverse action | FCRA workflow: pre-adverse notice, waiting period, final notice, dispute. | `AdverseAction` |
| Lease | A contract between the org and tenant parties for a unit over a term; versioned; lifecycle draft to terminated. | `Lease`, `LeaseVersion`, `LeaseParty` |
| Recurring charge | A scheduled amount on a lease (rent, parking, pet). | `RecurringCharge` |
| Work order | A maintenance job from intake to completion, optionally assigned to a vendor. | `WorkOrder`, `WorkOrderEvent` |
| Vendor | A service company; portal access limited to assigned work orders. | `VendorProfile`, `VendorContract` |
| Account / journal / ledger | Chart of accounts; double-entry journal entries with balanced ledger lines; posted entries are immutable. | `Account`, `JournalEntry`, `LedgerEntry` |
| Invoice / payment | A bill to a lease party; a payment settles it through a provider adapter. | `Invoice`, `Payment`, `PaymentEvent` |
| Document / media | Files with classification and versions (documents) or photos/videos tied to operations (media). | `Document`, `DocumentVersion`, `MediaAsset` |
| Template | Approved text for emails, SMS, notices, documents; high-risk templates need approval. | `Template`, `TemplateVersion` |
| Notification | A message to a recipient via email, SMS or in-app. | `Notification` |
| Compliance rule | Versioned policy-as-code with jurisdiction and effective dates; evaluates to allow, warn, block or review. | `ComplianceRule`, `RuleEvaluation` |
| Jurisdiction | Hierarchical code `US`, `US-TX`, `US-TX-TRAVIS`, `US-TX-AUSTIN`; resolved from the property address plus overrides. | `JurisdictionOverride` |
| Notice | A formal communication to a tenant (late rent, entry, adverse action) that requires approval before sending. | `Notice` |
| Audit log | Append-only record of who did what to which resource, with request id and outcome. | `AuditLog` |
| Retention policy / assignment | How long a record class is kept and what happens after; assignments track each record. | `RetentionPolicy`, `RetentionAssignment` |
| Privacy request | A data subject request (access, deletion, correction, portability). | `PrivacyRequest` |
| Legal hold | A counsel-approved freeze preventing deletion or disposition of in-scope records. | `LegalHold` |
| Case | A legal matter (eviction, dispute, compliance, agency) handled by lawyers; privileged by default. | `Case` |
| Agency request | A request from a government body for records; law-enforcement requests are a kind with mandatory counsel approval. | `AgencyRequest` |
| Export job / evidence packet | A reviewed, hashed manifest of files and audit events produced by a background job. | `ExportJob` |

## Ambiguities resolved as blockers until confirmed
1. **Tenant** means resident in product copy and `TenantProfile` in code; the org is always "tenant org". Any copy
   saying "tenant" for the organisation is a bug.
2. **Owner** is the landlord persona; `ownerType/ownerId` on documents and media means the *parent record*, not a person.
3. **Approved lease** means approved by an owner/admin, not signed; **active** means the term has started and the
   unit is occupied.
4. **Complete** work order means vendor work done and manager-verified; **review** is vendor-done pending verification.
