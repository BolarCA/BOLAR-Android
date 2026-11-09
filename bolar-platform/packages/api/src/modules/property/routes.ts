import { Router } from 'express';
import {
  z, idParams, paginationQuery,
  portfolio, portfolioPage, createPortfolio, updatePortfolio,
  property, propertyPage, propertyDetail, createProperty, updateProperty, propertyQuery,
  building, createBuilding,
  unit, unitPage, createUnit, updateUnit, unitQuery, unitStatusChange, unitStatusHistoryPage, propertyHierarchy,
  UNIT_STATUSES, type UnitCountsDto, type UnitStatus,
} from '@bolar/contracts';
import { errors, toPage, decodeCursor } from '@bolar/shared';
import type { Prisma } from '@bolar/db';
import { defineRoute, mount, toDto, type RouteDef } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { requirePropertyAccess, requirePortfolioAccess, resolvePropertyScope, propertyScopeWhere, portfolioScopeWhere } from './access.js';
import { nextUnitStatuses, unitStateMachine } from './state-machine.js';

/**
 * Property module (Days 16-20): portfolio -> property -> building -> unit hierarchy with tenant filters,
 * RBAC/ReBAC, cursor pagination, audited mutations and domain events.
 *
 * Search: list filters run on PostgreSQL using the composite indexes property(tenant_org_id,status,city) and
 * unit(tenant_org_id,property_id,status). OpenSearch is a later seam only (docs/qa/core-data-qa.md); no code here
 * depends on it.
 */

const HIERARCHY_UNIT_CAP = 500;
type Ctx = Parameters<typeof tenantDb>[0];

const emptyCounts = (): UnitCountsDto => ({ total: 0, vacant: 0, occupied: 0, notice: 0, make_ready: 0, down: 0, reserved: 0 });

async function unitCountsFor(ctx: Ctx, propertyIds: string[]): Promise<Map<string, UnitCountsDto>> {
  const map = new Map<string, UnitCountsDto>();
  if (propertyIds.length === 0) return map;
  const rows = await tenantDb(ctx).unit.groupBy({ by: ['propertyId', 'status'], where: { propertyId: { in: propertyIds } }, _count: { _all: true } });
  for (const r of rows) {
    const c = map.get(r.propertyId) ?? emptyCounts();
    const n = r._count._all;
    c.total += n;
    if ((UNIT_STATUSES as readonly string[]).includes(r.status)) c[r.status as UnitStatus] += n;
    map.set(r.propertyId, c);
  }
  return map;
}

async function loadProperty(ctx: Ctx, id: string) {
  const row = await tenantDb(ctx).property.findFirst({ where: { id } });
  // Unknown and denied look identical to the caller (404); access.denied is audited only when the row exists.
  if (!row) throw errors.notFound();
  return row;
}

async function propertyDetailDto(ctx: Ctx, id: string) {
  const db = tenantDb(ctx);
  const row = await db.property.findFirst({ where: { id }, include: { portfolio: { select: { id: true, name: true } }, buildings: { orderBy: { createdAt: 'asc' } } } });
  if (!row) throw errors.notFound();
  const [counts, perBuilding] = await Promise.all([unitCountsFor(ctx, [id]), db.unit.groupBy({ by: ['buildingId'], where: { propertyId: id, buildingId: { not: null } }, _count: { _all: true } })]);
  const unitsByBuilding = new Map(perBuilding.map((b) => [b.buildingId, b._count._all]));
  const { buildings, portfolio: pf, ...rest } = row;
  return { ...toDto(rest), portfolio: pf, buildings: buildings.map((b) => ({ ...toDto(b), unitCount: unitsByBuilding.get(b.id) ?? 0 })), unitCounts: counts.get(id) ?? emptyCounts() };
}

