import { errors, type Permission, type Relation, type RequestContext, type Role } from '@bolar/shared';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { hasRelationship, requireAccess, type ResourceRef } from '../../shared/access.js';

/**
 * Owner resolution + relationship gate shared by documents and media (Days 26-27).
 *
 * Documents and media hang off an owner (lease, unit, property, work order, ...). Staff roles get
 * scoped RBAC through requireAccess (property-scoped managers only see their properties). Portal
 * roles whose org-wide permission is only meaningful through a relationship (tenant, occupant,
 * vendor, landlord, corporate admin, government) must hold an active RelationshipEdge to the owner
 * or its parent property; otherwise the resource answers 404 and an `access.denied` audit row is written.
 */
export const STAFF_ROLES: readonly Role[] = ['platform_admin', 'org_admin', 'subaccount_admin', 'property_manager', 'bookkeeper', 'lawyer', 'compliance_officer', 'support_agent'];

export const OWNER_RELATIONS: Relation[] = ['owner_of', 'manages', 'tenant_of', 'occupant_of', 'assigned_to', 'vendor_for', 'represents', 'bookkeeper_for', 'member_of'];

export interface ResolvedOwner {
  type: string;
  id: string;
  propertyId: string | null;
  /** Extra user ids that count as related (work order requester, tenant profile portal user, vendor portal user). */
  relatedUserIds: string[];
}

export function isStaff(ctx: RequestContext): boolean {
  return ctx.roles.some((r) => STAFF_ROLES.includes(r.role));
}

/** Load the owner row inside the tenant; null when it does not exist in this org. */
export async function resolveOwner(tenantOrgId: string, ownerType: string, ownerId: string): Promise<ResolvedOwner | null> {
  const base = (propertyId: string | null, relatedUserIds: string[] = []): ResolvedOwner => ({ type: ownerType, id: ownerId, propertyId, relatedUserIds });
  switch (ownerType) {
    case 'org':
      return ownerId === tenantOrgId ? base(null) : null;
    case 'property': {
      const row = await prisma.property.findFirst({ where: { id: ownerId, tenantOrgId }, select: { id: true, ownerUserId: true } });
      return row ? base(row.id, row.ownerUserId ? [row.ownerUserId] : []) : null;
    }
    case 'unit': {
      const row = await prisma.unit.findFirst({ where: { id: ownerId, tenantOrgId }, select: { propertyId: true } });
      return row ? base(row.propertyId) : null;
    }
    case 'lease': {
      const row = await prisma.lease.findFirst({ where: { id: ownerId, tenantOrgId }, select: { propertyId: true, parties: { select: { tenantProfile: { select: { userId: true } } } } } });
      return row ? base(row.propertyId, row.parties.map((p) => p.tenantProfile.userId).filter((u): u is string => !!u)) : null;
    }
    case 'work_order': {
      const row = await prisma.workOrder.findFirst({ where: { id: ownerId, tenantOrgId }, select: { propertyId: true, requesterId: true, assignedUserId: true, vendor: { select: { userId: true } } } });
      return row ? base(row.propertyId, [row.requesterId, row.assignedUserId, row.vendor?.userId].filter((u): u is string => !!u)) : null;
    }
    case 'tenant_profile': {
      const row = await prisma.tenantProfile.findFirst({ where: { id: ownerId, tenantOrgId }, select: { userId: true } });
      return row ? base(null, row.userId ? [row.userId] : []) : null;
    }
    case 'vendor': {
      const row = await prisma.vendorProfile.findFirst({ where: { id: ownerId, tenantOrgId }, select: { userId: true } });
      return row ? base(null, row.userId ? [row.userId] : []) : null;
    }
    case 'case': {
      const row = await prisma.case.findFirst({ where: { id: ownerId, tenantOrgId }, select: { propertyId: true } });
      return row ? base(row.propertyId ?? null) : null;
    }
    case 'application': {
      const row = await prisma.application.findFirst({ where: { id: ownerId, tenantOrgId }, select: { propertyId: true } });
      return row ? base(row.propertyId ?? null) : null;
    }
    case 'inspection':
      // Inspections land with the maintenance wave; accept the id so photos can be attached ahead of time.
      return base(null);
    default:
      return null;
  }
}

export function ownerRef(owner: ResolvedOwner): ResourceRef {
  return { type: owner.type, id: owner.id, propertyId: owner.propertyId };
}

/**
 * Enforce `permission` on an owner. Staff: scoped RBAC (+ relationship fallback). Others: relationship required.
 * Denied -> 404 + access.denied audit. `collection` denials answer 403 instead (list/create without a resolvable owner).
 */
