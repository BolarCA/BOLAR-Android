# Quick start: government portal (/gov, restricted)

Demo account gov@demo.bolar.test. This portal exists so that an agency can file a records request and collect what
counsel releases, and nothing more. There is no access to residents, leases, documents or finance.

## 1. Requests (/gov)

Screenshot (described): heading "Agency requests"; an explanation panel "Stored-data gate" saying that stored data is
released only after legal review and minimization; a form with Agency name, Kind (records and others), Legal basis,
Scope description and "Submit request"; a table of your requests with status.

1. Fill all fields. Legal basis and scope are mandatory: counsel reads them during review.
2. After "Submit request" you see "Request submitted for legal review" and the status `received`.
3. Status moves to `legal review`, then `approved` or `denied` with the decision note, then `fulfilled` once an
   export is prepared.

## 2. Exports (/gov/exports)

Screenshot (described): heading "Exports" with the sentence that each export is a signed manifest (files, hashes,
audit events, filters, redaction, reviewer) and that downloads are short-lived and audited; before any release the
page shows "No export access".

- "Download manifest" appears when counsel has released an export for your request. Links expire within minutes;
  request a new one from the page if needed. Every download is audited.

## 3. What you will not see

Attempts to open other portals show the denied state and are logged. Questions about a request go to the
organization's counsel contact named in the decision note, not to BOLAR support.