async function validatePropertyLinks(ctx: Ctx, body: { portfolioId?: string | null; subaccountId?: string | null; ownerUserId?: string | null }) {
  const db = tenantDb(ctx);
  if (body.portfolioId && !(await db.portfolio.findFirst({ where: { id: body.portfolioId }, select: { id: true } }))) throw errors.validation([{ path: 'body.portfolioId', message: 'Unknown portfolio' }]);
  if (body.subaccountId && !(await db.subaccount.findFirst({ where: { id: body.subaccountId }, select: { id: true } }))) throw errors.validation([{ path: 'body.subaccountId', message: 'Unknown subaccount' }]);
  if (body.ownerUserId && !(await db.userProfile.findFirst({ where: { id: body.ownerUserId }, select: { id: true } }))) throw errors.validation([{ path: 'body.ownerUserId', message: 'Unknown user' }]);
}

const unitDto = (u: { status: string } & Record<string, unknown>) => ({ ...toDto(u), nextStatuses: nextUnitStatuses(u.status) });

async function loadUnitWithProperty(ctx: Ctx, id: string) {
  const row = await tenantDb(ctx).unit.findFirst({ where: { id }, include: { property: { select: { id: true, portfolioId: true, subaccountId: true } } } });
  if (!row) throw errors.notFound();
  return row;
}

