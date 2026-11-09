import { Router } from 'express';
import {
  z, idParams, paginationQuery, okSchema, userProfile, userPage, updateUser, invitation, invitationPage, createInvitation, createInvitationResponse, acceptInvitation,
  roleAssignment, assignRole, permissionCatalog, relationship, relationshipPage, createRelationship, relationshipQuery, accessCheckRequest, accessCheckResponse,
} from '@bolar/contracts';
import { errors, toPage, decodeCursor, PERMISSIONS, ROLE_PERMISSIONS, ROLE_SCOPES, isRole, type Role, type ScopeType } from '@bolar/shared';
import { hashPassword } from '@bolar/db';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { decide, requireAccess } from '../../shared/access.js';
import { newOpaqueToken, hashToken } from '../../shared/tokens.js';
import { publish } from '../../shared/events.js';
import { config } from '../../config.js';

const INVITE_TTL_MS = 7 * 86_400_000;

function inviteStatus(i: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) {
  if (i.acceptedAt) return 'accepted';
  if (i.revokedAt) return 'revoked';
  if (i.expiresAt < new Date()) return 'expired';
  return 'pending';
}

async function userWithRoles(ctx: { tenantOrgId: string | null }, id: string) {
  const u = await prisma.userProfile.findFirst({ where: { id, tenantOrgId: ctx.tenantOrgId! }, include: { roles: { where: { revokedAt: null } } } });
  if (!u) throw errors.notFound();
  return { ...toDto(u), roles: u.roles.map((r) => ({ role: r.role, scopeType: r.scopeType, scopeId: r.scopeId })) };
}

async function validateScope(ctx: { tenantOrgId: string | null }, role: Role, scopeType: ScopeType, scopeId: string | undefined): Promise<string | null> {
  if (!ROLE_SCOPES[role].includes(scopeType)) throw errors.validation([{ path: 'body.scopeType', message: `${role} cannot be scoped to ${scopeType}` }]);
  if (scopeType === 'platform') throw errors.forbidden('Platform roles are managed out of band');
  if (scopeType === 'org') return ctx.tenantOrgId;
  if (!scopeId) throw errors.validation([{ path: 'body.scopeId', message: 'scopeId required for this scope' }]);
  const exists =
    scopeType === 'property' ? await prisma.property.findFirst({ where: { id: scopeId, tenantOrgId: ctx.tenantOrgId! }, select: { id: true } })
    : scopeType === 'subaccount' ? await prisma.subaccount.findFirst({ where: { id: scopeId, tenantOrgId: ctx.tenantOrgId! }, select: { id: true } })
    : await prisma.case.findFirst({ where: { id: scopeId, tenantOrgId: ctx.tenantOrgId! }, select: { id: true } });
  if (!exists) throw errors.validation([{ path: 'body.scopeId', message: 'Unknown scope target' }]);
  return scopeId;
}

