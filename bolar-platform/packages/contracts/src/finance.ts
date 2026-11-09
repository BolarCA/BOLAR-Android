// finance contracts (blueprint Days 36-40, schema p20, API p31): chart of accounts, ledger, invoices, payments, bank links.
import { z } from './openapi-zod.js';
import { centsSchema, idSchema, isoDateSchema, pageOf, paginationQuery } from './common.js';

// ───────── Chart of accounts (Day 36) ─────────
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export const accountCodeSchema = z.string().regex(/^\d{4}$/, 'Account code must be 4 digits');

export const ledgerAccount = z
  .object({ id: idSchema, code: z.string(), name: z.string(), type: accountTypeSchema, isSystem: z.boolean(), propertyId: idSchema.nullable(), parentId: idSchema.nullable(), createdAt: z.string() })
  .openapi('LedgerAccount');
export const ledgerAccountPage = pageOf(ledgerAccount, 'LedgerAccount');
export const ledgerAccountQuery = paginationQuery.extend({ type: accountTypeSchema.optional(), q: z.string().max(60).optional() });
export const createLedgerAccount = z
  .object({ code: accountCodeSchema, name: z.string().trim().min(1).max(120), type: accountTypeSchema, propertyId: idSchema.optional(), parentId: idSchema.optional() })
  .openapi('CreateLedgerAccount');
export const updateLedgerAccount = z
  .object({ name: z.string().trim().min(1).max(120).optional(), type: accountTypeSchema.optional(), propertyId: idSchema.nullable().optional(), parentId: idSchema.nullable().optional() })
  .openapi('UpdateLedgerAccount');
export const seedDefaultAccountsResponse = z.object({ created: z.number().int(), existing: z.number().int(), accounts: z.array(ledgerAccount) }).openapi('SeedDefaultAccountsResponse');

// ───────── Ledger posting engine (Day 37) ─────────
export const JOURNAL_SOURCE_TYPES = ['invoice', 'payment', 'adjustment', 'reversal', 'opening_balance'] as const;
export const journalSourceTypeSchema = z.enum(JOURNAL_SOURCE_TYPES);

export const journalLineInput = z
  .object({ accountCode: accountCodeSchema, debitCents: centsSchema.default(0), creditCents: centsSchema.default(0), propertyId: idSchema.optional(), memo: z.string().max(240).optional() })
  .openapi('JournalLineInput');
export const ledgerLine = z
  .object({ id: idSchema, journalEntryId: idSchema, accountId: idSchema, accountCode: z.string(), accountName: z.string(), propertyId: idSchema.nullable(), debitCents: z.number().int(), creditCents: z.number().int(), memo: z.string().nullable() })
  .openapi('LedgerLine');
export const journalEntry = z
  .object({
    id: idSchema, sourceType: journalSourceTypeSchema, sourceId: z.string(), memo: z.string().nullable(), idempotencyKey: z.string().nullable(), reversalOfId: idSchema.nullable(),
    postedBy: idSchema.nullable(), postedAt: z.string().nullable(), status: z.enum(['posted', 'pending']), createdAt: z.string(), totalDebitCents: z.number().int(), totalCreditCents: z.number().int(), lines: z.array(ledgerLine),
  })
  .openapi('JournalEntry');
export const journalEntryPage = pageOf(journalEntry, 'JournalEntry');
export const journalEntryQuery = paginationQuery.extend({ sourceType: journalSourceTypeSchema.optional(), status: z.enum(['posted', 'pending']).optional(), from: isoDateSchema.optional(), to: isoDateSchema.optional() });
/** Manual entries. `adjustment` is created pending and must be approved by a different user holding finance:approve_adjustment. */
export const createJournalEntry = z
  .object({ sourceType: z.enum(['adjustment', 'opening_balance']).default('adjustment'), sourceId: z.string().min(1).max(64).default('manual'), memo: z.string().trim().min(3).max(500), idempotencyKey: z.string().min(8).max(128).optional(), lines: z.array(journalLineInput).min(2).max(200) })
  .openapi('CreateJournalEntry');
export const reverseJournalEntry = z.object({ reason: z.string().trim().min(3).max(500) }).openapi('ReverseJournalEntry');
export const trialBalanceRow = z
  .object({ accountId: idSchema, code: z.string(), name: z.string(), type: accountTypeSchema, debitCents: z.number().int(), creditCents: z.number().int(), balanceCents: z.number().int() })
  .openapi('TrialBalanceRow');