export const propertyRoutes: RouteDef[] = [
  // ---- Portfolios ----
  defineRoute({ method: 'get', path: '/portfolios', operationId: 'listPortfolios', summary: 'List portfolios visible to the actor', tags: ['property'], auth: 'session', permission: 'property:read',
    request: { query: paginationQuery.extend({ q: z.string().trim().max(100).optional() }) }, responses: { 200: portfolioPage },
    handler: async ({ query, ctx }) => {
      const scope = await resolvePropertyScope(ctx, 'property:read');
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).portfolio.findMany({
        where: { ...portfolioScopeWhere(ctx, scope), ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}), ...(c ? { id: { gt: c.id } } : {}) },
        include: { _count: { select: { properties: true } } }, take: query.limit + 1, orderBy: { id: 'asc' },
      });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map(({ _count, ...p }) => ({ ...toDto(p), propertyCount: _count.properties })) } };
    } }),
  defineRoute({ method: 'post', path: '/portfolios', operationId: 'createPortfolio', summary: 'Create a portfolio', tags: ['property'], auth: 'session', permission: 'property:write',
    request: { body: createPortfolio }, responses: { 201: portfolio },
    handler: async ({ body, ctx }) => {
      await validatePropertyLinks(ctx, body);
      const row = await tenantDb(ctx).portfolio.create({ data: { tenantOrgId: ctx.tenantOrgId!, name: body.name, ownerUserId: body.ownerUserId ?? null } });
      await audit(ctx, { action: 'portfolio.create', resourceType: 'portfolio', resourceId: row.id, after: toDto(row) });
      await publish(ctx, 'portfolio.created', { portfolioId: row.id, name: row.name });
      return { status: 201, body: { ...toDto(row), propertyCount: 0 } };
    } }),
  defineRoute({ method: 'get', path: '/portfolios/:id', operationId: 'getPortfolio', summary: 'Get a portfolio', tags: ['property'], auth: 'session', permission: 'property:read',
    request: { params: idParams }, responses: { 200: portfolio },
    handler: async ({ params, ctx }) => {
      await requirePortfolioAccess(ctx, 'property:read', params.id);
      const row = await tenantDb(ctx).portfolio.findFirst({ where: { id: params.id }, include: { _count: { select: { properties: true } } } });
      if (!row) throw errors.notFound();
      const { _count, ...p } = row;
      return { body: { ...toDto(p), propertyCount: _count.properties } };
    } }),
  defineRoute({ method: 'patch', path: '/portfolios/:id', operationId: 'updatePortfolio', summary: 'Update a portfolio', tags: ['property'], auth: 'session', permission: 'property:write',
    request: { params: idParams, body: updatePortfolio }, responses: { 200: portfolio },
    handler: async ({ params, body, ctx }) => {
      await requirePortfolioAccess(ctx, 'property:write', params.id);
      await validatePropertyLinks(ctx, body);
      const db = tenantDb(ctx);
      const before = await db.portfolio.findFirst({ where: { id: params.id } });
      if (!before) throw errors.notFound();
      const row = await db.portfolio.update({ where: { id: before.id }, data: body, include: { _count: { select: { properties: true } } } });
      await audit(ctx, { action: 'portfolio.update', resourceType: 'portfolio', resourceId: row.id, before: { name: before.name, ownerUserId: before.ownerUserId }, after: body });
      const { _count, ...p } = row;
      return { body: { ...toDto(p), propertyCount: _count.properties } };
    } }),

  // ---- Properties (Day 16) ----
  defineRoute({ method: 'get', path: '/properties', operationId: 'listProperties', summary: 'List properties with filters and cursor pagination', tags: ['property'], auth: 'session', permission: 'property:read',
    request: { query: propertyQuery }, responses: { 200: propertyPage },
    handler: async ({ query, ctx }) => {
      const scope = await resolvePropertyScope(ctx, 'property:read');
      const c = decodeCursor<{ createdAt: string; id: string }>(query.cursor);
      const where: Prisma.PropertyWhereInput = {
        ...propertyScopeWhere(scope),
        ...(query.status ? { status: query.status } : query.includeArchived ? {} : { status: { not: 'archived' } }),
        ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
        ...(query.state ? { state: query.state } : {}),
        ...(query.portfolioId ? { portfolioId: query.portfolioId } : {}),
        ...(query.subaccountId ? { subaccountId: query.subaccountId } : {}),
        ...(query.q ? { AND: [{ OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { addressLine1: { contains: query.q, mode: 'insensitive' } }, { city: { contains: query.q, mode: 'insensitive' } }] }] } : {}),
      };
      // Keyset pagination on (createdAt desc, id desc) backed by index property(tenant_org_id, created_at, id).
      const cursorWhere: Prisma.PropertyWhereInput = c ? { OR: [{ createdAt: { lt: new Date(c.createdAt) } }, { createdAt: new Date(c.createdAt), id: { lt: c.id } }] } : {};
      const rows = await tenantDb(ctx).property.findMany({ where: { AND: [where, cursorWhere] }, take: query.limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      const page = toPage(rows, query.limit, (r) => ({ createdAt: r.createdAt.toISOString(), id: r.id }));
      const counts = await unitCountsFor(ctx, page.items.map((p) => p.id));
      return { body: { ...page, items: page.items.map((p) => ({ ...toDto(p), unitCounts: counts.get(p.id) ?? emptyCounts() })) } };
    } }),
  defineRoute({ method: 'post', path: '/properties', operationId: 'createProperty', summary: 'Create a property', tags: ['property'], auth: 'session', permission: 'property:write',
    request: { body: createProperty }, responses: { 201: property },
    handler: async ({ body, ctx }) => {
      await validatePropertyLinks(ctx, body);
      const scope = await resolvePropertyScope(ctx, 'property:write');
      // Scoped writers (subaccount-scoped roles / manages-subaccount edges) may only create inside their subaccount.
      if (!scope.all && !(body.subaccountId && scope.subaccountIds.includes(body.subaccountId))) {
        await audit(ctx, { action: 'access.denied', resourceType: 'property', resourceId: null, outcome: 'deny', metadata: { permission: 'property:write', reason: 'create requires org-wide or subaccount-covering write scope' } });
        throw errors.forbidden();
      }
      const row = await tenantDb(ctx).property.create({ data: { ...body, tenantOrgId: ctx.tenantOrgId!, addressLine2: body.addressLine2 ?? null, county: body.county ?? null, portfolioId: body.portfolioId ?? null, subaccountId: body.subaccountId ?? null, ownerUserId: body.ownerUserId ?? null } });
      await audit(ctx, { action: 'property.create', resourceType: 'property', resourceId: row.id, after: toDto(row) });
      await publish(ctx, 'property.created', { propertyId: row.id, name: row.name, city: row.city, state: row.state, portfolioId: row.portfolioId, subaccountId: row.subaccountId });
      return { status: 201, body: { ...toDto(row), unitCounts: emptyCounts() } };
    } }),
  defineRoute({ method: 'get', path: '/properties/:id', operationId: 'getProperty', summary: 'Property detail with buildings and unit counts by status', tags: ['property'], auth: 'session', permission: 'property:read',
    request: { params: idParams }, responses: { 200: propertyDetail },
    handler: async ({ params, ctx }) => {
      const row = await loadProperty(ctx, params.id);
      await requirePropertyAccess(ctx, 'property:read', row);
      return { body: await propertyDetailDto(ctx, row.id) };
    } }),
  defineRoute({ method: 'patch', path: '/properties/:id', operationId: 'updateProperty', summary: 'Update a property', tags: ['property'], auth: 'session', permission: 'property:write',
    request: { params: idParams, body: updateProperty }, responses: { 200: propertyDetail },
    handler: async ({ params, body, ctx }) => {
      const before = await loadProperty(ctx, params.id);
      await requirePropertyAccess(ctx, 'property:write', before);
      if (before.status === 'archived') throw errors.conflict('Archived properties are read-only');
      await validatePropertyLinks(ctx, body);
      const row = await tenantDb(ctx).property.update({ where: { id: before.id }, data: body });
      await audit(ctx, { action: 'property.update', resourceType: 'property', resourceId: row.id, before: toDto(before), after: body });
      await publish(ctx, 'property.updated', { propertyId: row.id, changed: Object.keys(body) });
      return { body: await propertyDetailDto(ctx, row.id) };
    } }),
  defineRoute({ method: 'post', path: '/properties/:id/archive', operationId: 'archiveProperty', summary: 'Archive a property (soft delete; blocked while units are occupied)', tags: ['property'], auth: 'session', permission: 'property:write',
    request: { params: idParams }, responses: { 200: propertyDetail },
    handler: async ({ params, ctx }) => {
      const before = await loadProperty(ctx, params.id);
      await requirePropertyAccess(ctx, 'property:write', before);
      if (before.status === 'archived') throw errors.conflict('Property is already archived');
      const occupied = await tenantDb(ctx).unit.count({ where: { propertyId: before.id, status: { in: ['occupied', 'notice', 'reserved'] } } });
      if (occupied > 0) throw errors.conflict(`Cannot archive: ${occupied} unit(s) are occupied, on notice or reserved`);
      const row = await tenantDb(ctx).property.update({ where: { id: before.id }, data: { status: 'archived' } });
      await audit(ctx, { action: 'property.archive', resourceType: 'property', resourceId: row.id, before: { status: before.status }, after: { status: 'archived' } });
      await publish(ctx, 'property.archived', { propertyId: row.id });
      return { status: 200, body: await propertyDetailDto(ctx, row.id) };
    } }),

  // ---- Buildings ----
  defineRoute({ method: 'get', path: '/properties/:id/buildings', operationId: 'listBuildings', summary: 'List buildings of a property', tags: ['property'], auth: 'session', permission: 'property:read',
    request: { params: idParams, query: paginationQuery }, responses: { 200: z.object({ items: z.array(building), nextCursor: z.string().nullable() }) },
    handler: async ({ params, query, ctx }) => {
      const prop = await loadProperty(ctx, params.id);
      await requirePropertyAccess(ctx, 'property:read', prop);
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).building.findMany({ where: { propertyId: prop.id, ...(c ? { id: { gt: c.id } } : {}) }, include: { _count: { select: { units: true } } }, take: query.limit + 1, orderBy: { id: 'asc' } });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map(({ _count, ...b }) => ({ ...toDto(b), unitCount: _count.units })) } };
    } }),
  defineRoute({ method: 'post', path: '/properties/:id/buildings', operationId: 'createBuilding', summary: 'Add a building to a property', tags: ['property'], auth: 'session', permission: 'property:write',
    request: { params: idParams, body: createBuilding }, responses: { 201: building },
    handler: async ({ params, body, ctx }) => {
      const prop = await loadProperty(ctx, params.id);
      await requirePropertyAccess(ctx, 'property:write', prop);
      if (prop.status === 'archived') throw errors.conflict('Archived properties are read-only');
      const row = await tenantDb(ctx).building.create({ data: { tenantOrgId: ctx.tenantOrgId!, propertyId: prop.id, name: body.name ?? null, floors: body.floors ?? null } });
      await audit(ctx, { action: 'building.create', resourceType: 'building', resourceId: row.id, after: toDto(row), metadata: { propertyId: prop.id } });
      return { status: 201, body: { ...toDto(row), unitCount: 0 } };
    } }),

  // ---- Units (Day 17) ----
  defineRoute({ method: 'get', path: '/properties/:id/units', operationId: 'listUnits', summary: 'List units of a property (filters: status, buildingId, q)', tags: ['property'], auth: 'session', permission: 'unit:read',
    request: { params: idParams, query: unitQuery }, responses: { 200: unitPage },
    handler: async ({ params, query, ctx }) => {
      const prop = await loadProperty(ctx, params.id);
      await requirePropertyAccess(ctx, 'unit:read', prop);
      const c = decodeCursor<{ unitNumber: string; id: string }>(query.cursor);
      // Keyset on (unitNumber asc, id asc); status filter uses index unit(tenant_org_id, property_id, status).
      const rows = await tenantDb(ctx).unit.findMany({
        where: {
          propertyId: prop.id,
          ...(query.status ? { status: query.status } : {}),
          ...(query.buildingId ? { buildingId: query.buildingId } : {}),
          ...(query.q ? { unitNumber: { contains: query.q, mode: 'insensitive' } } : {}),
          ...(c ? { OR: [{ unitNumber: { gt: c.unitNumber } }, { unitNumber: c.unitNumber, id: { gt: c.id } }] } : {}),
        },
        take: query.limit + 1, orderBy: [{ unitNumber: 'asc' }, { id: 'asc' }],
      });
      const page = toPage(rows, query.limit, (r) => ({ unitNumber: r.unitNumber, id: r.id }));
      return { body: { ...page, items: page.items.map(unitDto) } };
    } }),
  defineRoute({ method: 'post', path: '/properties/:id/units', operationId: 'createUnit', summary: 'Create a unit in a property', tags: ['property'], auth: 'session', permission: 'unit:write',
    request: { params: idParams, body: createUnit }, responses: { 201: unit },
    handler: async ({ params, body, ctx }) => {
      const prop = await loadProperty(ctx, params.id);
      await requirePropertyAccess(ctx, 'unit:write', prop);
      if (prop.status === 'archived') throw errors.conflict('Archived properties are read-only');
      const db = tenantDb(ctx);
      if (body.buildingId && !(await db.building.findFirst({ where: { id: body.buildingId, propertyId: prop.id }, select: { id: true } }))) throw errors.validation([{ path: 'body.buildingId', message: 'Building does not belong to this property' }]);
      const dup = await db.unit.findFirst({ where: { propertyId: prop.id, unitNumber: body.unitNumber }, select: { id: true } });
      if (dup) throw errors.conflict(`Unit ${body.unitNumber} already exists in this property`);
      const row = await db.unit.create({ data: { tenantOrgId: ctx.tenantOrgId!, propertyId: prop.id, unitNumber: body.unitNumber, buildingId: body.buildingId ?? null, bedrooms: body.bedrooms ?? null, bathrooms: body.bathrooms ?? null, squareFeet: body.squareFeet ?? null, targetRentCents: body.targetRentCents, status: body.status, availableFrom: body.availableFrom ? new Date(body.availableFrom) : body.status === 'vacant' ? new Date() : null } });
      await db.unitStatusHistory.create({ data: { tenantOrgId: ctx.tenantOrgId!, unitId: row.id, fromStatus: null, toStatus: row.status, changedBy: ctx.actor!.userId, reason: 'Unit created' } });
      await audit(ctx, { action: 'unit.create', resourceType: 'unit', resourceId: row.id, after: toDto(row), metadata: { propertyId: prop.id } });
      await publish(ctx, 'unit.created', { unitId: row.id, propertyId: prop.id, unitNumber: row.unitNumber, status: row.status });
      return { status: 201, body: unitDto(row) };
    } }),
  defineRoute({ method: 'get', path: '/units/:id', operationId: 'getUnit', summary: 'Unit detail', tags: ['property'], auth: 'session', permission: 'unit:read',
    request: { params: idParams }, responses: { 200: unit },
    handler: async ({ params, ctx }) => {
      const row = await loadUnitWithProperty(ctx, params.id);
      await requirePropertyAccess(ctx, 'unit:read', row.property, { type: 'unit', id: row.id });
      const { property: _p, ...u } = row;
      return { body: unitDto(u) };
    } }),
  defineRoute({ method: 'patch', path: '/units/:id', operationId: 'updateUnit', summary: 'Update unit attributes (status changes use POST /units/:id/status)', tags: ['property'], auth: 'session', permission: 'unit:write',
    request: { params: idParams, body: updateUnit }, responses: { 200: unit },
    handler: async ({ params, body, ctx }) => {
      const before = await loadUnitWithProperty(ctx, params.id);
      await requirePropertyAccess(ctx, 'unit:write', before.property, { type: 'unit', id: before.id });
      const db = tenantDb(ctx);
      if (body.buildingId && !(await db.building.findFirst({ where: { id: body.buildingId, propertyId: before.propertyId }, select: { id: true } }))) throw errors.validation([{ path: 'body.buildingId', message: 'Building does not belong to this property' }]);
      if (body.unitNumber && body.unitNumber !== before.unitNumber && (await db.unit.findFirst({ where: { propertyId: before.propertyId, unitNumber: body.unitNumber }, select: { id: true } }))) throw errors.conflict(`Unit ${body.unitNumber} already exists in this property`);
      const row = await db.unit.update({ where: { id: before.id }, data: { ...body, availableFrom: body.availableFrom === undefined ? undefined : body.availableFrom === null ? null : new Date(body.availableFrom) } });
      const { property: _p, ...prev } = before;
      await audit(ctx, { action: 'unit.update', resourceType: 'unit', resourceId: row.id, before: toDto(prev), after: body, metadata: { propertyId: row.propertyId } });
      return { body: unitDto(row) };
    } }),
  defineRoute({ method: 'post', path: '/units/:id/status', operationId: 'changeUnitStatus', summary: 'Transition unit status (vacant/occupied/notice/make_ready/down/reserved) with a required reason', tags: ['property'], auth: 'session', permission: 'unit:write',
    request: { params: idParams, body: unitStatusChange }, responses: { 200: unit },
    handler: async ({ params, body, ctx }) => {
      const before = await loadUnitWithProperty(ctx, params.id);
      await requirePropertyAccess(ctx, 'unit:write', before.property, { type: 'unit', id: before.id });
      const from = before.status as UnitStatus;
      unitStateMachine.assertTransition(from, body.toStatus, [...ctx.permissions]);
      const row = await prisma.$transaction(async (tx) => {
        const updated = await tx.unit.update({ where: { id: before.id }, data: { status: body.toStatus, availableFrom: body.availableFrom ? new Date(body.availableFrom) : body.toStatus === 'vacant' ? new Date() : body.toStatus === 'occupied' ? null : before.availableFrom } });
        await tx.unitStatusHistory.create({ data: { tenantOrgId: ctx.tenantOrgId!, unitId: before.id, fromStatus: from, toStatus: body.toStatus, changedBy: ctx.actor!.userId, reason: body.reason } });
        return updated;
      });
      await audit(ctx, { action: 'unit.status_change', resourceType: 'unit', resourceId: row.id, before: { status: from }, after: { status: body.toStatus, reason: body.reason }, metadata: { propertyId: row.propertyId } });
      await publish(ctx, 'unit.status_changed', { unitId: row.id, propertyId: row.propertyId, from, to: body.toStatus, reason: body.reason });
      return { status: 200, body: unitDto(row) };
    } }),
  defineRoute({ method: 'get', path: '/units/:id/history', operationId: 'listUnitStatusHistory', summary: 'Unit status history (newest first)', tags: ['property'], auth: 'session', permission: 'unit:read',
    request: { params: idParams, query: paginationQuery }, responses: { 200: unitStatusHistoryPage },
    handler: async ({ params, query, ctx }) => {
      const u = await loadUnitWithProperty(ctx, params.id);
      await requirePropertyAccess(ctx, 'unit:read', u.property, { type: 'unit', id: u.id });
      const c = decodeCursor<{ changedAt: string; id: string }>(query.cursor);
      const rows = await tenantDb(ctx).unitStatusHistory.findMany({
        where: { unitId: u.id, ...(c ? { OR: [{ changedAt: { lt: new Date(c.changedAt) } }, { changedAt: new Date(c.changedAt), id: { lt: c.id } }] } : {}) },
        take: query.limit + 1, orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
      });
      return { body: toDto(toPage(rows, query.limit, (r) => ({ changedAt: r.changedAt.toISOString(), id: r.id }))) };
    } }),

  // ---- Hierarchy (Day 19) ----
  defineRoute({ method: 'get', path: '/properties/:id/hierarchy', operationId: 'getPropertyHierarchy', summary: 'Portfolio -> property -> buildings -> units tree', tags: ['property'], auth: 'session', permission: 'property:read',
    request: { params: idParams }, responses: { 200: propertyHierarchy },
    handler: async ({ params, ctx }) => {
      const prop = await loadProperty(ctx, params.id);
      await requirePropertyAccess(ctx, 'property:read', prop);
      const db = tenantDb(ctx);
      const [pf, buildings, units, counts] = await Promise.all([
        prop.portfolioId ? db.portfolio.findFirst({ where: { id: prop.portfolioId }, select: { id: true, name: true } }) : Promise.resolve(null),
        db.building.findMany({ where: { propertyId: prop.id }, orderBy: { createdAt: 'asc' } }),
        db.unit.findMany({ where: { propertyId: prop.id }, orderBy: [{ unitNumber: 'asc' }, { id: 'asc' }], take: HIERARCHY_UNIT_CAP + 1 }),
        unitCountsFor(ctx, [prop.id]),
      ]);
      const truncated = units.length > HIERARCHY_UNIT_CAP;
      const visible = truncated ? units.slice(0, HIERARCHY_UNIT_CAP) : units;
      const byBuilding = new Map<string, typeof visible>();
      const unassigned: typeof visible = [];
      for (const u of visible) {
        if (u.buildingId) byBuilding.set(u.buildingId, [...(byBuilding.get(u.buildingId) ?? []), u]);
        else unassigned.push(u);
      }
      return { body: {
        portfolio: pf,
        property: { ...toDto(prop), unitCounts: counts.get(prop.id) ?? emptyCounts() },
        buildings: buildings.map((b) => { const bu = byBuilding.get(b.id) ?? []; return { ...toDto(b), unitCount: bu.length, units: bu.map(unitDto) }; }),
        unassignedUnits: unassigned.map(unitDto),
        unitCounts: counts.get(prop.id) ?? emptyCounts(),
        truncated,
      } };
    } }),
];

export const propertyRouter: Router = Router();
mount(propertyRouter, propertyRoutes);
