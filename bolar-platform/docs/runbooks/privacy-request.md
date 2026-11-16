# Runbook: privacy (DSAR) request, intake to fulfilment

Owner: compliance officer (operator), counsel (approver). Blueprint Day 48; approvals per p300 (deletion exceptions
require an accountable human). Everything below is audited; nothing is deleted before the decision step.

## SLAs

| Kind | Legal response window | `dueAt` set at intake | Internal checkpoints |
| --- | --- | --- | --- |
| access, correction, portability | 30 days | +30 days | identity verified by day 5, discovery by day 10, decision by day 20, fulfilled by day 28 |
| deletion | 45 days | +45 days | identity by day 5, discovery by day 10, exception review by day 20, decision by day 30, fulfilled by day 40 |

The queue (`/legal/privacy-requests`, `/subaccount/privacy-requests`) shows a countdown chip: `warning` under 7 days,
`danger` when overdue. Overdue open requests are the first item in the weekly compliance review.

## States

`received -> identity_verification -> discovery -> exception_review -> approved | denied -> fulfilled -> closed`

Illegal transitions answer `409 invalid_transition`. Only staff with `privacy_request:write` move a request forward;
only `privacy_request:approve` (lawyer, org admin) can decide, and the decider can never be the request's creator.

## 1. Intake (public, no login)

- `POST /privacy-requests/intake { orgSlug, kind, email }` (rate limited 5 per 15 minutes per IP; `429 rate_limited`).
- Creates the request (`received`), writes `privacy_request.received`, starts identity verification through the
  configured provider (`IDME_MODE`; mock locally) and moves to `identity_verification`. The response carries the
  provider `verificationUrl` to show the subject. Event `privacy_request.received` is published for notifications.
- Unknown org slug answers `404`; never confirm whether an email exists.

## 2. Identity verification

- The subject completes the provider flow; the callback posts `POST /privacy-requests/:id/verify { externalId }`.
- `verified` -> `identityVerifiedAt` and `identityMethod` (`idme-mock` locally) are set and audited
  (`privacy_request.identity_verified`). `failed` -> audited as `deny`; the request stays unverified.
- Operator action if the subject cannot verify online: record an alternative method out of band, then ask an org
  admin to set `identityVerifiedAt`/`identityMethod` through a change ticket (there is no UI bypass by design).

## 3. Discovery (`privacy_request:write`)

- `POST /privacy-requests/:id/discover` (blocked with `409` until identity is verified).
- Collects, inside the org only: user profiles by email, tenant profiles (by email or linked user), lease parties
  and leases, documents owned by the tenant profiles, notifications to the address, audit events by the user,
  contact methods and emergency contacts. Stored in `discoveryJson` with counts and ids; `subjectProfileId` set.
- Review the counts in the drawer. If a profile is missing because the subject used another address, add a note
  and run discovery again after the subject confirms the address (the request stays in `discovery`).

## 4. Exception review (`privacy_request:write`)

- `POST /privacy-requests/:id/review-exceptions` computes `exceptionsJson`:
  - `legal_hold`: any tenant profile, lease, document or user covered by an active hold (`isHeld`, parents included).
  - `retention`: lease records (7 years by default) and documents whose policy is not `delete`.
  - `audit_log`: audit events are append-only and never deleted; actor identifiers are retained.
  - `third_party`: processors and their modes from the environment (Stripe, Plaid, SendGrid, Twilio, DocuSign,
    TransUnion, ID.me). Any processor not in `mock` mode must receive a forwarded deletion request (manual step,
    record the ticket id in the decision note).
- Operator writes a short summary for counsel: what will be anonymized, what is retained and why.

## 5. Decision (`privacy_request:approve`, approver != creator)

- `POST /privacy-requests/:id/decide { decision: approved | partial | denied, note }`.
- `partial` = approved with exceptions (the normal outcome for deletion with holds or retention duties).
- The note is mandatory and lands in the audit row (`privacy_request.<decision>`); event `privacy_request.decided`.
- A denial must cite the legal basis in the note (identity not verified, manifestly unfounded, legal duty to keep).

## 6. Fulfilment (`privacy_request:write`, status `approved`)

- `POST /privacy-requests/:id/fulfill`.
- Deletion: tenant profiles not under hold are anonymized (`displayName` "Deleted subject", email/phone/SSN/DOB
  cleared, status `former`), contact methods and emergency contacts removed, documents owned by the profile
  soft-deleted unless held, notification addresses scrubbed. Held items are listed in the manifest as skipped.
  Audit rows are never touched. Lease records stay (retention) with the party now pointing at the anonymized profile.
- Access / portability: a data manifest (subjects, leases, documents, notification and audit counts) is built.
- `manifestJson` (with `sha256`) and `confirmationDraft` (rendered from the approved `privacy.confirmation` template,
  org override first) are stored. Audit `privacy_request.fulfilled`.
- Send the confirmation draft to the subject through the approved channel after a human reads it; AI never sends it.

## 7. Close

- `POST /privacy-requests/:id/close { note }` from `fulfilled` or `denied`. Record where the confirmation was sent.

## Escalations

- Legal hold conflicts: do not wait; decide `partial`, note the hold ids, and set a follow-up deadline on the
  related case to re-run fulfilment once counsel releases the hold.
- Request about a user in another org: the subject must file with that org's slug; never search across tenants.
- Suspected fraudulent request: leave unverified, deny with the reason, and notify security.

## Evidence for auditors

- `GET /privacy-requests/:id` (discovery, exceptions, decision, manifest sha256, confirmation draft).
- `GET /audit/export?resourceType=privacy_request&resourceId=<id>` gives the hashed audit manifest for the request.
