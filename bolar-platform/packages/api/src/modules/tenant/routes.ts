import { Router } from 'express';
import { z, tenantOrg, tenantOrgPage, createTenantOrg, updateTenantOrg, businessAccount, createBusinessAccount, subaccount, subaccountPage, createSubaccount, updateSubaccount, idParams, paginationQuery } from '@bolar/contracts';
import { errors, toPage, decodeCursor } from '@bolar/shared';
import { hashPassword } from '@bolar/db';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { requireAccess } from '../../shared/access.js';
import { newOpaqueToken, hashToken } from '../../shared/tokens.js';
import { publish } from '../../shared/events.js';

export const tenantRoutes = [
  // ---- Platform control plane: orgs ----
  defineRoute({ method: 'get', path: '/orgs', operationId: 'listOrgs', summary: 'List tenant orgs (platform admin)', tags: ['tenant'], auth: 'mfa', permission: 'platform:admin',
    request: { query: paginationQuery }, responses: { 200: tenantOrgPage },
    handler: async ({ query }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await prisma.tenantOrg.findMany({ take: query.limit + 1, orderBy: { id: 'asc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      return { body: toDto(toPage(rows, query.limit)) };
    } }),
  defineRoute({ method: 'post', path: '/orgs', operationId: 'createOrg', summary: 'Create a tenant org with its first org admin invitation', tags: ['tenant'], auth: 'mfa', permission: 'platform:admin', idempotent: true,
    request: { body: createTenantOrg }, responses: { 201: tenantOrg.extend({ adminInviteToken: z.string() }) },
    handler: async ({ body, ctx }) => {
      const org = await prisma.tenantOrg.create({ data: { slug: body.slug, name: body.name, plan: body.plan } });
      const ba = await prisma.businessAccount.create({ data: { tenantOrgId: org.id, name: body.name } });
      await prisma.subaccount.create({ data: { tenantOrgId: org.id, businessAccountId: ba.id, name: 'Default' } });
      const token = newOpaqueToken();
      await prisma.invitation.create({ data: { tenantOrgId: org.id, email: body.adminEmail.toLowerCase(), role: 'org_admin', scopeType: 'org', scopeId: org.id, tokenHash: hashToken(token), invitedBy: ctx.actor!.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
      await audit(ctx, { action: 'org.create', resourceType: 'tenant_org', resourceId: org.id, tenantOrgId: org.id, after: { slug: org.slug, name: org.name, plan: org.plan } });
      await publish({ ...ctx, tenantOrgId: org.id }, 'org.created', { orgId: org.id, adminEmail: body.adminEmail });
      return { status: 201, body: { ...toDto(org), adminInviteToken: token } };
    } }),
  defineRoute({ method: 'get', path: '/orgs/:id', operationId: 'getOrg', summary: 'Get a tenant org', tags: ['tenant'], auth: 'session', permission: 'org:read',
    request: { params: idParams }, responses: { 200: tenantOrg },
    handler: async ({ params, ctx }) => {
      if (params.id !== ctx.tenantOrgId && !ctx.permissions.has('platform:admin')) throw errors.notFound();
      const org = await prisma.tenantOrg.findUnique({ where: { id: params.id } });
      if (!org) throw errors.notFound();
      return { body: toDto(org) };
    } }),
  defineRoute({ method: 'patch', path: '/orgs/:id', operationId: 'updateOrg', summary: 'Update org name, plan or status', tags: ['tenant'], auth: 'mfa', permission: 'org:write',
    request: { params: idParams, body: updateTenantOrg }, responses: { 200: tenantOrg },
    handler: async ({ params, body, ctx }) => {
      if (params.id !== ctx.tenantOrgId && !ctx.permissions.has('platform:admin')) throw errors.notFound();
      if (body.status && !ctx.permissions.has('platform:admin')) throw errors.forbidden('Only platform admins change org status');
      const before = await prisma.tenantOrg.findUnique({ where: { id: params.id } });
      if (!before) throw errors.notFound();
      const org = await prisma.tenantOrg.update({ where: { id: params.id }, data: body });
      await audit(ctx, { action: 'org.update', resourceType: 'tenant_org', resourceId: org.id, tenantOrgId: org.id, before: toDto(before), after: toDto(org) });
      return { body: toDto(org) };
    } }),

  // ---- Business accounts & subaccounts (tenant scoped) ----
  defineRoute({ method: 'get', path: '/business-accounts', operationId: 'listBusinessAccounts', summary: 'List business accounts in the org', tags: ['tenant'], auth: 'session', permission: 'org:read',
    responses: { 200: z.object({ items: z.array(businessAccount) }) },
    handler: async ({ ctx }) => ({ body: { items: toDto(await tenantDb(ctx).businessAccount.findMany({ orderBy: { createdAt: 'asc' } })) } }) }),
  defineRoute({ method: 'post', path: '/business-accounts', operationId: 'createBusinessAccount', summary: 'Create a business account', tags: ['tenant'], auth: 'mfa', permission: 'org:write',
    request: { body: createBusinessAccount }, responses: { 201: businessAccount },
    handler: async ({ body, ctx }) => {
      const row = await tenantDb(ctx).businessAccount.create({ data: { ...body, tenantOrgId: ctx.tenantOrgId! } });
      await audit(ctx, { action: 'business_account.create', resourceType: 'business_account', resourceId: row.id, after: toDto(row) });
      return { status: 201, body: toDto(row) };
    } }),
  defineRoute({ method: 'get', path: '/subaccounts', operationId: 'listSubaccounts', summary: 'List subaccounts', tags: ['tenant'], auth: 'session', permission: 'subaccount:read',
    request: { query: paginationQuery }, responses: { 200: subaccountPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).subaccount.findMany({ take: query.limit + 1, orderBy: { id: 'asc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      return { body: toDto(toPage(rows, query.limit)) };
    } }),
  defineRoute({ method: 'post', path: '/subaccounts', operationId: 'createSubaccount', summary: 'Create a subaccount', tags: ['tenant'], auth: 'mfa', permission: 'subaccount:write',
    request: { body: createSubaccount }, responses: { 201: subaccount },
    handler: async ({ body, ctx }) => {
      const db = tenantDb(ctx);
      const ba = await db.businessAccount.findFirst({ where: { id: body.businessAccountId } });
      if (!ba) throw errors.validation([{ path: 'body.businessAccountId', message: 'Unknown business account' }]);
      const row = await db.subaccount.create({ data: { ...body, tenantOrgId: ctx.tenantOrgId! } });
      await audit(ctx, { action: 'subaccount.create', resourceType: 'subaccount', resourceId: row.id, after: toDto(row) });
      return { status: 201, body: toDto(row) };
    } }),
  defineRoute({ method: 'get', path: '/subaccounts/:id', operationId: 'getSubaccount', summary: 'Get a subaccount', tags: ['tenant'], auth: 'session', permission: 'subaccount:read',
    request: { params: idParams }, responses: { 200: subaccount },
    handler: async ({ params, ctx }) => {
      await requireAccess(ctx, 'subaccount:read', { type: 'subaccount', id: params.id, subaccountId: params.id }, ['member_of', 'manages']);
      const row = await tenantDb(ctx).subaccount.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      return { body: toDto(row) };
    } }),
  defineRoute({ method: 'patch', path: '/subaccounts/:id', operationId: 'updateSubaccount', summary: 'Update a subaccount', tags: ['tenant'], auth: 'mfa', permission: 'subaccount:write',
    request: { params: idParams, body: updateSubaccount }, responses: { 200: subaccount },
    handler: async ({ params, body, ctx }) => {
      await requireAccess(ctx, 'subaccount:write', { type: 'subaccount', id: params.id, subaccountId: params.id });
      const db = tenantDb(ctx);
      const before = await db.subaccount.findFirst({ where: { id: params.id } });
      if (!before) throw errors.notFound();
      const row = await db.subaccount.update({ where: { id: params.id }, data: body });
      await audit(ctx, { action: 'subaccount.update', resourceType: 'subaccount', resourceId: row.id, before: toDto(before), after: toDto(row) });
      return { body: toDto(row) };
    } }),
];
export const tenantRouter: Router = Router();
mount(tenantRouter, tenantRoutes);
export { hashPassword };
