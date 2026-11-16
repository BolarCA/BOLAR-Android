# Quick start: master admin portal (/admin)

For BOLAR platform staff. Demo account platform@bolar.test. Everything you do here is audited in the platform
organization and, when you act inside a customer org, in that org too.

## 1. Sign in and read the overview

Screenshot (described): a dark sidebar titled "Master admin" with Overview, Organizations, Users, Audit, Feature
flags, Support sessions; the main area shows a health card with "API health ok", "db ok", the number of
organizations, users, active sessions and support sessions, and the queue driver.

- Green health means the API answered `/health` with every dependency ok. "degraded" or a missing card means the API
  is down or the database check failed: follow [../runbooks/incident-response.md](../runbooks/incident-response.md).

## 2. Find and inspect an organization

Screenshot (described): "Organizations" table with slug, name, plan and status; clicking the name opens a detail page
with a "Subaccounts" list, "Recent audit activity" and a "Start support session" button.

- Use the slug to identify an org in tickets; names are not unique across customers.
- "Create organization" asks for a slug (lower-case letters, digits and hyphens), a name and a plan (`pilot`,
  `standard`, `enterprise`).

## 3. Support a customer safely

1. On the org page click "Start support session"; type the ticket reference as the reason (at least 10 characters)
   and choose a duration (15 to 480 minutes).
2. Click "Act as <org>". A banner "Support session active" stays on screen; every request now carries the customer
   org and is audited as `support.cross_tenant_access`.
3. Do the work the ticket asks for in the customer's portals (the switcher shows them).
4. Click "Stop acting as org" in the banner, then end the session on "Support sessions" ("End support session for
   <org>"). Sessions also expire automatically at their end time.

Never start a session without a ticket reference, and never change customer data outside an active session.

## 4. Feature flags

Screenshot (described): a table of flags with key, scope (global or an org), state and an Enable or Disable button;
"New flag" opens a dialog with Key, optional organization and a Rules (JSON) field.

- Create disabled, verify on staging, then enable. Invalid JSON is rejected before saving.

## 5. Audit

Screenshot (described): filters "Action prefix" and "Outcome" above a table of time, actor, action, resource and
outcome, with a request id on each row.

- Filter `support.` to review support activity, `auth.` for sign-ins, outcome `deny` for blocked attempts.
- The request id matches the `X-Request-Id` header and the API log line, so engineering can trace a complaint from
  the UI toast to the log.

## If something goes wrong

Denied state on a screen you should reach, a health card that is not green, or an audit row you cannot explain:
raise it through [../runbooks/support-escalation.md](../runbooks/support-escalation.md) (tier 2 for health, tier 3 for
suspected access problems).
