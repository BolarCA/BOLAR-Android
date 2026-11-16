# UAT script: government (/gov, restricted portal)

| | |
| --- | --- |
| Persona | Agency user who submits records requests and, once counsel approves, downloads the released export manifest; never sees anything else |
| Demo account | gov@demo.bolar.test ("Gia Government"), password `Bolar!Demo2026` |
| Portal | `/gov` ("Agency requests") and `/gov/exports` |
| Automated by | `tests/e2e/governance.spec.ts` ("agency request review gate", "restricted portal gating") |
| Estimated time | 15 minutes plus the counsel hand-off |

## Preconditions

- [last-run.md](last-run.md) GREEN.
- Seed present: an agency records request in `legal review` filed by Gia.
- The lawyer tester is available to run legal review and approve (lawyer script step 8).

## Steps

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| 1 | Sign in as gov@demo.bolar.test | Lands on `/gov`, heading "Agency requests"; the text "Stored-data gate" explains that only approved, minimized exports are released; the seeded request is listed | | |
| 2 | Read the sidebar | Only Requests and Exports; no other portal is offered in the switcher | | |
| 3 | Submit the form: Agency name `UAT Housing Board`, Kind records, Legal basis "Municipal code 12.4 annual inspection records review.", Scope description "Inspection history for the current year only.", "Submit request" | "Request submitted for legal review"; the row shows `received` | | |
| 4 | Submit again with an empty legal basis | Validation error; no request created | | |
| 5 | Hand off to the lawyer tester (their step 8), then reload | The row shows `legal review`, then `approved` with the decision note | | |
| 6 | Open Exports | Heading "Exports" with the explanation that each export is a signed manifest with hashes, filters, redaction and reviewer; before any release the state "No export access" is shown | | |
| 7 | After counsel fulfils the approved request and an export is released, reload Exports | The export is listed; "Download manifest" gives a short-lived link; the manifest lists files, hashes, redaction and the reviewer; the download is audited | | If no release happens in the session, record the step as not exercised |
| 8 | Paste `/legal`, `/manager`, `/subaccount` URLs | Denied state on each; no `/cases`, `/legal-holds`, `/privacy-requests` requests | | |
| 9 | Call `GET /cases` with the government token (UAT lead runs it) | 403; an `access.denied` audit row is written | | |
| 10 | Sign out, open `/gov` | Redirected to `/login` | | |

## Business rules to confirm

- Government users only reach the agency request workflow and released exports; the legal workspace, tenant data and
  documents are never exposed (relationship `agency_for` and the `government` role).
- Requests move received, legal review, approved or denied, fulfilled; counsel's minimization notes and decision note
  are mandatory and audited.
- Exports are released only after a second approver and come with a hashed manifest.

## Severity guidance

Steps 8 and 9 failing are S1. Steps 3, 5, 7 are S2. Steps 1, 2, 4, 6, 10 are S3. Rubric:
[defect-triage.md](defect-triage.md).

## Sign-off

| Field | Value |
| --- | --- |
| Tester (name, agency role) and observing counsel | |
| Build commit (from last-run.md) | |
| Date and environment | |
| Steps passed / total | / 10 |
| Defects filed (issue numbers, severity) | |
| Tester verdict (pass / pass with S3-S4 / fail) | |
