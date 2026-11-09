import { Router } from 'express';
import {
  z, idParams, subResourceParams, tenantProfilePage, tenantProfileDetail, tenantProfileSensitive, createTenantProfile, updateTenantProfile, tenantProfileQuery,
  contactMethod, createContactMethod, emergencyContact, createEmergencyContact, occupant, createOccupant, TENANT_PROFILE_FIELD_CLASSIFICATION,
} from '@bolar/contracts';
import { errors, toPage, decodeCursor, redactFields, isGated, classificationRank, type Classification, type Permission, type RequestContext } from '@bolar/shared';
import type { Prisma } from '@bolar/db';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { clearedClassificationFor, requireAccess, requireSensitiveAccess } from '../../shared/access.js';
import { publish } from '../../shared/events.js';

const RESOURCE = 'tenant_profile';
const FIELD_CLASS = TENANT_PROFILE_FIELD_CLASSIFICATION as Record<string, Classification>;
const CONTACT_FIELD_CLASS: Record<string, Classification> = { value: 'confidential' };
const EMERGENCY_FIELD_CLASS: Record<string, Classification> = { name: 'confidential', phone: 'confidential' };

const DETAIL_INCLUDE = { contacts: { orderBy: { id: 'asc' } }, emergency: { orderBy: { id: 'asc' } }, occupants: { orderBy: { createdAt: 'asc' } } } satisfies Prisma.TenantProfileInclude;
type ProfileRow = Prisma.TenantProfileGetPayload<{ include: typeof DETAIL_INCLUDE }>;

const isSelf = (ctx: RequestContext, row: { userId: string | null }) => !!ctx.actor && !!row.userId && row.userId === ctx.actor.userId;
const parseDate = (v: string) => new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);

/** Highest classification the actor clears without triggering review: own record, explicit permission + purpose, or an approved request. */
async function clearanceFor(ctx: RequestContext, row: { id: string; userId: string | null } | null): Promise<Classification> {
  if (row && isSelf(ctx, row)) return 'restricted';
  if (ctx.permissions.has('tenant_profile:read_sensitive') && ctx.purpose) return 'restricted';
  return clearedClassificationFor(ctx, RESOURCE, row?.id);
}

/** Load a profile the actor may act on: own record, or scoped RBAC. Denied -> 404 (+ access.denied audit). */
async function loadProfile(ctx: RequestContext, id: string, permission: Permission): Promise<ProfileRow> {
  const row = await tenantDb(ctx).tenantProfile.findFirst({ where: { id }, include: DETAIL_INCLUDE });
  if (!row) throw errors.notFound();
  if (isSelf(ctx, row) && permission === 'tenant_profile:read') return row;
  await requireAccess(ctx, permission, { type: RESOURCE, id: row.id });
  return row;
}

function serializeProfile(row: Prisma.TenantProfileGetPayload<object>, cleared: Classification) {
  const { tenantOrgId: _t, ...rest } = row;
  const dto = toDto(rest) as Record<string, unknown>;
  return { ...redactFields(dto, FIELD_CLASS, cleared), clearedClassification: cleared };
}
const serializeContact = (c: Prisma.ContactMethodGetPayload<object>, cleared: Classification) => {
  const { tenantOrgId: _t, ...rest } = c;
  // Mail addresses are internal; email/phone values are confidential.
  return c.kind === 'mail' ? { ...toDto(rest), redactedFields: [] as string[] } : redactFields(toDto(rest) as Record<string, unknown>, CONTACT_FIELD_CLASS, cleared);
};
const serializeEmergency = (e: Prisma.EmergencyContactGetPayload<object>, cleared: Classification) => {
  const { tenantOrgId: _t, ...rest } = e;
  return redactFields(toDto(rest) as Record<string, unknown>, EMERGENCY_FIELD_CLASS, cleared);
};

/** Audits the sensitive read when the viewer is cleared for gated data (permission or approval path). */
async function auditClearedRead(ctx: RequestContext, row: ProfileRow, cleared: Classification): Promise<void> {
  if (isSelf(ctx, row) || !isGated(cleared)) return;
  await requireSensitiveAccess(ctx, { resourceType: RESOURCE, resourceId: row.id, classification: cleared }, 'tenant_profile:read_sensitive');
}

