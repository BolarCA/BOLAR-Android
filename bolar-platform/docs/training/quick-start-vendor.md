# Quick start: vendor portal (/vendor)

Demo account vendor@demo.bolar.test. You see only the work orders assigned to your company, and only while they are
assigned to you.

## 1. My jobs (/vendor)

Screenshot (described): heading "My jobs"; KPI cards "Active jobs", "Scheduled today", "Overdue"; a table with job
title, property and unit, priority, SLA due, scheduled time and status; each title is a link.

- A job disappears from the list when the manager unassigns it or marks it complete.

## 2. Job details (/vendor/jobs/<id>)

Screenshot (described): heading "Job details" with the work order title; property, unit, requester, entry
permission, SLA due and scheduled time; action buttons that depend on status ("Start work", "Mark blocked", "Submit
for review"); a notes section with an add-note field; a timeline of every status change and note; an "Add photo"
field that may show "Photo storage is not available in this build".

1. Arrive on site, click "Start work".
2. Cannot continue (part on order, no access): "Mark blocked" and type the reason; it is shown to the manager and
   recorded on the timeline.
3. Done: enter the actual cost where asked and "Submit for review". The manager completes the job after checking the
   work; you cannot mark complete yourself.

## 3. Jobs that are not yours

Opening a job that is not assigned to you shows the denied state. The manager assigns or reassigns jobs; call them if
you believe one is missing.

## 4. Sidebar items not yet available

"Schedule" and "Documents" appear in the sidebar but open a not-found page in this release; use "My jobs" and the
job page. Your insurance certificate and MSA are uploaded by the property manager on your vendor record.

## Rules of the road

- Keep your insurance certificate current; an expired certificate makes you ineligible for new assignments.
- Suspended vendors keep current jobs but receive no new ones.

Support: your property manager (tier 1), then [../runbooks/support-escalation.md](../runbooks/support-escalation.md).
