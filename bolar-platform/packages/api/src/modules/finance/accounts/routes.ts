import { idParams, ledgerAccount, ledgerAccountPage, ledgerAccountQuery, createLedgerAccount, updateLedgerAccount, seedDefaultAccountsResponse } from '@bolar/contracts';
import { errors, toPage, decodeCursor } from '@bolar/shared';
import { defineRoute, toDto, type RouteDef } from '../../../shared/route.js';
import { tenantDb } from '../../../shared/db.js';
import { audit } from '../../../shared/audit.js';
import { requireFinanceStaff } from '../access.js';
import { seedDefaultChart, SYSTEM_ACCOUNT_CODES } from '../ledger/service.js';

/** Chart of accounts (Day 36): tenant-scoped 4-digit codes, reserved system accounts, idempotent default chart. */
export const accountRoutes: RouteDef[] = [
  defineRoute({ method: 'get', path: '/accounts', operationId: 'listAccounts', summary: 'List chart of accounts', tags: ['finance'], auth: 'session', permission: 'finance:read',
    request: { query: ledgerAccountQuery }, responses: { 200: ledgerAccountPage },
    handler: async ({ query, ctx }) => {
      await requireFinanceStaff(ctx);
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).account.findMany({
        where: { ...(query.type ? { type: query.type } : {}), ...(query.q ? { OR: [{ code: { startsWith: query.q } }, { name: { contains: query.q, mode: 'insensitive' } }] } : {}) },
        take: query.limit + 1, orderBy: [{ code: 'asc' }, { id: 'asc' }], ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      return { body: toDto(toPage(rows, query.limit)) };
    } }),
  defineRoute({ method: 'post', path: '/accounts', operationId: 'createAccount', summary: 'Create a ledger account (code unique per org, 4 digits)', tags: ['finance'], auth: 'mfa', permission: 'finance:write',
    request: { body: createLedgerAccount }, responses: { 201: ledgerAccount },
    handler: async ({ body, ctx }) => {
      await requireFinanceStaff(ctx, 'finance:write');
      const db = tenantDb(ctx);
      if (SYSTEM_ACCOUNT_CODES.has(body.code)) throw errors.conflict(`Code ${body.code} is reserved for a system account; run seed-default instead`);
      if (await db.account.findFirst({ where: { code: body.code }, select: { id: true } })) throw errors.conflict('Account code already exists in this org');
      if (body.parentId && !(await db.account.findFirst({ where: { id: body.parentId }, select: { id: true } }))) throw errors.validation([{ path: 'body.parentId', message: 'Unknown parent account' }]);
      if (body.propertyId && !(await db.property.findFirst({ where: { id: body.propertyId }, select: { id: true } }))) throw errors.validation([{ path: 'body.propertyId', message: 'Unknown property' }]);
      const row = await db.account.create({ data: { tenantOrgId: ctx.tenantOrgId!, code: body.code, name: body.name, type: body.type, isSystem: false, propertyId: body.propertyId ?? null, parentId: body.parentId ?? null } });
      await audit(ctx, { action: 'account.create', resourceType: 'account', resourceId: row.id, after: toDto(row) });
      return { status: 201, body: toDto(row) };
    } }),
  defineRoute({ method: 'patch', path: '/accounts/:id', operationId: 'updateAccount', summary: 'Update an account (system accounts: name only)', tags: ['finance'], auth: 'mfa', permission: 'finance:write',
    request: { params: idParams, body: updateLedgerAccount }, responses: { 200: ledgerAccount },
    handler: async ({ params, body, ctx }) => {
      await requireFinanceStaff(ctx, 'finance:write');
      const db = tenantDb(ctx);
      const before = await db.account.findFirst({ where: { id: params.id } });
      if (!before) throw errors.notFound();
      const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
      if (before.isSystem) {
        const illegal = Object.keys(changes).filter((k) => k !== 'name');
        if (illegal.length) throw errors.validation(illegal.map((k) => ({ path: `body.${k}`, message: 'System accounts allow name changes only' })));
      }
      if (body.parentId && body.parentId === before.id) throw errors.validation([{ path: 'body.parentId', message: 'An account cannot be its own parent' }]);
      if (body.parentId && !(await db.account.findFirst({ where: { id: body.parentId }, select: { id: true } }))) throw errors.validation([{ path: 'body.parentId', message: 'Unknown parent account' }]);
      if (body.propertyId && !(await db.property.findFirst({ where: { id: body.propertyId }, select: { id: true } }))) throw errors.validation([{ path: 'body.propertyId', message: 'Unknown property' }]);
      if (body.type && body.type !== before.type && (await db.ledgerEntry.count({ where: { accountId: before.id } })) > 0) throw errors.conflict('Account type cannot change once it has ledger entries');
      const row = await db.account.update({ where: { id: before.id }, data: changes });
      await audit(ctx, { action: 'account.update', resourceType: 'account', resourceId: row.id, before: toDto(before), after: changes });
      return { status: 200, body: toDto(row) };
    } }),
  defineRoute({ method: 'post', path: '/accounts/seed-default', operationId: 'seedDefaultAccounts', summary: 'Idempotently seed the default chart of accounts for this org', tags: ['finance'], auth: 'mfa', permission: 'finance:write',
    responses: { 200: seedDefaultAccountsResponse },
    handler: async ({ ctx }) => {
      await requireFinanceStaff(ctx, 'finance:write');
      return { status: 200, body: await seedDefaultChart(ctx) };
    } }),
];
