# UAT script: bookkeeper (/finance)

| | |
| --- | --- |
| Persona | Finance staff who issue rent invoices, record and review payments and keep the double-entry ledger balanced |
| Demo account | books@demo.bolar.test ("Bea Bookkeeper"), password `Bolar!Demo2026` |
| Portal | `/finance` with Dashboard, Invoices, Payments, Ledger |
| Automated by | `tests/e2e/finance.spec.ts` |
| Estimated time | 30 minutes |

## Preconditions

- [last-run.md](last-run.md) GREEN.
- Seed present: chart of accounts (1000 Operating Cash, 1100 Accounts Receivable, 1200 deposits held, 2100 deposits
  liability, 4000 Rental Income and others); invoices INV-000000 (paid, ACH) and INV-000001 (open) on the Maple Court
  101 lease; a failed mock card payment (`card_declined`) on the open invoice; journal entries keyed
  `invoice:<id>:issue` and `payment:<id>:succeeded` so the ledger balances.
- The tenant tester has not yet paid INV-000001 in this session, or the tester accepts that the balance will differ.

## Steps

| # | Action | Expected result | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| 1 | Sign in as books@demo.bolar.test | Lands on `/finance`, heading "Ledger dashboard"; the double-entry proof card reads "Ledger balances" with a balanced state; KPI strip says "Balanced" | | |
| 2 | Open Invoices | Heading "Invoices"; table lists INV-000000 `paid` and INV-000001 `open` for Theo Tenant with amounts $1,450.00 | | |
| 3 | Click "Generate invoices", Period = the first month after the latest existing invoice (format YYYY-MM), "Generate" | "Created N invoice" with N at least 1; the new invoice appears with a due date on the first of that month | | |
| 4 | Generate the same period again | "Created 0", skipped at least 1 (idempotent per lease and period) | | |
| 5 | Generate a period after the lease end date | Created 0; no invoice outside the lease term | | |
| 6 | Open the invoice created in step 3 | Line "Monthly rent" on account 4000; status `open`; "Void invoice" is offered (it is absent on the paid INV-000000) | | |
| 7 | Click "Void invoice" | Status `void`; the dashboard proof is still balanced (reversal posted) | | |
| 8 | Open Payments | The seeded `succeeded` ACH payment and the `failed` card payment (`card_declined`) are listed with provider `mock` | | |
| 9 | After the tenant tester pays INV-000001 (tenant script step 5), reload Payments and Invoices | A new `succeeded` payment; INV-000001 shows `paid`; a journal entry of type payment exists | | |
| 10 | Open Ledger | Heading "Ledger"; trial balance status "Balanced"; "Accounts Receivable" row present; Journal entries table includes entries of type `payment` and `invoice` | | |
| 11 | Read "Receivables aging by tenant" on the dashboard | Theo Tenant's open balance equals the open invoices minus payments; buckets match the due dates | | |
| 12 | Under "Request a manual adjustment" enter lines whose debits and credits differ, submit | Refused with a validation error; nothing is posted | | |
| 13 | On the succeeded payment click "Refund (approval-gated)" with a reason | "Adjustment submitted"; it waits in the "Adjustment approval queue" for a second person with `finance:approve_adjustment`; after the org admin clicks "Approve" the card reads "Refund recorded and reversed in the ledger" | | |
| 14 | Sign in as vendor@demo.bolar.test and open `/finance` | Denied state; no `/finance/summary`, `/ledger`, `/invoices` or `/payments` requests | | |

## Business rules to confirm

- Invoice generation is idempotent per lease and period; invoices cover only the lease term.
- Every issued invoice, payment and void posts a balanced journal entry; the proof endpoint (`GET /ledger/proof`)
  never reports an imbalance.
- Refunds and adjustments require a second approver; webhooks are deduplicated by provider event id.
- Payments run against the mock adapter; `STRIPE_MODE=production` is refused outside production.

## Severity guidance

Steps 4, 7, 10, 12, 13, 14 failing are S1 (money or control integrity). Steps 3, 6, 8, 9, 11 are S2. Steps 1, 2, 5
are S3 unless the figures are wrong (S2). Rubric: [defect-triage.md](defect-triage.md).

## Sign-off

| Field | Value |
| --- | --- |
| Tester (name, role) | |
| Build commit (from last-run.md) | |
| Date and environment | |
| Steps passed / total | / 14 |
| Defects filed (issue numbers, severity) | |
| Tester verdict (pass / pass with S3-S4 / fail) | |