async function serializeDetail(ctx: RequestContext, row: ProfileRow) {
  const cleared = await clearanceFor(ctx, row);
  await auditClearedRead(ctx, row, cleared);
  const base = serializeProfile(row, cleared);
  const emergencyRedacted = classificationRank(cleared) < classificationRank('confidential');
  const activeLeaseCount = await tenantDb(ctx).leaseParty.count({ where: { tenantProfileId: row.id, lease: { status: { in: ['approved', 'sent', 'signed', 'active', 'renewal'] } } } });
  return {
    ...base,
    redactedFields: emergencyRedacted && row.emergency.length ? [...base.redactedFields, 'emergencyContacts'] : base.redactedFields,
    contacts: row.contacts.map((c) => serializeContact(c, cleared)),
    emergencyContacts: row.emergency.map((e) => serializeEmergency(e, cleared)),
    occupants: row.occupants.map((o) => { const { tenantOrgId: _t, ...rest } = o; return toDto(rest); }),
    activeLeaseCount,
  };
}

export const tenantProfileRoutes = [
  defineRoute({ method: 'get', path: '/tenant-profiles', operationId: 'listTenantProfiles', summary: 'List tenant profiles (confidential/restricted fields redacted to the viewer clearance)', tags: ['tenant-profile'], auth: 'session', permission: 'tenant_profile:read',
    request: { query: tenantProfileQuery }, responses: { 200: tenantProfilePage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).tenantProfile.findMany({
        where: { ...(query.status ? { status: query.status } : {}), ...(query.kind ? { kind: query.kind } : {}), ...(query.q ? { OR: [{ displayName: { contains: query.q, mode: 'insensitive' } }, { email: { contains: query.q, mode: 'insensitive' } }] } : {}) },
        take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const cleared = await clearanceFor(ctx, null);
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map((r) => serializeProfile(r, isSelf(ctx, r) ? 'restricted' : cleared)) } };
    } }),

  defineRoute({ method: 'post', path: '/tenant-profiles', operationId: 'createTenantProfile', summary: 'Create a tenant profile', tags: ['tenant-profile'], auth: 'session', permission: 'tenant_profile:write',
    request: { body: createTenantProfile }, responses: { 201: tenantProfileDetail },
    handler: async ({ body, ctx }) => {
      const db = tenantDb(ctx);
      if (body.userId) {
        const u = await db.userProfile.findFirst({ where: { id: body.userId }, select: { id: true } });
        if (!u) throw errors.validation([{ path: 'body.userId', message: 'Unknown user' }]);
        if (await db.tenantProfile.findFirst({ where: { userId: body.userId }, select: { id: true } })) throw errors.conflict('This user already has a tenant profile');
      }
      if (body.businessAccountId && !(await db.businessAccount.findFirst({ where: { id: body.businessAccountId }, select: { id: true } }))) throw errors.validation([{ path: 'body.businessAccountId', message: 'Unknown business account' }]);
      const classification = body.dateOfBirth || body.ssnLast4 ? 'restricted' : 'confidential';
      const row = await db.tenantProfile.create({ data: { tenantOrgId: ctx.tenantOrgId!, ...body, dateOfBirth: body.dateOfBirth ? parseDate(body.dateOfBirth) : null, classification }, include: DETAIL_INCLUDE });
      await audit(ctx, { action: 'tenant_profile.create', resourceType: RESOURCE, resourceId: row.id, after: { displayName: row.displayName, kind: row.kind, status: row.status, classification } });
      await publish(ctx, 'tenant_profile.created', { tenantProfileId: row.id, kind: row.kind, status: row.status });
      return { status: 201, body: await serializeDetail(ctx, row) };
    } }),

  defineRoute({ method: 'get', path: '/tenant-profiles/:id', operationId: 'getTenantProfile', summary: 'Tenant profile detail; restricted fields are nulled unless the sensitive gate passes (tenants may read their own)', tags: ['tenant-profile'], auth: 'session',
    request: { params: idParams }, responses: { 200: tenantProfileDetail },
    handler: async ({ params, ctx }) => ({ body: await serializeDetail(ctx, await loadProfile(ctx, params.id, 'tenant_profile:read')) }) }),

  defineRoute({ method: 'get', path: '/tenant-profiles/:id/sensitive', operationId: 'getTenantProfileSensitive', summary: 'Full sensitive fields; 403 review_required until an approved purpose exists', tags: ['tenant-profile'], auth: 'session',
    request: { params: idParams }, responses: { 200: tenantProfileSensitive },
    handler: async ({ params, ctx }) => {
      const row = await loadProfile(ctx, params.id, 'tenant_profile:read');
      if (!isSelf(ctx, row)) await requireSensitiveAccess(ctx, { resourceType: RESOURCE, resourceId: row.id, classification: 'restricted' }, 'tenant_profile:read_sensitive');
      return { body: { id: row.id, email: row.email, phone: row.phone, dateOfBirth: row.dateOfBirth ? row.dateOfBirth.toISOString() : null, ssnLast4: row.ssnLast4, classification: row.classification, emergencyContacts: row.emergency.map((e) => serializeEmergency(e, 'restricted')) } };
    } }),

  defineRoute({ method: 'patch', path: '/tenant-profiles/:id', operationId: 'updateTenantProfile', summary: 'Update a tenant profile', tags: ['tenant-profile'], auth: 'session', permission: 'tenant_profile:write',
    request: { params: idParams, body: updateTenantProfile }, responses: { 200: tenantProfileDetail },
    handler: async ({ params, body, ctx }) => {
      const row = await loadProfile(ctx, params.id, 'tenant_profile:write');
      const db = tenantDb(ctx);
      if (body.userId) {
        const u = await db.userProfile.findFirst({ where: { id: body.userId }, select: { id: true } });
        if (!u) throw errors.validation([{ path: 'body.userId', message: 'Unknown user' }]);
        const taken = await db.tenantProfile.findFirst({ where: { userId: body.userId, id: { not: row.id } }, select: { id: true } });
        if (taken) throw errors.conflict('This user already has a tenant profile');
      }
      const { dateOfBirth, ...rest } = body;
      const data: Prisma.TenantProfileUpdateInput = { ...rest, ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? parseDate(dateOfBirth) : null } : {}) };
      const touchesRestricted = (dateOfBirth !== undefined && dateOfBirth !== null) || (body.ssnLast4 !== undefined && body.ssnLast4 !== null);
      if (touchesRestricted) data.classification = 'restricted';
      const updated = await db.tenantProfile.update({ where: { id: row.id }, data, include: DETAIL_INCLUDE });
      await audit(ctx, { action: 'tenant_profile.update', resourceType: RESOURCE, resourceId: row.id, before: { displayName: row.displayName, status: row.status, kind: row.kind }, after: { displayName: updated.displayName, status: updated.status, kind: updated.kind, changedFields: Object.keys(body) } });
      return { body: await serializeDetail(ctx, updated) };
    } }),

  // ---- Contact methods (confidential values) ----
  defineRoute({ method: 'get', path: '/tenant-profiles/:id/contacts', operationId: 'listContactMethods', summary: 'Contact methods for a tenant profile', tags: ['tenant-profile'], auth: 'session',
    request: { params: idParams }, responses: { 200: z.object({ items: z.array(contactMethod) }).openapi('ContactMethodList') },
    handler: async ({ params, ctx }) => {
      const row = await loadProfile(ctx, params.id, 'tenant_profile:read');
      const cleared = await clearanceFor(ctx, row);
      await auditClearedRead(ctx, row, cleared);
      return { body: { items: row.contacts.map((c) => serializeContact(c, cleared)) } };
    } }),
  defineRoute({ method: 'post', path: '/tenant-profiles/:id/contacts', operationId: 'addContactMethod', summary: 'Add a contact method', tags: ['tenant-profile'], auth: 'session', permission: 'tenant_profile:write',
    request: { params: idParams, body: createContactMethod }, responses: { 201: contactMethod },
    handler: async ({ params, body, ctx }) => {
      const row = await loadProfile(ctx, params.id, 'tenant_profile:write');
      const db = tenantDb(ctx);
      if (body.isPrimary) await db.contactMethod.updateMany({ where: { tenantProfileId: row.id, kind: body.kind }, data: { isPrimary: false } });
      const c = await db.contactMethod.create({ data: { tenantOrgId: ctx.tenantOrgId!, tenantProfileId: row.id, ...body } });
      await audit(ctx, { action: 'tenant_profile.contact.add', resourceType: RESOURCE, resourceId: row.id, after: { contactId: c.id, kind: c.kind, isPrimary: c.isPrimary } });
      return { status: 201, body: serializeContact(c, 'restricted') };
    } }),
  defineRoute({ method: 'delete', path: '/tenant-profiles/:id/contacts/:subId', operationId: 'removeContactMethod', summary: 'Remove a contact method', tags: ['tenant-profile'], auth: 'session', permission: 'tenant_profile:write',
    request: { params: subResourceParams }, responses: { 204: null },
    handler: async ({ params, ctx }) => {
      const row = await loadProfile(ctx, params.id, 'tenant_profile:write');
      const c = row.contacts.find((x) => x.id === params.subId);
      if (!c) throw errors.notFound();
      await tenantDb(ctx).contactMethod.delete({ where: { id: c.id } });
      await audit(ctx, { action: 'tenant_profile.contact.remove', resourceType: RESOURCE, resourceId: row.id, before: { contactId: c.id, kind: c.kind } });
      return { status: 204 };
    } }),

  // ---- Emergency contacts (confidential) ----
  defineRoute({ method: 'get', path: '/tenant-profiles/:id/emergency-contacts', operationId: 'listEmergencyContacts', summary: 'Emergency contacts (confidential; redacted without clearance)', tags: ['tenant-profile'], auth: 'session',
    request: { params: idParams }, responses: { 200: z.object({ items: z.array(emergencyContact) }).openapi('EmergencyContactList') },
    handler: async ({ params, ctx }) => {
      const row = await loadProfile(ctx, params.id, 'tenant_profile:read');
      const cleared = await clearanceFor(ctx, row);
      await auditClearedRead(ctx, row, cleared);
      return { body: { items: row.emergency.map((e) => serializeEmergency(e, cleared)) } };
    } }),
  defineRoute({ method: 'post', path: '/tenant-profiles/:id/emergency-contacts', operationId: 'addEmergencyContact', summary: 'Add an emergency contact', tags: ['tenant-profile'], auth: 'session', permission: 'tenant_profile:write',
    request: { params: idParams, body: createEmergencyContact }, responses: { 201: emergencyContact },
    handler: async ({ params, body, ctx }) => {
      const row = await loadProfile(ctx, params.id, 'tenant_profile:write');
      const e = await tenantDb(ctx).emergencyContact.create({ data: { tenantOrgId: ctx.tenantOrgId!, tenantProfileId: row.id, ...body } });
      await audit(ctx, { action: 'tenant_profile.emergency.add', resourceType: RESOURCE, resourceId: row.id, after: { emergencyContactId: e.id, relationship: e.relationship } });
      return { status: 201, body: serializeEmergency(e, 'restricted') };
    } }),
  defineRoute({ method: 'delete', path: '/tenant-profiles/:id/emergency-contacts/:subId', operationId: 'removeEmergencyContact', summary: 'Remove an emergency contact', tags: ['tenant-profile'], auth: 'session', permission: 'tenant_profile:write',
    request: { params: subResourceParams }, responses: { 204: null },
    handler: async ({ params, ctx }) => {
      const row = await loadProfile(ctx, params.id, 'tenant_profile:write');
      const e = row.emergency.find((x) => x.id === params.subId);
      if (!e) throw errors.notFound();
      await tenantDb(ctx).emergencyContact.delete({ where: { id: e.id } });
      await audit(ctx, { action: 'tenant_profile.emergency.remove', resourceType: RESOURCE, resourceId: row.id, before: { emergencyContactId: e.id } });
      return { status: 204 };
    } }),

  // ---- Occupants (internal) ----
  defineRoute({ method: 'get', path: '/tenant-profiles/:id/occupants', operationId: 'listOccupants', summary: 'Occupants attached to a tenant profile', tags: ['tenant-profile'], auth: 'session',
    request: { params: idParams }, responses: { 200: z.object({ items: z.array(occupant) }).openapi('OccupantList') },
    handler: async ({ params, ctx }) => {
      const row = await loadProfile(ctx, params.id, 'tenant_profile:read');
      return { body: { items: row.occupants.map((o) => { const { tenantOrgId: _t, ...rest } = o; return toDto(rest); }) } };
    } }),
  defineRoute({ method: 'post', path: '/tenant-profiles/:id/occupants', operationId: 'addOccupant', summary: 'Add an occupant', tags: ['tenant-profile'], auth: 'session', permission: 'tenant_profile:write',
    request: { params: idParams, body: createOccupant }, responses: { 201: occupant },
    handler: async ({ params, body, ctx }) => {
      const row = await loadProfile(ctx, params.id, 'tenant_profile:write');
      const o = await tenantDb(ctx).occupant.create({ data: { tenantOrgId: ctx.tenantOrgId!, tenantProfileId: row.id, ...body } });
      await audit(ctx, { action: 'tenant_profile.occupant.add', resourceType: RESOURCE, resourceId: row.id, after: { occupantId: o.id, relationship: o.relationship, isMinor: o.isMinor } });
      const { tenantOrgId: _t, ...rest } = o;
      return { status: 201, body: toDto(rest) };
    } }),
  defineRoute({ method: 'delete', path: '/tenant-profiles/:id/occupants/:subId', operationId: 'removeOccupant', summary: 'Remove an occupant', tags: ['tenant-profile'], auth: 'session', permission: 'tenant_profile:write',
    request: { params: subResourceParams }, responses: { 204: null },
    handler: async ({ params, ctx }) => {
      const row = await loadProfile(ctx, params.id, 'tenant_profile:write');
      const o = row.occupants.find((x) => x.id === params.subId);
      if (!o) throw errors.notFound();
      await tenantDb(ctx).occupant.delete({ where: { id: o.id } });
      await audit(ctx, { action: 'tenant_profile.occupant.remove', resourceType: RESOURCE, resourceId: row.id, before: { occupantId: o.id } });
      return { status: 204 };
    } }),
];

export const tenantProfileRouter: Router = Router();
mount(tenantProfileRouter, tenantProfileRoutes);
