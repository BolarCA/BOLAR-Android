import { Router } from 'express';
import {
  z, idParams, auditPage, paginationQuery, lease, leasePage, leaseDetail, createLease, updateLease, createLeaseVersion, leaseVersion, addLeaseParty, leaseParty, addRecurringCharge, recurringCharge, transitionLease as transitionLeaseBody, leaseQuery, leaseFormOptions,
  LEASE_OCCUPYING_STATES,
} from '@bolar/contracts';
import { errors, toPage, decodeCursor, type RequestContext } from '@bolar/shared';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { requireAccess } from '../../shared/access.js';
import { publish } from '../../shared/events.js';
import { LEASE_INCLUDE, findOverlaps, loadLease, reloadLease, serializeLease, serializeLeaseDetail, transitionLease, visibleLeaseWhere } from './service.js';

const parseDate = (v: string) => new Date(v.length === 10 ? `${v}T00:00:00.000Z` : v);
const EDITABLE_STATES = ['draft'];
const VERSIONABLE_STATES = ['draft', 'renewal'];
const PARTY_EDIT_STATES = ['draft', 'review', 'renewal'];
const CHARGE_EDIT_STATES = ['draft', 'review', 'approved', 'active', 'renewal'];

/** Properties the actor may draft leases for: null = all in org (org/platform scoped role). */
async function visiblePropertyIds(ctx: RequestContext): Promise<string[] | null> {
  if (ctx.roles.some((r) => r.scopeType === 'org' || r.scopeType === 'platform')) return null;
  const now = new Date();
  const edges = await prisma.relationshipEdge.findMany({
    where: { tenantOrgId: ctx.tenantOrgId!, subjectType: 'user', subjectId: ctx.actor!.userId, relation: { in: ['owner_of', 'manages'] }, objectType: 'property', AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
    select: { objectId: true },
  });
  return [...new Set([...ctx.roles.filter((r) => r.scopeType === 'property' && r.scopeId).map((r) => r.scopeId!), ...edges.map((e) => e.objectId)])];
}

function assertDateRange(start: Date, end: Date): void {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw errors.validation([{ path: 'body.startDate', message: 'Invalid date' }]);
  if (end <= start) throw errors.validation([{ path: 'body.endDate', message: 'End date must be after the start date' }]);
}

export const leaseRoutes = [
  defineRoute({ method: 'get', path: '/leases', operationId: 'listLeases', summary: 'List leases visible to the actor (tenants see only leases they are a party to)', tags: ['lease'], auth: 'session', permission: 'lease:read',
    request: { query: leaseQuery }, responses: { 200: leasePage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const visible = await visibleLeaseWhere(ctx);
      const rows = await tenantDb(ctx).lease.findMany({
        where: { AND: [visible, { ...(query.status ? { status: query.status } : {}), ...(query.propertyId ? { propertyId: query.propertyId } : {}), ...(query.unitId ? { unitId: query.unitId } : {}), ...(query.tenantProfileId ? { parties: { some: { tenantProfileId: query.tenantProfileId } } } : {}) }] },
        include: LEASE_INCLUDE, take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map(serializeLease) } };
    } }),

  defineRoute({ method: 'get', path: '/leases/form-options', operationId: 'getLeaseFormOptions', summary: 'Properties and units the actor may draft leases for (create drawer pickers)', tags: ['lease'], auth: 'session', permission: 'lease:write',
    responses: { 200: leaseFormOptions },
    handler: async ({ ctx }) => {
      const ids = await visiblePropertyIds(ctx);
      const properties = await tenantDb(ctx).property.findMany({
        where: { status: { not: 'archived' }, ...(ids ? { id: { in: ids } } : {}) }, orderBy: { name: 'asc' }, take: 100,
        include: { units: { orderBy: { unitNumber: 'asc' }, take: 200, select: { id: true, unitNumber: true, status: true, targetRentCents: true } } },
      });
      return { body: { properties: properties.map((p) => ({ id: p.id, name: p.name, units: p.units })) } };
    } }),

  defineRoute({ method: 'post', path: '/leases', operationId: 'createLease', summary: 'Create a draft lease with property/unit/tenant validation and overlap enforcement', tags: ['lease'], auth: 'session', permission: 'lease:write',
    request: { body: createLease }, responses: { 201: leaseDetail },
    handler: async ({ body, ctx }) => {
      const db = tenantDb(ctx);
      const unit = await db.unit.findFirst({ where: { id: body.unitId }, include: { property: true } });
      if (!unit) throw errors.validation([{ path: 'body.unitId', message: 'Unknown unit' }]);
      if (unit.propertyId !== body.propertyId) throw errors.validation([{ path: 'body.unitId', message: 'Unit does not belong to the selected property' }]);
      await requireAccess(ctx, 'lease:write', { type: 'property', id: unit.propertyId, propertyId: unit.propertyId, subaccountId: unit.property.subaccountId }, ['manages', 'owner_of']);
      const start = parseDate(body.startDate);
      const end = parseDate(body.endDate);
      assertDateRange(start, end);
      if (body.tenantProfileId) {
        const tp = await db.tenantProfile.findFirst({ where: { id: body.tenantProfileId }, select: { id: true, status: true } });
        if (!tp) throw errors.validation([{ path: 'body.tenantProfileId', message: 'Unknown tenant profile' }]);
        if (tp.status === 'blocked') throw errors.validation([{ path: 'body.tenantProfileId', message: 'Tenant profile is blocked' }]);
      }
      const overlaps = await findOverlaps(ctx, unit.id, start, end);
      if (overlaps.length) throw errors.conflict(`Unit ${unit.unitNumber} already has a ${overlaps[0]!.status} lease for these dates`);

      const row = await db.lease.create({ data: { tenantOrgId: ctx.tenantOrgId!, propertyId: unit.propertyId, unitId: unit.id, status: 'draft', startDate: start, endDate: end, rentCents: body.rentCents, depositCents: body.depositCents, templateKey: body.templateKey ?? null, createdBy: ctx.actor!.userId } });
      if (body.tenantProfileId) await db.leaseParty.create({ data: { tenantOrgId: ctx.tenantOrgId!, leaseId: row.id, tenantProfileId: body.tenantProfileId, role: 'primary' } });
      await db.recurringCharge.create({ data: { tenantOrgId: ctx.tenantOrgId!, leaseId: row.id, type: 'rent', amountCents: body.rentCents, cadence: 'monthly', startsOn: start, endsOn: end, accountCode: '4000' } });
      if (body.termsJson) {
        const v = await db.leaseVersion.create({ data: { tenantOrgId: ctx.tenantOrgId!, leaseId: row.id, version: 1, termsJson: body.termsJson, createdBy: ctx.actor!.userId } });
        await db.lease.update({ where: { id: row.id }, data: { currentVersionId: v.id } });
      }
      await audit(ctx, { action: 'lease.create', resourceType: 'lease', resourceId: row.id, after: { propertyId: row.propertyId, unitId: row.unitId, startDate: start, endDate: end, rentCents: body.rentCents, tenantProfileId: body.tenantProfileId ?? null } });
      await publish(ctx, 'lease.created', { leaseId: row.id, propertyId: row.propertyId, unitId: row.unitId });
      return { status: 201, body: await serializeLeaseDetail(ctx, await reloadLease(ctx, row.id)) };
    } }),

  defineRoute({ method: 'get', path: '/leases/:id/timeline', operationId: 'getLeaseTimeline', summary: 'Audit timeline for a lease (transitions, versions, envelopes)', tags: ['lease'], auth: 'session', permission: 'lease:read',
    request: { params: idParams, query: paginationQuery }, responses: { 200: auditPage },
    handler: async ({ params, query, ctx }) => {
      await loadLease(ctx, params.id, 'lease:read');
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await prisma.auditLog.findMany({
        where: { tenantOrgId: ctx.tenantOrgId!, resourceType: 'lease', resourceId: params.id, action: { in: ['lease.create', 'lease.update', 'lease.transition', 'lease.version.create', 'lease.party.add', 'lease.charge.add', 'signature.envelope.create', 'signature.envelope.void', 'signature.webhook'] } },
        take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map((r) => toDto({ ...r, ip: null })) } };
    } }),

  defineRoute({ method: 'get', path: '/leases/:id', operationId: 'getLease', summary: 'Lease detail with parties, charges, versions and allowed next states for the actor', tags: ['lease'], auth: 'session', permission: 'lease:read',
    request: { params: idParams }, responses: { 200: leaseDetail },
    handler: async ({ params, ctx }) => ({ body: await serializeLeaseDetail(ctx, await loadLease(ctx, params.id, 'lease:read')) }) }),

  defineRoute({ method: 'patch', path: '/leases/:id', operationId: 'updateLease', summary: 'Update a draft lease (dates, rent, deposit, template)', tags: ['lease'], auth: 'session', permission: 'lease:write',
    request: { params: idParams, body: updateLease }, responses: { 200: leaseDetail },
    handler: async ({ params, body, ctx }) => {
      const row = await loadLease(ctx, params.id, 'lease:write');
      if (!EDITABLE_STATES.includes(row.status)) throw errors.conflict(`Lease is ${row.status}; only drafts can be edited`);
      const start = body.startDate ? parseDate(body.startDate) : row.startDate;
      const end = body.endDate ? parseDate(body.endDate) : row.endDate;
      assertDateRange(start, end);
      if (body.startDate || body.endDate) {
        const overlaps = await findOverlaps(ctx, row.unitId, start, end, row.id);
        if (overlaps.length) throw errors.conflict(`Unit ${row.unit.unitNumber} already has a ${overlaps[0]!.status} lease for these dates`);
      }
      await tenantDb(ctx).lease.update({ where: { id: row.id }, data: { startDate: start, endDate: end, ...(body.rentCents !== undefined ? { rentCents: body.rentCents } : {}), ...(body.depositCents !== undefined ? { depositCents: body.depositCents } : {}), ...(body.templateKey !== undefined ? { templateKey: body.templateKey } : {}) } });
      await audit(ctx, { action: 'lease.update', resourceType: 'lease', resourceId: row.id, before: { startDate: row.startDate, endDate: row.endDate, rentCents: row.rentCents, depositCents: row.depositCents, templateKey: row.templateKey }, after: body });
      return { body: await serializeLeaseDetail(ctx, await reloadLease(ctx, row.id)) };
    } }),

  defineRoute({ method: 'post', path: '/leases/:id/versions', operationId: 'createLeaseVersion', summary: 'Add a new terms version (draft or renewal) and make it current', tags: ['lease'], auth: 'session', permission: 'lease:write',
    request: { params: idParams, body: createLeaseVersion }, responses: { 201: leaseVersion },
    handler: async ({ params, body, ctx }) => {
      const row = await loadLease(ctx, params.id, 'lease:write');
      if (!VERSIONABLE_STATES.includes(row.status)) throw errors.conflict(`Lease is ${row.status}; versions can be added in draft or renewal`);
      const db = tenantDb(ctx);
      if (body.documentId) {
        const doc = await db.document.findFirst({ where: { id: body.documentId, deletedAt: null }, select: { id: true } });
        if (!doc) throw errors.validation([{ path: 'body.documentId', message: 'Unknown document' }]);
      }
      const next = (row.versions.at(-1)?.version ?? 0) + 1;
      const v = await db.leaseVersion.create({ data: { tenantOrgId: ctx.tenantOrgId!, leaseId: row.id, version: next, termsJson: body.termsJson, documentId: body.documentId ?? null, createdBy: ctx.actor!.userId } });
      await db.lease.update({ where: { id: row.id }, data: { currentVersionId: v.id } });
      await audit(ctx, { action: 'lease.version.create', resourceType: 'lease', resourceId: row.id, after: { versionId: v.id, version: next, documentId: v.documentId } });
      await publish(ctx, 'lease.version_created', { leaseId: row.id, versionId: v.id, version: next });
      return { status: 201, body: toDto(v) };
    } }),

  defineRoute({ method: 'post', path: '/leases/:id/parties', operationId: 'addLeaseParty', summary: 'Add a tenant profile as a party (primary, co-tenant, guarantor, occupant, corporate sponsor)', tags: ['lease'], auth: 'session', permission: 'lease:write',
    request: { params: idParams, body: addLeaseParty }, responses: { 201: leaseParty },
    handler: async ({ params, body, ctx }) => {
      const row = await loadLease(ctx, params.id, 'lease:write');
      if (!PARTY_EDIT_STATES.includes(row.status)) throw errors.conflict(`Lease is ${row.status}; parties can be changed in draft, review or renewal`);
      const db = tenantDb(ctx);
      const tp = await db.tenantProfile.findFirst({ where: { id: body.tenantProfileId }, select: { id: true, displayName: true, kind: true, userId: true, status: true } });
      if (!tp) throw errors.validation([{ path: 'body.tenantProfileId', message: 'Unknown tenant profile' }]);
      if (tp.status === 'blocked') throw errors.validation([{ path: 'body.tenantProfileId', message: 'Tenant profile is blocked' }]);
      if (row.parties.some((p) => p.tenantProfileId === tp.id)) throw errors.conflict('This tenant profile is already a party');
      if (body.role === 'primary' && row.parties.some((p) => p.role === 'primary')) throw errors.conflict('The lease already has a primary tenant');
      const p = await db.leaseParty.create({ data: { tenantOrgId: ctx.tenantOrgId!, leaseId: row.id, tenantProfileId: tp.id, role: body.role } });
      await audit(ctx, { action: 'lease.party.add', resourceType: 'lease', resourceId: row.id, after: { partyId: p.id, tenantProfileId: tp.id, role: body.role } });
      return { status: 201, body: { ...toDto(p), displayName: tp.displayName, kind: tp.kind, userId: tp.userId } };
    } }),

  defineRoute({ method: 'post', path: '/leases/:id/charges', operationId: 'addRecurringCharge', summary: 'Add a recurring charge to a lease', tags: ['lease'], auth: 'session', permission: 'lease:write',
    request: { params: idParams, body: addRecurringCharge }, responses: { 201: recurringCharge },
    handler: async ({ params, body, ctx }) => {
      const row = await loadLease(ctx, params.id, 'lease:write');
      if (!CHARGE_EDIT_STATES.includes(row.status)) throw errors.conflict(`Lease is ${row.status}; charges cannot be added`);
      const startsOn = body.startsOn ? parseDate(body.startsOn) : null;
      const endsOn = body.endsOn ? parseDate(body.endsOn) : null;
      if (startsOn && endsOn && endsOn < startsOn) throw errors.validation([{ path: 'body.endsOn', message: 'endsOn must be after startsOn' }]);
      const c = await tenantDb(ctx).recurringCharge.create({ data: { tenantOrgId: ctx.tenantOrgId!, leaseId: row.id, type: body.type, amountCents: body.amountCents, cadence: body.cadence, startsOn, endsOn, accountCode: body.accountCode ?? null } });
      await audit(ctx, { action: 'lease.charge.add', resourceType: 'lease', resourceId: row.id, after: { chargeId: c.id, type: c.type, amountCents: c.amountCents, cadence: c.cadence } });
      return { status: 201, body: toDto(c) };
    } }),

  defineRoute({ method: 'post', path: '/leases/:id/transition', operationId: 'transitionLease', summary: 'Move a lease through its lifecycle (draft/review/approved/sent/signed/active/renewal/terminated/canceled)', tags: ['lease'], auth: 'mfa',
    request: { params: idParams, body: transitionLeaseBody }, responses: { 200: leaseDetail },
    handler: async ({ params, body, ctx }) => {
      const row = await loadLease(ctx, params.id, 'lease:read');
      const updated = await transitionLease(ctx, row, body.to, { note: body.note, signedAt: body.signedAt, activate: body.activate });
      return { status: 200, body: await serializeLeaseDetail(ctx, updated) };
    } }),

  defineRoute({ method: 'get', path: '/units/:id/occupancy', operationId: 'getUnitOccupancy', summary: 'Occupying leases for a unit (overlap preview for the create drawer)', tags: ['lease'], auth: 'session', permission: 'lease:read',
    request: { params: idParams, query: z.object({ startDate: z.string().optional(), endDate: z.string().optional() }) }, responses: { 200: z.object({ unitId: z.string(), status: z.string(), leases: z.array(lease.pick({ id: true, status: true, startDate: true, endDate: true })) }).openapi('UnitOccupancy') },
    handler: async ({ params, query, ctx }) => {
      const unit = await tenantDb(ctx).unit.findFirst({ where: { id: params.id }, include: { property: { select: { subaccountId: true } } } });
      if (!unit) throw errors.notFound();
      await requireAccess(ctx, 'lease:read', { type: 'unit', id: unit.id, propertyId: unit.propertyId, subaccountId: unit.property.subaccountId }, ['manages', 'owner_of', 'tenant_of']);
      const leases = query.startDate && query.endDate
        ? await findOverlaps(ctx, unit.id, parseDate(query.startDate), parseDate(query.endDate))
        : await tenantDb(ctx).lease.findMany({ where: { unitId: unit.id, status: { in: [...LEASE_OCCUPYING_STATES] } }, select: { id: true, status: true, startDate: true, endDate: true }, orderBy: { startDate: 'asc' } });
      return { body: { unitId: unit.id, status: unit.status, leases: toDto(leases) } };
    } }),
];

export const leaseRouter: Router = Router();
mount(leaseRouter, leaseRoutes);
