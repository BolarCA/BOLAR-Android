# Admin onboarding checklist: setting up a new customer organization

For the BOLAR platform admin (steps 1 to 3) and the customer's org admin (steps 4 onwards). Each step names the
screen or API call that exists today and the audit row it leaves. Tick the box, note the date and who did it.

## 1. Create the organization (platform admin, `/admin/orgs`)

- [ ] Sign in as a platform admin; MFA enrolled (the control plane routes require an MFA-verified session once MFA
  is enabled on the account).
- [ ] Organizations, "Create organization": slug (lower-case, URL-safe, unique), display name, plan. Audited as the
  org creation in the platform audit log (`/admin/audit`).
- [ ] Open the new org; confirm it shows under Subaccounts with no subaccount yet.
- [ ] If the org needs a feature flag scoped to it (`/admin/feature-flags`, "New flag" with the org selected),
  create it disabled first and enable it after the admin has signed in.

## 2. Bootstrap the first admin (platform admin, API)

- [ ] Start a support session for the new org (`/admin/orgs/<id>`, "Start support session", reason = onboarding
  ticket, duration 60) and "Act as" the org. Every action below is then audited in the customer org as
  `support.cross_tenant_access` plus the action itself.
- [ ] Create the business account and the first subaccount: `POST /business-accounts {name}` then
  `POST /subaccounts {businessAccountId, name}` (region or portfolio name).
- [ ] Invite the customer's first org admin: `/subaccount/users`, "Invite user", role `org_admin`. The invitation
  email uses the platform template `invite.staff`; in mock mode read the accept link from `GET /invitations`.
- [ ] "Stop acting as org" and end the support session from `/admin/support-sessions`.

## 3. Hand over (platform admin)

- [ ] Send the org admin the staging URL, their invitation and the cheat sheet
  ([cheat-sheets.md](cheat-sheets.md)). Never send passwords; the invite flow sets one.
- [ ] Confirm in `/admin/audit` (Action prefix `invitation.`) that the invitation was accepted.

## 4. Invite staff and assign scoped roles (org admin, `/subaccount/users`)

- [ ] For each staff member: "Invite user" with exactly one role. Roles and the scope they accept:

| Role | Accepted scopes (`ROLE_SCOPES`) | Portal |
| --- | --- | --- |
| `org_admin` | org | /subaccount (plus owner, manager, finance, compliance) |
| `subaccount_admin` | subaccount | /subaccount, /manager |
| `property_manager` | org, subaccount or property (relationships narrow to managed properties) | /manager |
| `landlord` | org, subaccount or property (relationships narrow to owned properties) | /owner |
| `bookkeeper` | org or subaccount | /finance |
| `compliance_officer` | org or subaccount | /compliance |
| `lawyer` | org or case | /legal |
| `corp_admin` | org or subaccount | /corporate-admin |
| `vendor` | org (relationships narrow to assigned jobs) | /vendor |
| `tenant`, `occupant`, `government` | org | /tenant, /occupant, /gov |

A role assigned with a scope outside this table is refused with "cannot be scoped to".

- [ ] Extra roles for an existing user: `POST /roles {userId, role, scopeType, scopeId}` (audited `role.grant`);
  remove with `DELETE /roles/:id` (`role.revoke`).
- [ ] Grant relationships that drive data visibility (`POST /relationships`, audited `relationship.grant`):
  `manages` (manager to property or subaccount), `owner_of` (landlord to portfolio or property), `bookkeeper_for`
  (bookkeeper to subaccount or property), `represents` (lawyer to case), `tenant_of` (tenant user to lease and unit),
  `occupant_of` (occupant to lease), `assigned_to` (vendor to work order, set automatically on assignment),
  `agency_for` (government user to agency request).
- [ ] Check `/subaccount` KPI "Active staff" and the user list; suspend anyone who left with "Suspend" (sessions are
  revoked immediately).

## 5. Approve sensitive access (org admin or lawyer, `/subaccount/access-requests`, `/legal/access-requests`)

- [ ] Explain to staff that confidential and restricted fields (SSN last 4, date of birth, screening reports) stay
  redacted until they click "Request access" with a purpose and justification.
- [ ] Approvers decide with "Approve 8h" or "Deny"; the requester can never approve their own request. Grants are
  time-boxed and can be revoked early. All decisions are audited.
- [ ] Agree the internal rule for who approves (org admin by default, lawyer for restricted screening data).

## 6. Configure templates (manager drafts, lawyer approves, `/manager/templates`)

- [ ] Review the platform templates listed on `/manager/templates` (`invite.staff`, `workorder.created`,
  `invoice.issued`, `notice.late_rent`, `notice.pre_adverse`, `notice.final_adverse`, `privacy.confirmation`,
  `sms.workorder.scheduled`).
- [ ] For an org-specific version: "New template" (or a new version of a platform key), fill subject and body with
  `{{variables}}`, "Submit for approval". High-risk templates (notices, adverse action, privacy confirmation) must be
  approved by counsel (`template:approve`) before first use; the approval is audited.
- [ ] Render once with sample variables ("Render") and keep the output with the counsel review record
  ([../counsel-review-map.md](../counsel-review-map.md)).

## 7. Configure compliance rules and jurisdictions (compliance officer with counsel, `/compliance/rules`)

- [ ] Confirm the pilot jurisdictions (`US`, `US-TX`, `US-CA` in the seed) and that each property has the correct
  state and county so the jurisdiction resolver picks the right rules (`GET /jurisdiction/resolve`).
- [ ] Review the active rule versions with counsel; draft changes with "New version", preview with "Preview against
  sample facts", and "Activate" only after counsel sign-off (audited; the previous version is retired).
- [ ] Record any jurisdiction override (`POST /jurisdiction/overrides`) with its legal basis.

## 8. Configure retention and privacy (org admin with counsel, `/subaccount/retention`)

- [ ] Review platform retention policies (`documents.general`, `lease.records`) and add org policies under "New
  retention policy" only with counsel's confirmation of the state rules.
- [ ] Attach policies to record types under "Attach a retention policy"; run "Run sweep" once to see proposed
  dispositions; nothing is deleted until "Approve".
- [ ] Publish the privacy intake slug to residents: `POST /privacy-requests/intake` uses the org slug; the workflow
  is in [../runbooks/privacy-request.md](../runbooks/privacy-request.md).

## 9. Load data (manager)

- [ ] Properties and units: `/manager/properties`, "Add property", then "Add unit" per unit (or the API for bulk).
- [ ] Vendors: `/manager/vendors`, "Add vendor"; upload the insurance certificate and MSA on the vendor page, then
  "Approve the vendor".
- [ ] Tenants and leases: `/manager/tenants`, "New tenant profile"; `/manager/leases`, "New lease"; the landlord
  approves from `/owner/approvals`.
- [ ] Chart of accounts: `/finance` uses the default accounts (`POST /accounts/seed-default` creates them for a new
  org); add custom accounts under Ledger.

## 10. Verify before go-live

- [ ] Every staff member has signed in once and enrolled MFA from their profile (Sign-in security).
- [ ] `/subaccount/audit` shows the onboarding actions; export the manifest for the launch evidence
  (`GET /audit/export`).
- [ ] Run through the UAT scripts for the personas the customer uses ([../uat/README.md](../uat/README.md)).
- [ ] Support path and escalation contacts shared ([../runbooks/support-escalation.md](../runbooks/support-escalation.md)).
