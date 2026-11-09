# Runbook: support and escalation

How a question or problem from a user reaches the right person, how BOLAR staff look at customer data without
breaking tenant isolation, and how incidents are communicated. Companion to
[incident-response.md](incident-response.md) and [monitoring-and-alerts.md](monitoring-and-alerts.md).

## Tiers

| Tier | Who | Handles | Tools | Response target |
| --- | --- | --- | --- | --- |
| 0 | The user | How-do-I questions | Cheat sheets and quick starts in `docs/training/` | immediate |
| 1 | Customer org admin or property manager | Access to records, roles, invitations, a stuck lease or repair, password resets through invitation re-send | `/subaccount/users`, `/subaccount/access-requests`, `/manager` | same business day |
| 2 | BOLAR support agent (`support_agent` or `platform_admin` role) | Anything the org admin cannot resolve: data looks wrong, a screen errors, a portal is denied unexpectedly | `/admin`, support sessions, platform audit, request ids | 4 business hours; 1 hour for a blocked payment or sign-in outage |
| 3 | Engineering on-call | Defects, outages, data corrections, restores | logs, database, deploy and rollback runbooks | SEV targets in [incident-response.md](incident-response.md) |
| 4 | Counsel and security lead | Suspected data exposure, legal hold or privacy request conflicts, agency and law-enforcement contacts, regulator questions | legal portal, audit export | same day; immediately for suspected exposure |

Escalate upward when the tier's tools cannot fix it or when the target is about to be missed. Record every hop on the
ticket.

## On-call

- One engineer is primary on-call per week (Monday 09:00 to Monday 09:00 local time of the pilot region), one
  secondary. The rota lives in the team calendar and the launch checklist names the people for launch week
  ([../launch-checklist.md](../launch-checklist.md), task L-13).
- Paging sources: the uptime monitor on `/health`, Sentry alerts once wired (launch task L-09), a tier 2 agent
  calling the on-call number for SEV1 and SEV2, the failed-job log alert.
- The on-call engineer acknowledges within 15 minutes, declares an incident when the criteria in
  [incident-response.md](incident-response.md) are met, and otherwise works the ticket as a defect.

## Support sessions (looking at a customer's data)

Support agents never receive customer passwords and never sign in as a customer user. They use a support session:

1. Open the ticket. The reason you will type must reference it (minimum 10 characters, for example
   `Ticket #4821: invoice shows wrong period`).
2. In `/admin/orgs` open the organization, click "Start support session", type the reason, pick the shortest duration
   that fits (15 to 480 minutes, default 60).
3. Click "Act as <org>". The banner "Support session active" stays visible; all requests carry `X-Tenant-Org` and are
   audited in the customer org as `support.cross_tenant_access` and in the platform org as `support.session_started`.
4. Reproduce or inspect; prefer read-only screens. Any change you make is audited under your name with the support
   session id attached.
5. "Stop acting as org", then end the session from `/admin/support-sessions` ("End support session for <org>").
   Sessions expire on their own at `endsAt`; ending early is still required by this runbook.
6. Paste the session id and what you changed into the ticket.

Platform admins can act on any org without a session (their role allows it); they still open a session for anything
beyond a glance, so the customer's audit log shows a reason.

## Data access rules

- Never copy personal data (names with emails, phone numbers, SSN digits, dates of birth, screening content) into
  tickets, chat or screenshots. Reference records by id and request id.
- Confidential and restricted fields are redacted for everyone until a time-boxed grant exists. Support agents do not
  request sensitive access on a customer's behalf; the customer's approver decides.
- A government or agency contact asking for data is never answered by support; route to counsel (tier 4), who uses
  the agency request workflow.
- A request to delete or export a person's data is a privacy request: give the person the org's intake route and
  file nothing yourself ([privacy-request.md](privacy-request.md)).
- Logs redact authorization headers, cookies, passwords, tokens, SSN, email, phone and recipient addresses; when a
  log line is pasted into a ticket, paste the `requestId`, `path`, `statusCode` and `msg` fields only.
- Database access by engineering happens only for a ticket, from a read replica or a restored scratch copy
  ([restore-drill.md](restore-drill.md)) where possible, and is noted on the ticket.

## Tracing a user report

1. Ask for the time, the portal and the request id shown in the error toast (every API error body carries
   `requestId`; the header `X-Request-Id` is exposed to the browser).
2. Search the API log for that `requestId`; the line shows method, path, status, response time and, for 401/403,
   `request denied` with the error code; 500s log `unhandled error` with the stack.
3. Check the audit log in the customer org for `access.denied` rows around that time (filter Outcome `deny`).
4. Decide: configuration or role problem (tier 1 fixes), product defect (file an issue with the request id, tier 3),
   or incident (declare).

## Incident communications

- Internal: the incident channel receives the declaration, every status change and the resolution; the tier 2 lead
  mirrors customer-facing updates there.
- Customers: status page updates using the templates in [monitoring-and-alerts.md](monitoring-and-alerts.md), at
  declaration, every 30 minutes for SEV1, every 2 hours for SEV2, and at resolution.
- Affected individuals (data exposure): counsel decides wording, timing and recipients; support sends nothing on its
  own.
- After resolution: tier 2 replies on every related ticket with the resolution summary and links the postmortem.

## Weekly hygiene

- Review `/admin/support-sessions` with Show = all: every session has a ticket reference and was ended.
- Review platform audit for `support.cross_tenant_access` without a session (platform admin direct access) and
  confirm each has a ticket.
- Rotate the on-call and update the launch checklist contact row.
