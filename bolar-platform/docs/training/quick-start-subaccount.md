# Quick start: subaccount admin portal (/subaccount)

For org admins and subaccount admins. Demo account orgadmin@demo.bolar.test. The org admin role also opens the
owner, manager, finance and compliance portals from the switcher.

## 1. Overview

Screenshot (described): KPI cards "Active staff", "Open invitations", "Access approvals" and quick links to Staff and
roles and Audit.

## 2. Staff and roles (/subaccount/users)

Screenshot (described): heading "Staff and roles"; a table of users with name, email, roles and status, and an
"Invite user" button; below it an invitations table with status pending, accepted or revoked.

1. "Invite user": email and exactly one role. The invitee receives the `invite.staff` email with an accept link that
   expires; they set their own password on `/accept-invite`.
2. "Revoke invitation for <email>" cancels a pending invite.
3. "Suspend" on a user ends their sessions immediately; "Reactivate" restores access. Both are audited as
   `user.update`.
4. Additional roles and relationships (which properties a manager manages, which a landlord owns) are granted by
   the API today (`POST /roles`, `POST /relationships`); see the
   [admin onboarding checklist](admin-onboarding-checklist.md) step 4.

## 3. Access requests (/subaccount/access-requests)

Screenshot (described): heading "Sensitive access requests"; each card shows who asked, for which record, the purpose
and justification, and two buttons "Approve 8h" and "Deny".

- Staff see confidential fields redacted until you approve. Approvals last eight hours and can be revoked early.
- You cannot approve your own request; a second admin or the lawyer must.

## 4. Privacy requests (/subaccount/privacy-requests)

Screenshot (described): a table of requests with kind (access, deletion, correction, portability), status and a
countdown chip that turns orange under 7 days and red when overdue.

- Operators move a request through identity verification, discovery and exception review; only a lawyer or org admin
  decides. Full procedure: [../runbooks/privacy-request.md](../runbooks/privacy-request.md).

## 5. Retention (/subaccount/retention)

Screenshot (described): sections "Policies" (key, name, retain days, disposition) and "Assignments" (resource type,
record id, state, anchor date) with a "Run sweep" button and per-assignment "Approve", "Dispose", "Hold".

- "Run sweep" proposes dispositions for records past their retain period. Held records are marked held and skipped.
- Nothing is removed until an accountable person clicks "Approve" and then "Dispose".

## 6. Audit (/subaccount/audit)

Screenshot (described): filters "Action prefix" (for example `auth.`, `role.`, `sensitive`) and "Outcome", a table
with actor, action, resource, outcome and request id.

- Use outcome `deny` to see blocked attempts, `invitation.` to review onboarding, `sensitive_access.` for approvals.

## Good habits

- One role per invitation; add more later rather than over-granting.
- Approve sensitive access only with a business purpose you would defend to an auditor.
- Review the audit log weekly; export the manifest (`GET /audit/export`) for your records.
