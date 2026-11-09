'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { statusTone } from '@/components/ui';
import type { FinanceSummaryDto, InvoiceAgingDto, InvoiceDetailDto, InvoiceDto, JournalEntryDto, LedgerAccountDto, LedgerProofDto, PaymentDetailDto, PaymentDto, TrialBalanceDto } from '@bolar/contracts';
import { api, newIdempotencyKey } from '../api-client';
import { usePagedList } from './iam';

export type { FinanceSummaryDto, InvoiceAgingDto, InvoiceDetailDto, InvoiceDto, JournalEntryDto, LedgerAccountDto, LedgerProofDto, PaymentDetailDto, PaymentDto, TrialBalanceDto };
export interface LedgerAccountEntryDto { id: string; journalEntryId: string; accountCode: string; accountName: string; propertyId: string | null; debitCents: number; creditCents: number; memo: string | null; postedAt: string | null; sourceType: string; sourceId: string; journalMemo: string | null }

export const OUTSTANDING = ['open', 'partially_paid', 'overdue'] as const;
export const isOutstanding = (status: string) => (OUTSTANDING as readonly string[]).includes(status);
export function fmtCents(cents: number): string { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100); }
export function fmtDate(iso: string | null | undefined): string { return iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—'; }
export function periodFromOffset(offsetMonths: number): string { const d = new Date(); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`; }

// ---- dashboard / ledger ----
export const useFinanceSummary = () => useQuery({ queryKey: ['finance', 'summary'], queryFn: () => api<FinanceSummaryDto>('/finance/summary') });
export const useLedgerProof = () => useQuery({ queryKey: ['finance', 'proof'], queryFn: () => api<LedgerProofDto>('/ledger/proof') });
export const useTrialBalance = () => useQuery({ queryKey: ['finance', 'trial-balance'], queryFn: () => api<TrialBalanceDto>('/ledger/trial-balance') });
export const useAccounts = (params: { type?: string } = {}) => usePagedList<LedgerAccountDto>(['finance', 'accounts'], '/accounts', params);
export const useAccountEntries = (accountId: string | null) => usePagedList<LedgerAccountEntryDto>(['finance', 'account-entries', accountId ?? ''], `/ledger/accounts/${accountId}/entries`, {}, !!accountId);
export const useJournalEntries = (params: { status?: string; sourceType?: string } = {}) => usePagedList<JournalEntryDto>(['finance', 'journal'], '/journal-entries', params);

function useFinanceMutation<TVars, TOut>(fn: (vars: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ['finance'] }) });
}
export const useApproveJournal = () => useFinanceMutation((id: string) => api<JournalEntryDto>(`/journal-entries/${id}/approve`, { method: 'POST' }));
export const useReverseJournal = () => useFinanceMutation(({ id, reason }: { id: string; reason: string }) => api<JournalEntryDto>(`/journal-entries/${id}/reverse`, { method: 'POST', body: { reason } }));
export const useCreateJournalEntry = () => useFinanceMutation((body: { sourceType: 'adjustment' | 'opening_balance'; memo: string; lines: { accountCode: string; debitCents?: number; creditCents?: number; memo?: string }[] }) => api<JournalEntryDto>('/journal-entries', { method: 'POST', body }));
export const useSeedDefaultAccounts = () => useFinanceMutation(() => api<{ created: number; existing: number }>('/accounts/seed-default', { method: 'POST' }));

// ---- invoices ----
export const useInvoices = (params: { status?: string; leaseId?: string; overdue?: string; q?: string } = {}, enabled = true) => usePagedList<InvoiceDto>(['finance', 'invoices'], '/invoices', params, enabled);
export const useInvoice = (id: string | null) => useQuery({ queryKey: ['finance', 'invoice', id], queryFn: () => api<InvoiceDetailDto>(`/invoices/${id}`), enabled: !!id });
export const useInvoiceAging = () => useQuery({ queryKey: ['finance', 'aging'], queryFn: () => api<InvoiceAgingDto>('/invoices/aging') });
export const useGenerateInvoices = () => useFinanceMutation((period: string) => api<{ period: string; created: number; skipped: number; invoiceIds: string[] }>('/invoices/generate', { method: 'POST', body: { period } }));
export const useIssueInvoice = () => useFinanceMutation((id: string) => api<InvoiceDetailDto>(`/invoices/${id}/issue`, { method: 'POST' }));
export const useVoidInvoice = () => useFinanceMutation(({ id, reason }: { id: string; reason: string }) => api<InvoiceDetailDto>(`/invoices/${id}/void`, { method: 'POST', body: { reason } }));
export const useMarkOverdue = () => useFinanceMutation(() => api<{ updated: number }>('/invoices/mark-overdue', { method: 'POST' }));
export const useCreateInvoice = () => useFinanceMutation((body: { leaseId: string; dueDate: string; lines: { description: string; accountCode?: string; amountCents: number }[] }) => api<InvoiceDetailDto>('/invoices', { method: 'POST', body }));

// ---- payments ----
export const usePayments = (params: { status?: string; invoiceId?: string } = {}) => usePagedList<PaymentDto>(['finance', 'payments'], '/payments', params);
export const usePayment = (id: string | null) => useQuery({ queryKey: ['finance', 'payment', id], queryFn: () => api<PaymentDetailDto>(`/payments/${id}`), enabled: !!id });
/** One idempotency key per attempt; the same key replays the same payment if the request is retried. */
export const useCreatePayment = () => useFinanceMutation(({ idempotencyKey, ...body }: { invoiceId: string; amountCents: number; method: string; paymentMethodRef: string; idempotencyKey?: string }) => api<PaymentDetailDto>('/payments', { method: 'POST', body, idempotencyKey: idempotencyKey ?? newIdempotencyKey() }));
export const useRefundPayment = () => useFinanceMutation(({ id, amountCents, reason }: { id: string; amountCents: number; reason: string }) => api<PaymentDetailDto>(`/payments/${id}/refund`, { method: 'POST', body: { amountCents, reason } }));

/** Shared `warning` badge palette fails WCAG AA contrast on these dense screens; finance maps it to `danger`. */
export function financeTone(status: string): ReturnType<typeof statusTone> { const t = statusTone(status); return t === 'warning' ? 'danger' : t; }