export const trialBalance = z.object({ rows: z.array(trialBalanceRow), totalDebitCents: z.number().int(), totalCreditCents: z.number().int(), balanced: z.boolean(), asOf: z.string() }).openapi('TrialBalance');
export const ledgerProof = z
  .object({ totalDebitCents: z.number().int(), totalCreditCents: z.number().int(), balanced: z.boolean(), postedEntries: z.number().int(), unbalancedEntries: z.number().int(), pendingEntries: z.number().int(), checkedAt: z.string() })
  .openapi('LedgerProof');
export const ledgerAccountEntry = ledgerLine.extend({ postedAt: z.string().nullable(), sourceType: journalSourceTypeSchema, sourceId: z.string(), journalMemo: z.string().nullable(), runningBalanceCents: z.number().int().optional() }).openapi('LedgerAccountEntry');
export const ledgerAccountEntryPage = pageOf(ledgerAccountEntry, 'LedgerAccountEntry');

// ───────── Invoices and rent schedules (Day 38) ─────────
export const INVOICE_STATUSES = ['draft', 'open', 'partially_paid', 'paid', 'void', 'overdue'] as const;
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export const invoiceLine = z.object({ id: idSchema, description: z.string(), accountCode: z.string(), amountCents: z.number().int(), chargeId: idSchema.nullable() }).openapi('InvoiceLine');
export const invoice = z
  .object({
    id: idSchema, leaseId: idSchema, tenantProfileId: idSchema.nullable(), number: z.string(), status: invoiceStatusSchema, periodStart: z.string().nullable(), periodEnd: z.string().nullable(), dueDate: z.string(),
    totalCents: z.number().int(), paidCents: z.number().int(), balanceCents: z.number().int(), issuedAt: z.string().nullable(), voidedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
    tenantName: z.string().nullable(), propertyName: z.string().nullable(), unitNumber: z.string().nullable(),
  })
  .openapi('Invoice');
export const invoicePage = pageOf(invoice, 'Invoice');
export const invoiceQuery = paginationQuery.extend({
  status: invoiceStatusSchema.optional(), leaseId: idSchema.optional(), tenantProfileId: idSchema.optional(), dueBefore: isoDateSchema.optional(), dueAfter: isoDateSchema.optional(),
  overdue: z.enum(['true', 'false']).optional(), q: z.string().max(60).optional(),
});
export const PAYMENT_METHODS = ['ach', 'card', 'check', 'cash', 'other'] as const;
export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'refunded', 'disputed', 'canceled'] as const;
export const payment = z
  .object({
    id: idSchema, invoiceId: idSchema, invoiceNumber: z.string().nullable(), provider: z.string(), method: z.enum(PAYMENT_METHODS), status: z.enum(PAYMENT_STATUSES), amountCents: z.number().int(),
    /** Provider reference. Only returned to actors with bank:read; otherwise null. */
    externalId: z.string().nullable(), failureReason: z.string().nullable(), receivedAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
  })
  .openapi('Payment');
export const paymentEvent = z.object({ id: idSchema, type: z.string(), externalEventId: z.string(), processedAt: z.string().nullable(), createdAt: z.string(), payload: z.unknown().optional() }).openapi('PaymentEvent');
export const paymentDetail = payment.extend({ events: z.array(paymentEvent), invoice: z.object({ id: idSchema, number: z.string(), status: invoiceStatusSchema, totalCents: z.number().int(), paidCents: z.number().int() }) }).openapi('PaymentDetail');
export const paymentPage = pageOf(payment, 'Payment');
export const paymentQuery = paginationQuery.extend({ status: z.enum(PAYMENT_STATUSES).optional(), invoiceId: idSchema.optional(), method: z.enum(PAYMENT_METHODS).optional() });

export const invoiceDetail = invoice
  .extend({
    lines: z.array(invoiceLine),
    payments: z.array(payment),
    lease: z.object({ id: idSchema, status: z.string(), propertyId: idSchema, unitId: idSchema, propertyName: z.string(), unitNumber: z.string(), startDate: z.string(), endDate: z.string(), rentCents: z.number().int() }),
    tenant: z.object({ id: idSchema, displayName: z.string(), status: z.string() }).nullable(),
    journalEntryIds: z.array(idSchema),
  })
  .openapi('InvoiceDetail');
