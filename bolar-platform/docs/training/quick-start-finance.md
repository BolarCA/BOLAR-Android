# Quick start: bookkeeper portal (/finance)

Demo account books@demo.bolar.test. Every invoice, payment, void and refund posts a balanced double-entry journal;
the portal shows you the proof so you never have to trust it blindly.

## 1. Ledger dashboard (/finance)

Screenshot (described): heading "Ledger dashboard"; KPI strip (open receivables, collected this month, overdue,
"Balanced"); a "Double-entry proof" card that reads "Ledger balances"; "Receivables aging by tenant"; "Recent
payments"; an "Exceptions" list with failed payments; an "Adjustment approval queue" for refunds and manual entries
awaiting a second approver; a note that payments run in mock mode on staging.

## 2. Invoices (/finance/invoices)

Screenshot (described): heading "Invoices"; a table with number, tenant, period, due date, total, paid, status;
"Generate invoices" opens "Generate rent invoices" with a Period (YYYY-MM) field and shows "Created N invoice(s)";
an invoice detail shows lines by account and "Issue invoice" or "Void invoice" depending on state.

- Generation is idempotent per lease and period: running it twice creates nothing new and reports skipped.
- Invoices are only generated inside the lease term.

## 3. Payments (/finance/payments)

Screenshot (described): heading "Payments"; a table with invoice, provider, method, amount, status (succeeded,
failed, refunded) and reason for failures; "Record a payment" for offline receipts; "Refund (approval-gated)" on a
succeeded payment shows "Adjustment submitted".

- Refunds and manual adjustments wait for someone with `finance:approve_adjustment` who is not you.
- Provider webhooks are deduplicated by event id, so a replayed webhook never double-posts.

## 4. Ledger (/finance/ledger)

Screenshot (described): heading "Ledger"; trial balance table with status "Balanced"; "Journal entries" table with
type (invoice, payment, adjustment), memo, debit and credit totals and "Reverse" on posted entries; "Request a
manual adjustment" form with lines.

- An unbalanced adjustment is refused on submit. Reversals post a mirrored entry; nothing is edited in place.

## Month-end

1. Dashboard proof "Ledger balances" and trial balance "Balanced".
2. Clear the Exceptions list (failed payments retried or written off through an approved adjustment).
3. Export the audit manifest for the period (`GET /audit/export`) and attach it to the close record.

Questions on accounts or state rules for deposits: counsel review items in
[../counsel-review-map.md](../counsel-review-map.md); support path in
[../runbooks/support-escalation.md](../runbooks/support-escalation.md).
