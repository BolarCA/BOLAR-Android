# UAT script: lawyer (/legal)

| | |
| --- | --- |
| Persona | Counsel: privileged cases, legal holds, agency request review, evidence packet exports, privacy request decisions, sensitive-access approvals, high-risk template approvals |
| Demo account | legal@demo.bolar.test ("Luis Lawyer"), password `Bolar!Demo2026` |
| Portal | `/legal` with Cases, Legal holds, Privacy requests, Access approvals |
| Automated by | `tests/e2e/governance.spec.ts`, `tests/e2e/documents.spec.ts` (template approval) |
| Estimated time | 45 minutes; counsel observes |

## Preconditions

- [last-run.md](last-run.md) GREEN.
- Seed present: case "Maple Court 101 - non-payment (demo)" (eviction, open, linked to the active lease, Luis as lead
  through a `represents` edge) with two deadlines; an active legal hold on that case; an agency records request in
  legal review from Gia Government; a privacy access request in discovery; retention assignments on the seeded
  documents and lease.
- The government tester has submitted a new records request (government script step 4) and the property manager has
  submitted a template for approval (property-manager script step B10).
- An org admin (orgadmin@demo.bolar.test) is available for the export approval in step 9.

## Steps

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| 1 | Sign in as legal@demo.bolar.test | Lands on `/legal`, heading "Legal case workspace"; the seeded case is listed as a link | | |
| 2 | Click "New case": Title `UAT dispute <initials>`, Kind dispute, Lease id of the Maple Court 101 lease (copy it from the seeded case), "Open case" | "Case ... opened" with the link "Open the case" | | |
| 3 | Open the case | Banner "Privileged and confidential"; the case heading; deadlines and timeline sections | | |
| 4 | "Place legal hold": Reason "Anticipated litigation; preserve the lease file and communications.", Counsel approval note, "Create hold" | Text "legal hold active" on the case | | |
| 5 | Open Legal holds | Heading "Legal holds"; a row "Hold: UAT dispute ..." plus the seeded hold | | |
| 6 | As the org admin, try to dispose a retention assignment on the held lease (`/subaccount/retention`) | Disposition is refused or marked held; nothing deleted (`GET /legal-holds/check` says held) | | |
| 7 | Try to release the hold you created in step 4 | Refused: "A hold must be released by different counsel than the one who created it"; the seeded hold (created by Luis) is likewise not releasable by Luis | | |
| 8 | On the agency request submitted by the government tester fill "Minimization notes", click "Legal review for <agency>", then "Decision note" and "Approve <agency>" | Row moves `received` to `legal review` to `approved` | | |
| 9 | Open the seeded case, click "Request export" | "Awaiting a different approver"; the request is not released by you | | |
| 10 | A second person with `export:approve` releases it: another lawyer who can open the case sees "Approve export" on the case page; in the demo org (one lawyer) the org admin approves through the API `POST /exports/<id>/approve {"note": "..."}` (id from `GET /exports?sourceType=case&sourceId=<caseId>&status=requested`) | After reload the export manifest card shows `sha256` and "Download manifest"; the download is a short-lived signed link | | |
| 11 | Try approving your own export request with your token | 403 or 409: approver must differ from requester | | |
| 12 | Open Access approvals, approve the property manager's pending request for 8 hours | Grant active; the manager can reveal the fields; your decision is audited | | |
| 13 | Approve the property manager's template version through the API (`POST /templates/:id/versions/:versionId/approve`) or the Templates page if the legal role shows it | Version `approved`; the manager can render it | | |
| 14 | Open Privacy requests | Heading "Privacy requests"; the seeded request in `discovery`; the deletion request created by the public intake (governance spec) in `identity verification` with "Nd left" | | |
| 15 | Open a request in `discovery`, run "Review exceptions" and read the result | Exceptions list `legal_hold` items from the seeded hold, `retention` for the lease, `audit_log` and the `third_party` processors in mock mode | | |
| 16 | Decide `partial` with a note, then "Fulfil request" | Manifest with `sha256` and a confirmation draft rendered from `privacy.confirmation`; held items listed as skipped; audit rows for decision and fulfilment | | |
| 17 | Sign in as gov@demo.bolar.test and open `/legal` | Denied state | | |

## Business rules to confirm

- Privileged case data is only visible to lawyers with a `represents` edge or the org admin; a government user never
  reaches it.
- Legal hold blocks disposition and deletion everywhere (`isHeld`), and release needs a second person.
- Agency requests follow received, legal review, approved or denied, fulfilled; minimization notes are mandatory.
- Export release and privacy decisions require an approver who is not the requester; every step is audited and the
  manifest carries a hash.

## Severity guidance

Steps 6, 9 to 11, 16, 17 failing are S1. Steps 2 to 5, 8, 12 to 15 are S2. Step 1 is S3 unless the seeded case is
missing (environment). Rubric: [defect-triage.md](defect-triage.md).

## Sign-off

| Field | Value |
| --- | --- |
| Tester (name, role) and observing counsel | |
| Build commit (from last-run.md) | |
| Date and environment | |
| Steps passed / total | / 17 |
| Defects filed (issue numbers, severity) | |
| Tester verdict (pass / pass with S3-S4 / fail) | |
