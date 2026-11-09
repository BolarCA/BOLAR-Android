# Training materials (Days 105-120)

Short, role-specific material for the pilot. Every guide describes screens that exist in the current build and uses
the demo organization `demo-pm` with synthetic data. Screenshots are described in words (alt text) rather than
committed as images, so the guides never carry real data and stay valid when styling changes; trainers capture
fresh screenshots from staging on the day.

## Index

| Material | Audience | File |
| --- | --- | --- |
| Admin onboarding checklist | Org admin setting up a new customer | [admin-onboarding-checklist.md](admin-onboarding-checklist.md) |
| One-page cheat sheets (all portals) | Everyone, printed or pinned | [cheat-sheets.md](cheat-sheets.md) |
| Quick start: master admin | BOLAR platform staff | [quick-start-admin.md](quick-start-admin.md) |
| Quick start: subaccount admin | Org admins | [quick-start-subaccount.md](quick-start-subaccount.md) |
| Quick start: property manager | Managers, leasing agents | [quick-start-manager.md](quick-start-manager.md) |
| Quick start: landlord | Owners | [quick-start-owner.md](quick-start-owner.md) |
| Quick start: resident | Tenants (phone first) | [quick-start-tenant.md](quick-start-tenant.md) |
| Quick start: bookkeeper | Finance staff | [quick-start-finance.md](quick-start-finance.md) |
| Quick start: lawyer | Counsel | [quick-start-legal.md](quick-start-legal.md) |
| Quick start: vendor | Contractors | [quick-start-vendor.md](quick-start-vendor.md) |
| Quick start: compliance officer | Compliance staff | [quick-start-compliance.md](quick-start-compliance.md) |
| Quick start: government | Agency users | [quick-start-gov.md](quick-start-gov.md) |
| Quick start: corporate tenant admin | Corporate housing coordinators | [quick-start-corporate-admin.md](quick-start-corporate-admin.md) |
| Quick start: occupant | People housed under a corporate lease | [quick-start-occupant.md](quick-start-occupant.md) |

## How training sessions run

1. 45 minutes per persona group, on staging, each attendee signed in as the demo account of their persona.
2. The trainer walks the quick start once, then attendees repeat the UAT script for their persona
   ([../uat/README.md](../uat/README.md)) with the trainer answering questions. Confusion points go to the scribe and
   feed the usability findings in the release issue.
3. Attendees leave with the cheat sheet and the support path from
   [../runbooks/support-escalation.md](../runbooks/support-escalation.md).

## Conventions used in the guides

- Portal paths are written as `/manager`, `/tenant` and so on; on staging prepend the staging web URL.
- "Denied state" means the grey panel that says you do not have access to a screen; it is expected when a role has
  no business there and is never a bug to report unless it appears on a screen your role should reach.
- "Review required" means a sensitive field or report stays hidden until an approver grants time-boxed access.
- Every write action leaves an audit row; the guides say "audited" where staff should expect that.
