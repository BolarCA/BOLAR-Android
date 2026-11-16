# Quick start: compliance portal (/compliance)

Demo account compliance@demo.bolar.test. The compliance portal is the human side of policy-as-code: the rule engine
flags, you decide, and counsel approves rule changes.

## 1. Review queue (/compliance)

Screenshot (described): heading "Compliance review queue"; rows with the rule key as code, result (block, warn,
review), the resource (lease, listing, notice, application), age, an "Evidence for <key>" button and an "Accept"
button; an "Export manifest" button in the header.

1. "Evidence for ..." opens a drawer with "Conditions matched", the facts the rule saw, and a link to the statute.
2. "Accept" asks for a resolution note; the note lands in the audit log with your name.
3. "Export manifest" downloads a JSON file with every evaluation, its evidence and a hash for auditors.

## 2. Rules (/compliance/rules)

Screenshot (described): heading "Compliance rules"; sections per jurisdiction (US, US-TX, US-CA); each rule shows
key, title, version, status (draft, active, retired), action level, effective date and source URL; actions "New
rule", "New version", "Preview against sample facts", "Activate", "Retire".

- Only active versions evaluate. Draft a new version, preview it against sample facts, and activate only after
  counsel signs the review item in [../counsel-review-map.md](../counsel-review-map.md). Activation retires the
  previous version and is audited.

## 3. Notices (/compliance/notices)

Screenshot (described): heading "Notice approvals"; a status filter; cards "Awaiting an approver" with the notice
kind, recipient, drafter and the rendered body; "Approve" and "Reject" (reject asks for a reason).

- You can approve any drafter's notice except your own. Open guard hits must be resolved first.

## 4. Screening and adverse action oversight

Applications live in the manager portal (`/manager/applications`). Review that consent was recorded before any
screening order, that denials carry reason codes, and that the adverse action waiting period is respected before the
final notice. Counsel's checklist for screening is in [../counsel-review-map.md](../counsel-review-map.md).

## Weekly routine

1. Clear the queue or document why an item stays open.
2. Check overdue privacy requests with the org admin ([../runbooks/privacy-request.md](../runbooks/privacy-request.md)).
3. Export the manifest and file it with the compliance evidence.

Support path: [../runbooks/support-escalation.md](../runbooks/support-escalation.md).
