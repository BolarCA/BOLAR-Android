'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseInfiniteQueryResult } from '@tanstack/react-query';
import { LEASE_OCCUPYING_STATES, WORK_ORDER_OPEN_STATUSES } from '@bolar/contracts';
import type { FinanceSummaryDto, InvoiceDto, LeaseDto, PaymentDto, PropertyDto, WorkOrderDto } from '@bolar/contracts';
import { api, ApiError, setTokens } from '../api-client';
import { useAuth, useCan } from '../auth';
import { usePagedList, type Page } from './iam';
import { useLeases } from './lease';
import { isOutstanding, useInvoices } from './finance';
import { useWorkOrders } from './maintenance';
import { useNotifications, type NotificationDto } from './notification';
import { useProperties } from './property';
import type { DocumentDto } from './document';

/**
 * Portal home screens (blueprint Days 52-53) compose the domain hooks instead of adding API clients of their own.
 * This file holds the small amount of glue the two dashboards need: online state, MFA enrolment, the optional
 * staff-only finance summary, and the derived view models the components render.
 */

// ───────── connectivity ─────────
/** `navigator.onLine` as React state; true during SSR so the first paint never flashes the offline banner. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);
  return online;
}

// ───────── MFA (existing auth endpoints) ─────────
export interface MfaSetupDto { secret: string; otpauthUrl: string }
export const useMfaSetup = () => useMutation({ mutationFn: () => api<MfaSetupDto>('/auth/mfa/setup', { method: 'POST' }) });
/** Verifying a code returns a fresh token pair (session now MFA-verified); swap it in and refresh `/me` so `mfaEnabled` flips. */
export function useMfaVerify() {
  const qc = useQueryClient();
  const { me } = useAuth();
  return useMutation({
    mutationFn: (code: string) => api<{ accessToken: string; refreshToken: string }>('/auth/mfa/verify', { method: 'POST', body: { code } }),
    onSuccess: (tokens) => { setTokens(tokens, me?.org.slug); void qc.invalidateQueries({ queryKey: ['me'] }); },
  });
}

// ───────── finance summary (staff-only endpoint; portals fall back to computed figures) ─────────
/** `GET /finance/summary` is restricted to finance staff. A landlord with `finance:read` gets 403, which we treat as "not available" rather than an error. */
export const useOptionalFinanceSummary = (enabled: boolean) =>
  useQuery({
    queryKey: ['finance', 'summary', 'optional'],
    queryFn: async () => { try { return await api<FinanceSummaryDto>('/finance/summary'); } catch (err) { if (err instanceof ApiError && (err.isDenied || err.isNotFound)) return null; throw err; } },
    enabled, retry: false, staleTime: 60_000,
  });

// ───────── shared helpers ─────────
export const isNoticeKey = (templateKey: string) => templateKey.startsWith('notice.');
const flat = <T,>(q: UseInfiniteQueryResult<{ pages: Page<T>[] }, unknown>): T[] => q.data?.pages.flatMap((p) => p.items) ?? [];
const startOfTodayUtc = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
export const isOverdueInvoice = (i: InvoiceDto, today = startOfTodayUtc()) => isOutstanding(i.status) && i.balanceCents > 0 && (i.status === 'overdue' || new Date(i.dueDate) < today);

/** Pull every page of an infinite list (portfolios and invoice lists are small; capped so a runaway list cannot loop). */
function useAllPages<T>(q: UseInfiniteQueryResult<{ pages: Page<T>[] }, unknown>, maxPages = 8) {
  const pages = q.data?.pages.length ?? 0;
  useEffect(() => { if (q.hasNextPage && !q.isFetchingNextPage && pages < maxPages) void q.fetchNextPage(); }, [q, pages, maxPages]);
}

// ───────── tenant home view model (p48) ─────────
export type BalanceState = 'zero' | 'due' | 'overdue';
export interface TenantHomeModel {
  lease: LeaseDto | null;
  balance: { cents: number; state: BalanceState; nextDue: string | null; openCount: number; overdueCount: number };
  maintenance: { pending: number; recent: WorkOrderDto[] };
  documents: DocumentDto[];
  notices: NotificationDto[];
  messages: NotificationDto[];
  unread: number;
}