export const iamRoutes = [
  // ---- Users ----
  defineRoute({ method: 'get', path: '/users', operationId: 'listUsers', summary: 'List users in the org', tags: ['iam'], auth: 'session', permission: 'user:read',
    request: { query: paginationQuery.extend({ status: z.enum(['invited', 'active', 'suspended', 'deactivated']).optional(), q: z.string().max(100).optional() }) }, responses: { 200: userPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await prisma.userProfile.findMany({
        where: { tenantOrgId: ctx.tenantOrgId!, ...(query.status ? { status: query.status } : {}), ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { email: { contains: query.q, mode: 'insensitive' } }] } : {}) },
        include: { roles: { where: { revokedAt: null } } }, take: query.limit + 1, orderBy: { id: 'asc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map((u) => ({ ...toDto(u), roles: u.roles.map((r) => ({ role: r.role, scopeType: r.scopeType, scopeId: r.scopeId })) })) } };
    } }),
  defineRoute({ method: 'get', path: '/users/:id', operationId: 'getUser', summary: 'Get a user with role assignments', tags: ['iam'], auth: 'session', permission: 'user:read',
    request: { params: idParams }, responses: { 200: userProfile }, handler: async ({ params, ctx }) => ({ body: await userWithRoles(ctx, params.id) }) }),
  defineRoute({ method: 'patch', path: '/users/:id', operationId: 'updateUser', summary: 'Update a user name or status', tags: ['iam'], auth: 'mfa', permission: 'user:write',
    request: { params: idParams, body: updateUser }, responses: { 200: userProfile },
    handler: async ({ params, body, ctx }) => {
      const before = await prisma.userProfile.findFirst({ where: { id: params.id, tenantOrgId: ctx.tenantOrgId! } });
      if (!before) throw errors.notFound();
      if (before.id === ctx.actor!.userId && body.status && body.status !== 'active') throw errors.conflict('You cannot suspend your own account');
      await prisma.userProfile.update({ where: { id: params.id }, data: body });
      if (body.status && body.status !== 'active') await prisma.session.updateMany({ where: { userId: params.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await audit(ctx, { action: 'user.update', resourceType: 'user', resourceId: params.id, before: { name: before.name, status: before.status }, after: body });
      return { body: await userWithRoles(ctx, params.id) };
    } }),

  // ---- Invitations (Day 11) ----
  defineRoute({ method: 'get', path: '/invitations', operationId: 'listInvitations', summary: 'List invitations', tags: ['iam'], auth: 'session', permission: 'user:read',
    request: { query: paginationQuery }, responses: { 200: invitationPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).invitation.findMany({ take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map((i) => ({ ...toDto(i), status: inviteStatus(i) })) } };
    } }),
  defineRoute({ method: 'post', path: '/invitations', operationId: 'createInvitation', summary: 'Invite a user into the org with a role', tags: ['iam'], auth: 'mfa', permission: 'user:invite',
    request: { body: createInvitation }, responses: { 201: createInvitationResponse },
    handler: async ({ body, ctx }) => {
      if (!isRole(body.role)) throw errors.validation([{ path: 'body.role', message: 'Unknown role' }]);
      if (body.role === 'org_admin' && !ctx.permissions.has('role:assign')) throw errors.forbidden();
      const scopeId = await validateScope(ctx, body.role, body.scopeType, body.scopeId);
      const dup = await prisma.invitation.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, email: body.email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (dup) throw errors.conflict('An active invitation already exists for this email');
      const existing = await prisma.userProfile.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, email: body.email } });
      if (existing && existing.status !== 'invited') throw errors.conflict('A user with this email already exists in the org');
      const token = newOpaqueToken();
      const inv = await prisma.invitation.create({ data: { tenantOrgId: ctx.tenantOrgId!, email: body.email, role: body.role, scopeType: body.scopeType, scopeId, tokenHash: hashToken(token), invitedBy: ctx.actor!.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
      await audit(ctx, { action: 'invitation.create', resourceType: 'invitation', resourceId: inv.id, after: { role: inv.role, scopeType: inv.scopeType, scopeId } });
      const acceptUrl = `${config().WEB_BASE_URL}/accept-invite?token=${token}`;
      await publish(ctx, 'invitation.created', { invitationId: inv.id, acceptUrl, templateKey: 'invite.staff' });
      // acceptUrl is returned to the inviter only in non-production so local flows work without email.
      return { status: 201, body: { ...toDto(inv), status: 'pending', ...(config().NODE_ENV !== 'production' ? { acceptUrl } : {}) } };
    } }),
  defineRoute({ method: 'post', path: '/invitations/:id/revoke', operationId: 'revokeInvitation', summary: 'Revoke a pending invitation', tags: ['iam'], auth: 'mfa', permission: 'user:invite',
    request: { params: idParams }, responses: { 200: invitation },
    handler: async ({ params, ctx }) => {
      const db = tenantDb(ctx);
      const inv = await db.invitation.findFirst({ where: { id: params.id } });
      if (!inv) throw errors.notFound();
      if (inviteStatus(inv) !== 'pending') throw errors.conflict(`Invitation is ${inviteStatus(inv)}`);
      const row = await db.invitation.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
      await audit(ctx, { action: 'invitation.revoke', resourceType: 'invitation', resourceId: inv.id });
      return { status: 200, body: { ...toDto(row), status: 'revoked' } };
    } }),
  defineRoute({ method: 'post', path: '/invitations/accept', operationId: 'acceptInvitation', summary: 'Accept an invitation and create the account', tags: ['iam'], auth: 'public',
    request: { body: acceptInvitation }, responses: { 200: okSchema.extend({ orgSlug: z.string(), email: z.string() }) },
    handler: async ({ body, ctx }) => {
      const inv = await prisma.invitation.findUnique({ where: { tokenHash: hashToken(body.token) }, include: { tenantOrg: true } });
      if (!inv || inviteStatus(inv) !== 'pending') throw errors.notFound('Invitation is invalid or expired');
      const passwordHash = await hashPassword(body.password);
      const user = await prisma.userProfile.upsert({
        where: { tenantOrgId_email: { tenantOrgId: inv.tenantOrgId, email: inv.email } },
        update: { name: body.name, passwordHash, status: 'active' },
        create: { tenantOrgId: inv.tenantOrgId, email: inv.email, name: body.name, passwordHash, status: 'active' },
      });
      await prisma.roleAssignment.create({ data: { tenantOrgId: inv.tenantOrgId, userId: user.id, role: inv.role, scopeType: inv.scopeType, scopeId: inv.scopeId, grantedBy: inv.invitedBy } });
      await prisma.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
      await audit({ ...ctx, tenantOrgId: inv.tenantOrgId, actor: { userId: user.id, email: user.email, name: user.name, isPlatform: false, mfaVerified: false } }, { action: 'invitation.accept', resourceType: 'invitation', resourceId: inv.id, after: { role: inv.role } });
      return { status: 200, body: { ok: true, orgSlug: inv.tenantOrg.slug, email: user.email } };
    } }),

  // ---- Roles (Day 12) ----
  defineRoute({ method: 'get', path: '/permissions', operationId: 'getPermissionCatalog', summary: 'Permission catalog and role matrix', tags: ['iam'], auth: 'session', permission: 'role:read',
    responses: { 200: permissionCatalog }, handler: async () => ({ body: { permissions: [...PERMISSIONS], roles: ROLE_PERMISSIONS } }) }),
  defineRoute({ method: 'get', path: '/roles', operationId: 'listRoleAssignments', summary: 'List role assignments', tags: ['iam'], auth: 'session', permission: 'role:read',
    request: { query: paginationQuery.extend({ userId: z.string().optional() }) }, responses: { 200: z.object({ items: z.array(roleAssignment), nextCursor: z.string().nullable() }) },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await prisma.roleAssignment.findMany({ where: { tenantOrgId: ctx.tenantOrgId!, revokedAt: null, ...(query.userId ? { userId: query.userId } : {}) }, take: query.limit + 1, orderBy: { id: 'asc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      return { body: toDto(toPage(rows, query.limit)) };
    } }),
  defineRoute({ method: 'post', path: '/roles', operationId: 'assignRole', summary: 'Assign a scoped role to a user', tags: ['iam'], auth: 'mfa', permission: 'role:assign',
    request: { body: assignRole }, responses: { 201: roleAssignment },
    handler: async ({ body, ctx }) => {
      const user = await prisma.userProfile.findFirst({ where: { id: body.userId, tenantOrgId: ctx.tenantOrgId! } });
      if (!user) throw errors.validation([{ path: 'body.userId', message: 'Unknown user' }]);
      const scopeId = await validateScope(ctx, body.role, body.scopeType, body.scopeId);
      const existing = await prisma.roleAssignment.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, userId: body.userId, role: body.role, scopeType: body.scopeType, scopeId, revokedAt: null } });
      if (existing) throw errors.conflict('Role already assigned in this scope');
      const row = await prisma.roleAssignment.create({ data: { tenantOrgId: ctx.tenantOrgId!, userId: body.userId, role: body.role, scopeType: body.scopeType, scopeId, grantedBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'role.grant', resourceType: 'role_assignment', resourceId: row.id, after: { userId: row.userId, role: row.role, scopeType: row.scopeType, scopeId } });
      return { status: 201, body: toDto(row) };
    } }),
  defineRoute({ method: 'delete', path: '/roles/:id', operationId: 'revokeRole', summary: 'Revoke a role assignment', tags: ['iam'], auth: 'mfa', permission: 'role:assign',
    request: { params: idParams }, responses: { 204: null },
    handler: async ({ params, ctx }) => {
      const row = await prisma.roleAssignment.findFirst({ where: { id: params.id, tenantOrgId: ctx.tenantOrgId!, revokedAt: null } });
      if (!row) throw errors.notFound();
      if (row.userId === ctx.actor!.userId && row.role === 'org_admin') throw errors.conflict('You cannot revoke your own admin role');
      await prisma.roleAssignment.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      await audit(ctx, { action: 'role.revoke', resourceType: 'role_assignment', resourceId: row.id, before: { userId: row.userId, role: row.role, scopeType: row.scopeType, scopeId: row.scopeId } });
      return { status: 204 };
    } }),

  // ---- Relationships (Day 13) ----
  defineRoute({ method: 'get', path: '/relationships', operationId: 'listRelationships', summary: 'List relationship edges', tags: ['iam'], auth: 'session', permission: 'relationship:read',
    request: { query: relationshipQuery }, responses: { 200: relationshipPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const { cursor: _c, limit, ...filters } = query;
      const rows = await tenantDb(ctx).relationshipEdge.findMany({ where: filters, take: limit + 1, orderBy: { id: 'asc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      return { body: toDto(toPage(rows, limit)) };
    } }),
  defineRoute({ method: 'post', path: '/relationships', operationId: 'createRelationship', summary: 'Grant a relationship (ownership, assignment, representation, occupancy, agency)', tags: ['iam'], auth: 'mfa', permission: 'relationship:write',
    request: { body: createRelationship }, responses: { 201: relationship },
    handler: async ({ body, ctx }) => {
      if (body.subjectType === 'user') {
        const u = await prisma.userProfile.findFirst({ where: { id: body.subjectId, tenantOrgId: ctx.tenantOrgId! }, select: { id: true } });
        if (!u) throw errors.validation([{ path: 'body.subjectId', message: 'Unknown user' }]);
      }
      const dup = await prisma.relationshipEdge.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, subjectType: body.subjectType, subjectId: body.subjectId, relation: body.relation, objectType: body.objectType, objectId: body.objectId, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] } });
      if (dup) throw errors.conflict('Relationship already exists');
      const row = await prisma.relationshipEdge.create({ data: { tenantOrgId: ctx.tenantOrgId!, ...body, startsAt: body.startsAt ? new Date(body.startsAt) : null, endsAt: body.endsAt ? new Date(body.endsAt) : null, grantedBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'relationship.grant', resourceType: 'relationship_edge', resourceId: row.id, after: toDto(row) });
      return { status: 201, body: toDto(row) };
    } }),
  defineRoute({ method: 'delete', path: '/relationships/:id', operationId: 'revokeRelationship', summary: 'End a relationship now', tags: ['iam'], auth: 'mfa', permission: 'relationship:write',
    request: { params: idParams }, responses: { 204: null },
    handler: async ({ params, ctx }) => {
      const db = tenantDb(ctx);
      const row = await db.relationshipEdge.findFirst({ where: { id: params.id } });
      if (!row) throw errors.notFound();
      await db.relationshipEdge.update({ where: { id: row.id }, data: { endsAt: new Date() } });
      await audit(ctx, { action: 'relationship.revoke', resourceType: 'relationship_edge', resourceId: row.id, before: toDto(row) });
      return { status: 204 };
    } }),
  defineRoute({ method: 'post', path: '/access/check', operationId: 'checkAccess', summary: 'Explain whether the current actor may perform a permission on a resource', tags: ['iam'], auth: 'session',
    request: { body: accessCheckRequest }, responses: { 200: accessCheckResponse },
    handler: async ({ body, ctx }) => {
      const ref = body.resourceId ? { type: body.resourceType ?? 'property', id: body.resourceId, propertyId: body.propertyId ?? null } : null;
      const d = await decide(ctx, body.permission, ref, ['owner_of', 'manages', 'tenant_of', 'occupant_of', 'represents', 'assigned_to', 'vendor_for', 'agency_for', 'member_of', 'bookkeeper_for']);
      return { status: 200, body: d };
    } }),
];
export const iamRouter: Router = Router();
mount(iamRouter, iamRoutes);
export { requireAccess };
