import { z, idParams, paginationQuery, journalEntry, journalEntryPage, journalEntryQuery, createJournalEntry, reverseJournalEntry, trialBalance as trialBalanceSchema, ledgerProof as ledgerProofSchema, ledgerAccountEntryPage } from '@bolar/contracts';
import { toPage, decodeCursor } from '@bolar/shared';
import type { Prisma } from '@bolar/db';
import { defineRoute, type RouteDef } from '../../../shared/route.js';
import { prisma, tenantDb } from '../../../shared/db.js';
import { requireFinanceStaff, denyFinance } from '../access.js';
import { approveJournal, getJournal, journalDto, ledgerProof, postJournal, reverseJournal, trialBalance } from './service.js';

const entryInclude = { lines: { include: { account: { select: { code: true, name: true } } }, orderBy: { id: 'asc' as const } } } satisfies Prisma.JournalEntryInclude;

/** Ledger routes (Day 37): journal listing, manual adjustments with approval gate, reversals, trial balance, proof. */
export const ledgerRoutes: RouteDef[] = [
  defineRoute({ method: 'get', path: '/journal-entries', operationId: 'listJournalEntries', summary: 'List journal entries (posted and pending)', tags: ['finance'], auth: 'session', permission: 'finance:read',
    request: { query: journalEntryQuery }, responses: { 200: journalEntryPage },
    handler: async ({ query, ctx }) => {
      await requireFinanceStaff(ctx);
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).journalEntry.findMany({
        where: {
          ...(query.sourceType ? { sourceType: query.sourceType } : {}),
          ...(query.status === 'posted' ? { postedAt: { not: null } } : query.status === 'pending' ? { postedAt: null } : {}),
          ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
        },
        include: entryInclude, take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map(journalDto) } };
    } }),
  defineRoute({ method: 'get', path: '/journal-entries/:id', operationId: 'getJournalEntry', summary: 'Get a journal entry with its lines', tags: ['finance'], auth: 'session', permission: 'finance:read',
    request: { params: idParams }, responses: { 200: journalEntry },
    handler: async ({ params, ctx }) => { await requireFinanceStaff(ctx); return { body: await getJournal(ctx, params.id) }; } }),
  defineRoute({ method: 'post', path: '/journal-entries', operationId: 'createJournalEntry', summary: 'Post a manual entry; adjustments are created pending for a second approver', tags: ['finance'], auth: 'mfa', permission: 'finance:post',
    request: { body: createJournalEntry }, responses: { 201: journalEntry },
    handler: async ({ body, ctx }) => {
      await requireFinanceStaff(ctx, 'finance:post');
      const isAdjustment = body.sourceType === 'adjustment' || /adjust|write[- ]?off/i.test(body.memo);
      const { entry } = await postJournal(ctx, {
        sourceType: isAdjustment ? 'adjustment' : body.sourceType, sourceId: body.sourceId, memo: body.memo,
        idempotencyKey: body.idempotencyKey ?? `manual:${ctx.actor!.userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        lines: body.lines, post: !isAdjustment,
      });
      return { status: 201, body: entry };
    } }),
  defineRoute({ method: 'post', path: '/journal-entries/:id/approve', operationId: 'approveJournalEntry', summary: 'Approve and post a pending adjustment (approver must differ from requester)', tags: ['finance'], auth: 'mfa', permission: 'finance:approve_adjustment',
    request: { params: idParams }, responses: { 200: journalEntry },
    handler: async ({ params, ctx }) => {
      await requireFinanceStaff(ctx, 'finance:approve_adjustment');
      return { status: 200, body: await approveJournal(ctx, params.id) };
    } }),
  defineRoute({ method: 'post', path: '/journal-entries/:id/reverse', operationId: 'reverseJournalEntry', summary: 'Reverse a posted entry with a mirrored entry', tags: ['finance'], auth: 'mfa', permission: 'finance:post',
    request: { params: idParams, body: reverseJournalEntry }, responses: { 201: journalEntry },
    handler: async ({ params, body, ctx }) => {
      await requireFinanceStaff(ctx, 'finance:post');
      return { status: 201, body: await reverseJournal(ctx, params.id, body.reason) };
    } }),
  defineRoute({ method: 'get', path: '/ledger/trial-balance', operationId: 'getTrialBalance', summary: 'Trial balance per account over posted entries', tags: ['finance'], auth: 'session', permission: 'finance:read',
    responses: { 200: trialBalanceSchema },
    handler: async ({ ctx }) => { await requireFinanceStaff(ctx); return { body: await trialBalance(ctx) }; } }),
  defineRoute({ method: 'get', path: '/ledger/proof', operationId: 'getLedgerProof', summary: 'Double-entry proof: total debits equal total credits and no entry is unbalanced', tags: ['finance'], auth: 'session', permission: 'finance:read',
    responses: { 200: ledgerProofSchema },
    handler: async ({ ctx }) => { await requireFinanceStaff(ctx); return { body: await ledgerProof(ctx) }; } }),
  defineRoute({ method: 'get', path: '/ledger/accounts/:id/entries', operationId: 'listAccountEntries', summary: 'Ledger lines for one account (posted only)', tags: ['finance'], auth: 'session', permission: 'finance:read',
    request: { params: idParams, query: paginationQuery.extend({ from: z.string().optional(), to: z.string().optional() }) }, responses: { 200: ledgerAccountEntryPage },
    handler: async ({ params, query, ctx }) => {
      await requireFinanceStaff(ctx);
      const account = await tenantDb(ctx).account.findFirst({ where: { id: params.id } });
      if (!account) await denyFinance(ctx, 'finance:read', { type: 'account', id: params.id }, 'unknown account');
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await prisma.ledgerEntry.findMany({
        where: { tenantOrgId: ctx.tenantOrgId!, accountId: params.id, journalEntry: { postedAt: { not: null }, ...(query.from || query.to ? { postedAt: { not: null, ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}) } },
        include: { journalEntry: { select: { postedAt: true, sourceType: true, sourceId: true, memo: true } } },
        take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      return {
        body: {
          ...page,
          items: page.items.map((l) => ({
            id: l.id, journalEntryId: l.journalEntryId, accountId: l.accountId, accountCode: account!.code, accountName: account!.name, propertyId: l.propertyId, debitCents: l.debitCents, creditCents: l.creditCents, memo: l.memo,
            postedAt: l.journalEntry.postedAt?.toISOString() ?? null, sourceType: l.journalEntry.sourceType, sourceId: l.journalEntry.sourceId, journalMemo: l.journalEntry.memo,
          })),
        },
      };
    } }),
];