export function useTenantHome() {
  const leases = useLeases();
  const lease = useMemo(() => {
    const all = flat(leases);
    const rank = (s: string) => (s === 'active' ? 0 : s === 'renewal' ? 1 : (LEASE_OCCUPYING_STATES as readonly string[]).includes(s) ? 2 : 9);
    return all.filter((l) => rank(l.status) < 9).sort((a, b) => rank(a.status) - rank(b.status) || b.startDate.localeCompare(a.startDate))[0] ?? null;
  }, [leases]);
  const invoices = useInvoices();
  const workOrders = useWorkOrders({ mine: 'true' }, { limit: 50 });
  // Documents hang off the lease (blueprint contract `GET /documents?ownerType=lease&ownerId=`); same query-key family as useDocuments so uploads invalidate it too.
  const documents = usePagedList<DocumentDto>(['documents'], '/documents', lease ? { ownerType: 'lease', ownerId: lease.id } : {}, !!lease);
  const notifications = useNotifications({ channel: 'in_app' });

  const model = useMemo<TenantHomeModel>(() => {
    const today = startOfTodayUtc();
    const open = flat(invoices).filter((i) => isOutstanding(i.status) && i.balanceCents > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const overdue = open.filter((i) => isOverdueInvoice(i, today));
    const cents = open.reduce((s, i) => s + i.balanceCents, 0);
    const wos = flat(workOrders);
    const pending = wos.filter((w) => (WORK_ORDER_OPEN_STATUSES as readonly string[]).includes(w.status));
    const notes = flat(notifications);
    return {
      lease,
      balance: { cents, state: cents === 0 ? 'zero' : overdue.length ? 'overdue' : 'due', nextDue: open[0]?.dueDate ?? null, openCount: open.length, overdueCount: overdue.length },
      maintenance: { pending: pending.length, recent: wos.slice(0, 3) },
      documents: flat(documents),
      notices: notes.filter((n) => isNoticeKey(n.templateKey)),
      messages: notes.filter((n) => !isNoticeKey(n.templateKey)),
      unread: notes.filter((n) => !n.readAt).length,
    };
  }, [lease, invoices, workOrders, documents, notifications]);

  const queries = { leases, invoices, workOrders, documents, notifications };
  return {
    model,
    queries,
    /** Nothing rendered yet: the lease (the anchor of the screen) is still loading. */
    isLoading: leases.isLoading,
    /** The lease query failed; secondary panels degrade individually. */
    error: leases.error,
    refetchAll: () => { Object.values(queries).forEach((q) => void q.refetch()); },
  };
}

/** The resident's own TenantProfile id comes from the lease parties (tenants may read their own profile but cannot list profiles). */
export function useMyTenantProfileId(): { profileId: string | null; isLoading: boolean; error: unknown; hasLease: boolean } {
  const { me } = useAuth();
  const leases = useLeases();
  const all = flat(leases);
  const party = all.flatMap((l) => l.parties).find((p) => p.userId && p.userId === me?.actor.id);
  return { profileId: party?.tenantProfileId ?? null, isLoading: leases.isLoading, error: leases.error, hasLease: all.length > 0 };
}

// ───────── owner portfolio view model (p39) ─────────
export interface OwnerPortfolioModel {
  properties: PropertyDto[];
  units: number;
  occupied: number;
  occupancyPct: number;
  approvals: LeaseDto[];
  finance: { available: boolean; collectedThisMonthCents: number; overdueCents: number; overdueInvoices: number; openArCents: number; openInvoices: number; source: 'summary' | 'computed' } | null;
  maintenanceSpend90dCents: number;
  openWorkOrders: number;
}

/** Roles the finance module treats as staff (mirrors packages/api/src/modules/finance/access.ts); only they can read /finance/summary. */
const FINANCE_STAFF_ROLES = ['platform_admin', 'org_admin', 'subaccount_admin', 'property_manager', 'bookkeeper', 'support_agent'];

export function useOwnerPortfolio() {
  const { me } = useAuth();
  const canApprove = useCan('lease:approve');
  const canFinance = useCan('finance:read');
  const canPayments = useCan('payment:read');
  const canWorkOrders = useCan('work_order:read');
  const isFinanceStaff = Boolean(me?.roles.some((r) => FINANCE_STAFF_ROLES.includes(r.role as string)));
  const properties = useProperties();
  useAllPages(properties);
  const approvals = useLeases({ status: 'review' }, canApprove);
  const summary = useOptionalFinanceSummary(canFinance && isFinanceStaff);
  const invoices = useInvoices({}, canFinance);
  useAllPages(invoices);
  const payments = usePagedList<PaymentDto>(['finance', 'payments'], '/payments', {}, canPayments && canFinance);
  useAllPages(payments);
  const workOrders = useWorkOrders({}, { limit: 100, enabled: canWorkOrders });

  const model = useMemo<OwnerPortfolioModel>(() => {
    const props = flat(properties);
    const units = props.reduce((s, p) => s + (p.unitCounts?.total ?? 0), 0);
    // Occupied + notice: a unit on notice is still rented today (same convention as the properties list).
    const occupied = props.reduce((s, p) => s + (p.unitCounts ? p.unitCounts.occupied + p.unitCounts.notice : 0), 0);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);
    let finance: OwnerPortfolioModel['finance'] = null;
    if (canFinance) {
      if (summary.data) {
        finance = { available: true, collectedThisMonthCents: summary.data.collectedThisMonthCents, overdueCents: summary.data.overdueCents, overdueInvoices: summary.data.overdueInvoices, openArCents: summary.data.openArCents, openInvoices: summary.data.openInvoices, source: 'summary' };
      } else {
        const inv = flat(invoices).filter((i) => isOutstanding(i.status) && i.balanceCents > 0);
        const overdue = inv.filter((i) => isOverdueInvoice(i));
        const collected = flat(payments).filter((p) => (p.status === 'succeeded' || p.status === 'refunded') && p.receivedAt && new Date(p.receivedAt) >= monthStart).reduce((s, p) => s + p.amountCents, 0);
        finance = { available: true, collectedThisMonthCents: collected, overdueCents: overdue.reduce((s, i) => s + i.balanceCents, 0), overdueInvoices: overdue.length, openArCents: inv.reduce((s, i) => s + i.balanceCents, 0), openInvoices: inv.length, source: 'computed' };
      }
    }
    const wos = flat(workOrders);
    const spend = wos.filter((w) => w.status === 'complete' && w.actualCents && w.completedAt && new Date(w.completedAt) >= ninetyDaysAgo).reduce((s, w) => s + (w.actualCents ?? 0), 0);
    return {
      properties: props, units, occupied, occupancyPct: units ? Math.round((occupied / units) * 100) : 0,
      approvals: flat(approvals), finance, maintenanceSpend90dCents: spend,
      openWorkOrders: wos.filter((w) => (WORK_ORDER_OPEN_STATUSES as readonly string[]).includes(w.status)).length,
    };
  }, [properties, approvals, summary.data, invoices, payments, workOrders, canFinance]);

  return { model, properties, approvals, summary, invoices, payments, workOrders, canApprove, canFinance };
}