export async function requireOwnerAccess(ctx: RequestContext, permission: Permission, owner: ResolvedOwner, opts: { collection?: boolean } = {}): Promise<void> {
  if (!ctx.actor) throw errors.unauthenticated();
  const ref = ownerRef(owner);
  if (isStaff(ctx)) {
    await requireAccess(ctx, permission, ref, OWNER_RELATIONS);
    return;
  }
  const related = ctx.permissions.has(permission) && (owner.relatedUserIds.includes(ctx.actor.userId) || (await hasRelationship(ctx, OWNER_RELATIONS, ref)));
  if (related) return;
  await audit(ctx, { action: 'access.denied', resourceType: owner.type, resourceId: owner.id, outcome: 'deny', metadata: { permission, reason: 'no relationship to owner' } });
  throw opts.collection ? errors.forbidden() : errors.notFound();
}

/** Boolean variant for list filtering (no audit). */
export async function canAccessOwner(ctx: RequestContext, permission: Permission, owner: ResolvedOwner): Promise<boolean> {
  try {
    await requireOwnerAccess(ctx, permission, owner);
    return true;
  } catch {
    return false;
  }
}

export interface OwnerPair { ownerType: string; ownerId: string }

/**
 * Owners a relationship-bound actor may list. Expands property relationships to the property's
 * units, leases and work orders, and lease/unit relationships to their rows, plus the actor's own
 * tenant/vendor profile and requested work orders. Returns null for staff (no restriction).
 */
export async function visibleOwnersFor(ctx: RequestContext): Promise<OwnerPair[] | null> {
  if (!ctx.actor || !ctx.tenantOrgId) return [];
  if (isStaff(ctx)) return null;
  const tenantOrgId = ctx.tenantOrgId;
  const userId = ctx.actor.userId;
  const now = new Date();
  const edges = await prisma.relationshipEdge.findMany({
    where: { tenantOrgId, subjectType: 'user', subjectId: userId, relation: { in: OWNER_RELATIONS }, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
    select: { objectType: true, objectId: true },
  });
  const pairs = new Map<string, OwnerPair>();
  const add = (ownerType: string, ownerId: string) => pairs.set(`${ownerType}:${ownerId}`, { ownerType, ownerId });
  const propertyIds = new Set<string>();
  for (const e of edges) {
    add(e.objectType, e.objectId);
    if (e.objectType === 'property') propertyIds.add(e.objectId);
    if (e.objectType === 'portfolio') {
      const props = await prisma.property.findMany({ where: { tenantOrgId, portfolioId: e.objectId }, select: { id: true } });
      for (const p of props) { add('property', p.id); propertyIds.add(p.id); }
    }
  }
  const owned = await prisma.property.findMany({ where: { tenantOrgId, ownerUserId: userId }, select: { id: true } });
  for (const p of owned) { add('property', p.id); propertyIds.add(p.id); }
  if (propertyIds.size) {
    const ids = [...propertyIds];
    const [units, leases, wos] = await Promise.all([
      prisma.unit.findMany({ where: { tenantOrgId, propertyId: { in: ids } }, select: { id: true } }),
      prisma.lease.findMany({ where: { tenantOrgId, propertyId: { in: ids } }, select: { id: true } }),
      prisma.workOrder.findMany({ where: { tenantOrgId, propertyId: { in: ids } }, select: { id: true } }),
    ]);
    units.forEach((u) => add('unit', u.id)); leases.forEach((l) => add('lease', l.id)); wos.forEach((w) => add('work_order', w.id));
  }
  const [profiles, vendors, requested] = await Promise.all([
    prisma.tenantProfile.findMany({ where: { tenantOrgId, userId }, select: { id: true, parties: { select: { leaseId: true } } } }),
    prisma.vendorProfile.findMany({ where: { tenantOrgId, userId }, select: { id: true, workOrders: { select: { id: true } } } }),
    prisma.workOrder.findMany({ where: { tenantOrgId, OR: [{ requesterId: userId }, { assignedUserId: userId }] }, select: { id: true } }),
  ]);
  for (const p of profiles) { add('tenant_profile', p.id); p.parties.forEach((lp) => add('lease', lp.leaseId)); }
  for (const v of vendors) { add('vendor', v.id); v.workOrders.forEach((w) => add('work_order', w.id)); }
  requested.forEach((w) => add('work_order', w.id));
  return [...pairs.values()];
}
