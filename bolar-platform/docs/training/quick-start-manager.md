# Quick start: property manager portal (/manager)

Demo account manager@demo.bolar.test. The manager portal is where most daily work happens; this guide covers one
screen per task. Each action writes an audit row and, where the blueprint requires it, waits for a second person.

## 1. Operations cockpit (/manager)

Screenshot (described): heading "Operations"; a KPI strip (Overdue work orders, Leases awaiting action, Compliance
hits, Notices pending, Applications in review, Vacant units); filters for Property, type chips, Due date, Priority;
a queue table where overdue rows come first and each row has "Open ..." plus Tenant or Vendor links.

- Start the day here. "Clear filters" resets everything. Deep links open the record with its drawer already open.

## 2. Properties and units (/manager/properties)

Screenshot (described): "Properties" with Table and Cards toggle and an "Add property" button; a property detail
shows units with status badges, "Add unit", "Change status of unit <n>" and a "Hierarchy" view.

- Unit statuses follow a state machine (vacant, reserved, make ready, occupied, notice, down); every change needs a
  reason and shows in the unit history.

## 3. Tenants (/manager/tenants)

Screenshot (described): "Tenants" list with search; "New tenant profile" dialog (Display name, Email, Phone, SSN last
4); the detail page shows redacted confidential fields and a "Reveal sensitive fields" button that turns into a
"Request access" flow.

- Confidential data stays hidden until an approver grants eight hours of access with a recorded purpose.

## 4. Leases (/manager/leases)

Screenshot (described): "Leases" list; "New lease" dialog (Property, Unit limited to vacant units, Find tenant,
Primary tenant, Start date, End date, Monthly rent, Security deposit); the lease workspace shows a lifecycle rail
(draft, review, approved, sent, signed, active), the parties table, versions and an audit timeline.

1. "Create draft", then "Submit for review". The text "Awaiting a second person" means the landlord must approve.
2. After approval click "Send for e-signature" (DocuSign in mock mode on staging).
3. "Cancel lease" releases the unit if the deal falls through.

## 5. Applications and screening (/manager/applications)

Screenshot (described): "Applications and screening"; an application detail with buttons in order: Submit
application, Record applicant consent, Order screening, Run screening, View report (restricted), Record decision; an
adverse-action panel with the stage and "Waiting period ends".

- "Order screening" is blocked until consent is recorded (rule `us.fcra.consent_before_screening`).
- The raw report is restricted; you see a review-required state unless access is granted.
- A denial creates an adverse action; the pre-adverse notice, waiting period and final notice are human steps.

## 6. Notices (/manager/notices)

Screenshot (described): "Notices" with a "Draft notice" dialog (Template, Recipient, Body); a "guard hits" panel that
lists flagged phrases and the rule key; rows show the notice status and whether a hit is open.

- Guard hits (fair housing, source of income) must be resolved by compliance before approval; sending requires
  approval by someone other than you.

## 7. Maintenance board (/manager/maintenance)

Screenshot (described): "Maintenance board" lanes New, Triaged, Assigned, Scheduled, In progress, Blocked, Review,
Complete; cards with priority and an SLA chip; a drawer with Triage, Assign vendor (eligible list with reasons for
ineligible vendors), Schedule, Start work, Mark complete, Decline / unassign, notes and a timeline; header actions
"Run SLA scan" and an "Overdue only" filter.

- Emergency 24 h, high 72 h, normal 7 days, low 14 days. Escalation paths:
  [../runbooks/maintenance-escalation.md](../runbooks/maintenance-escalation.md).

## 8. Vendors, documents, templates

- Vendors (/manager/vendors): "Add vendor", then upload insurance certificate and MSA on the vendor page and approve;
  "Suspend" keeps current jobs but stops new assignments.
- Documents (/manager/documents): "Upload document" (title, linked record, category, file); "Download" produces a
  signed link that expires in minutes.
- Templates (/manager/templates): "New template", variables as `{{name}}`, "Submit for approval"; counsel approves
  high-risk templates; "Render" previews with sample values.

## When you are blocked

Denied state where you expect access, a stuck lease approval, a vendor who cannot see a job: use
[../runbooks/support-escalation.md](../runbooks/support-escalation.md).
