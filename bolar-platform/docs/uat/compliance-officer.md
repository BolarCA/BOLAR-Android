# UAT script: compliance officer (/compliance)

| | |
| --- | --- |
| Persona | Reviews rule hits with evidence, approves or rejects notices, maintains the policy-as-code rule catalog, exports evidence manifests |
| Demo account | compliance@demo.bolar.test ("Cam Compliance"), password `Bolar!Demo2026` |
| Portal | `/compliance` with Queue, Rules, Notices |
| Automated by | `tests/e2e/compliance.spec.ts` ("compliance officer queue", "denied") |
| Estimated time | 30 minutes; counsel observes |

## Preconditions

- [last-run.md](last-run.md) GREEN.
- Seed present: rule evaluations `us-ca.deposit.max_one_month` (block) and a late-fee warning on a Sunset Bungalows
  lease, a source-of-income review hit on a Riverside listing; the active rule catalog grouped by jurisdiction
  (`US`, `US-CA`, `US-TX`); a late-rent notice created by the manager in `pending_approval`; the property manager
  tester has created the voucher-language notice (property-manager script step B6) and the screening journey (B1 to B5).

## Steps

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| 1 | Sign in as compliance@demo.bolar.test | Lands on `/compliance`, heading "Compliance review queue"; rows show rule key (as code), severity or result (block, warn, review), resource and age | | |
| 2 | Click "Evidence for ..." on the `us-ca.deposit.max_one_month` row | Drawer with "Conditions matched" (deposit greater than rent, 360000 versus 180000), the facts, and a source link to the statute that opens in a new tab | | |
| 3 | "Close panel" | Focus returns to the row's button | | |
| 4 | Click "Accept" on the SOI row raised by the manager's notice, type the resolution note, "Confirm" | Row leaves the open queue; the audit log records the resolution with your note; the manager's notice row no longer shows an unresolved hit | | |
| 5 | Try to confirm a resolution with an empty note | Confirm is refused until a note is typed | | |
| 6 | Click "Export manifest" | A file `compliance-manifest-<date>.json` downloads with the evaluations, evidence and a hash | | |
| 7 | Open Rules | Heading "Compliance rules"; sections per jurisdiction including "US-CA" with `us-ca.deposit.max_one_month`; each rule shows version, status, action level and source URL | | |
| 8 | Open a rule and start "New version" with a changed threshold, save as draft | A new draft version exists; the previous version stays `active`; nothing evaluates against the draft | | |
| 9 | Try to activate the draft | Activation needs `compliance:approve` and a note; the activation is audited and the old version is retired | | Counsel confirms the version history matches `docs/counsel-review-map.md` |
| 10 | Open Notices | Heading "Notice approvals"; the seeded late-rent notice "Awaiting an approver" with Approve and Reject | | |
| 11 | Reject the manager's voucher-language notice with a reason | Status `rejected`; the manager sees the reason; the notice cannot be sent | | |
| 12 | Approve the seeded late-rent notice | Status `approved`; the manager can now send it; the audit row names you as approver | | |
| 13 | Ask the manager tester to draft and immediately submit a notice, then approve it yourself in a window where you are signed in as manager@demo.bolar.test | Refused: approver must differ from the creator | | |
| 14 | Review the adverse action created by the manager (property-manager script B5) through `/manager/applications` as org admin or through `GET /adverse-actions` | Stage `pre_adverse` with the waiting period end date; "Advance" is disabled or refused before the waiting period ends | | |
| 15 | Sign in as vendor@demo.bolar.test and open `/compliance` | Denied state | | |

## Business rules to confirm

- Only counsel-reviewed, active rule versions evaluate; blocks are reserved for statutory limits; every evaluation
  stores evidence with the rule version and a source link.
- Notices never send without approval by someone other than the drafter; guard hits must be resolved first.
- Adverse action stages (pre-adverse, waiting period, final) are advanced by a human and never by automation.
- The manifest export is hashed so auditors can verify it later.

## Severity guidance

Steps 11 to 15 failing are S1 (regulatory control). Steps 2, 4, 6, 8, 9 are S2. Steps 1, 3, 5, 7, 10 are S3.
Rubric: [defect-triage.md](defect-triage.md).

## Sign-off

| Field | Value |
| --- | --- |
| Tester (name, role) and observing counsel | |
| Build commit (from last-run.md) | |
| Date and environment | |
| Steps passed / total | / 15 |
| Defects filed (issue numbers, severity) | |
| Tester verdict (pass / pass with S3-S4 / fail) | |