export const createInvoiceLine = z.object({ description: z.string().trim().min(1).max(240), accountCode: accountCodeSchema.default('4000'), amountCents: centsSchema.min(1) }).openapi('CreateInvoiceLine');
export const createInvoice = z
  .object({ leaseId: idSchema, dueDate: isoDateSchema, periodStart: isoDateSchema.optional(), periodEnd: isoDateSchema.optional(), lines: z.array(createInvoiceLine).min(1).max(50) })
  .openapi('CreateInvoice');
export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be YYYY-MM');
export const generateInvoices = z.object({ period: periodSchema }).openapi('GenerateInvoices');
export const generateInvoicesResponse = z.object({ period: periodSchema, created: z.number().int(), skipped: z.number().int(), invoiceIds: z.array(idSchema) }).openapi('GenerateInvoicesResponse');
export const agingBuckets = z.object({ currentCents: z.number().int(), d1to30Cents: z.number().int(), d31to60Cents: z.number().int(), d61to90Cents: z.number().int(), d90PlusCents: z.number().int(), totalCents: z.number().int() }).openapi('AgingBuckets');
export const invoiceAging = z
  .object({ asOf: z.string(), totals: agingBuckets, byTenant: z.array(agingBuckets.extend({ tenantProfileId: idSchema.nullable(), displayName: z.string(), invoiceCount: z.number().int() })) })
  .openapi('InvoiceAging');
export const markOverdueResponse = z.object({ updated: z.number().int(), asOf: z.string() }).openapi('MarkOverdueResponse');

// ───────── Payments and bank links (Day 39) ─────────
export const createPayment = z
  .object({ invoiceId: idSchema, amountCents: centsSchema.min(1), method: z.enum(PAYMENT_METHODS).default('card'), paymentMethodRef: z.string().trim().min(1).max(128) })
  .openapi('CreatePayment');
export const refundPayment = z.object({ amountCents: centsSchema.min(1), reason: z.string().trim().min(3).max(500) }).openapi('RefundPayment');
export const bankLinkTokenRequest = z.object({ products: z.array(z.enum(['auth', 'transactions'])).min(1).default(['auth']) }).openapi('BankLinkTokenRequest');
export const bankLinkToken = z.object({ linkToken: z.string(), expiresAt: z.string(), mode: z.enum(['mock', 'sandbox', 'production']) }).openapi('BankLinkToken');
export const bankLinkExchangeRequest = z.object({ publicToken: z.string().min(1).max(512) }).openapi('BankLinkExchangeRequest');
/** The raw access token is never returned or stored by this MVP; only an opaque reference and a masked account. */
export const bankLinkExchangeResult = z.object({ accessTokenRef: z.string(), accountMask: z.string(), institution: z.string(), persisted: z.literal(false), note: z.string() }).openapi('BankLinkExchangeResult');

// ───────── Dashboard summary (UI p53) ─────────
export const financeSummary = z
  .object({
    asOf: z.string(), openArCents: z.number().int(), openInvoices: z.number().int(), overdueCents: z.number().int(), overdueInvoices: z.number().int(), collectedThisMonthCents: z.number().int(),
    failedPayments30d: z.number().int(), pendingAdjustments: z.number().int(), trialBalanced: z.boolean(), unbalancedEntries: z.number().int(), paymentsMode: z.enum(['mock', 'sandbox', 'production']),
  })
  .openapi('FinanceSummary');

export type LedgerAccountDto = z.infer<typeof ledgerAccount>;
export type JournalEntryDto = z.infer<typeof journalEntry>;
export type InvoiceDto = z.infer<typeof invoice>;
export type InvoiceDetailDto = z.infer<typeof invoiceDetail>;
export type PaymentDto = z.infer<typeof payment>;
export type PaymentDetailDto = z.infer<typeof paymentDetail>;
export type TrialBalanceDto = z.infer<typeof trialBalance>;
export type LedgerProofDto = z.infer<typeof ledgerProof>;
export type InvoiceAgingDto = z.infer<typeof invoiceAging>;
export type FinanceSummaryDto = z.infer<typeof financeSummary>;
