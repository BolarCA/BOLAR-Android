# Quick start: lawyer portal (/legal)

Demo account legal@demo.bolar.test. The legal portal holds privileged cases, legal holds, privacy request decisions,
agency request review and sensitive-access approvals. Everything is audited and most decisions need a second person.

## 1. Cases (/legal)

Screenshot (described): heading "Legal case workspace"; a list of cases you represent with kind, status and
deadlines; a "New case" dialog (Title, Kind, Lease id); below the list, the agency requests table with per-row
"Minimization notes", "Legal review for <agency>", "Decision note", "Approve <agency>" and a deny action.

- A case page carries the banner "Privileged and confidential" and shows deadlines, the timeline, linked lease and
  property, legal hold status and evidence exports.

## 2. Legal holds (case page and /legal/legal-holds)

Screenshot (described): "Place legal hold" dialog with Reason and Counsel approval note; the holds page lists each
hold with scope and status and a release action.

- A hold blocks deletion and disposition across the platform for everything in scope (`isHeld`).
- Release must be done by different counsel than the one who created the hold.

## 3. Evidence exports (case page)

Screenshot (described): "Request export" button; a card per export with status, "Approve export" visible only to a
different approver, and after release a manifest with `sha256` and "Download manifest".

- The requester never releases their own packet. Downloads are short-lived signed links and are audited.

## 4. Privacy requests (/legal/privacy-requests)

Screenshot (described): heading "Privacy requests"; table with subject email, kind, status, "Nd left" countdown; a
drawer with "Run discovery", "Review exceptions", decision (approved, partial, denied with mandatory note), "Fulfil
request" and the manifest and confirmation draft.

- Procedure and SLAs: [../runbooks/privacy-request.md](../runbooks/privacy-request.md). The decider can never be the
  request's creator.

## 5. Access approvals (/legal/access-requests)

Screenshot (described): "Sensitive access requests" with "Approve 8h" and "Deny" per request.

- Approve restricted data (screening reports) only with a documented purpose; grants expire in eight hours.

## 6. Template and rule approvals

High-risk templates (`/manager/templates`, counsel approves a submitted version) and compliance rule activation
(`/compliance/rules`) need your sign-off; the checklist is in
[../counsel-review-map.md](../counsel-review-map.md).

Support path: [../runbooks/support-escalation.md](../runbooks/support-escalation.md) (legal matters escalate to
tier 3 with counsel on the call).
