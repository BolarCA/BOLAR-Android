import { errors, ROLE_PERMISSIONS, permissionsForRoles, type Permission, type Relation, type RequestContext, type ScopedRole } from '@bolar/shared';
import type { Prisma } from '@bolar/db';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { hasRelationship, rolesCovering, type AccessDecision, type ResourceRef } from '../../shared/access.js';

/**
 * Property-module access rules (Day 16 RBAC/ReBAC, blueprint p15/p16).
 *
 * Same engine as `requireAccess` (scoped RBAC first, then relationships) with two domain additions:
 * 1. The `landlord` role is relationship-gated for property data: an org-scoped landlord is a *member* of the
 *    org, not an owner of every property, so landlords see exactly what they are `owner_of` (property or
 *    portfolio) or what a property/subaccount-scoped assignment covers.
 * 2. `owner_of` a portfolio implies read access to every property in that portfolio.
 *
 * Denials are audited as `access.denied` and answered 404 so existence is not leaked.
 */
export const PROPERTY_RELATIONS: Relation[] = ['owner_of', 'manages', 'bookkeeper_for', 'vendor_for'];
const SUBACCOUNT_RELATIONS: Relation[] = ['manages', 'bookkeeper_for', 'member_of'];

export interface PropertyRef { id: string; portfolioId?: string | null; subaccountId?: string | null }

/** Roles that may grant org-wide property visibility (landlord never does). */
function propertyRoles(ctx: RequestContext): ScopedRole[] {
  return ctx.roles.filter((r) => !(r.role === 'landlord' && (r.scopeType === 'org' || r.scopeType === 'platform')));
}

function roleGrants(ctx: RequestContext, permission: Permission, ref: ResourceRef): boolean {
  return permissionsForRoles(rolesCovering(propertyRoles(ctx), ref).map((r) => r.role)).has(permission);
}

export async function decidePropertyAccess(ctx: RequestContext, permission: Permission, prop: PropertyRef): Promise<AccessDecision> {
  if (!ctx.actor) return { allowed: false, via: 'denied', reason: 'unauthenticated' };
  const ref: ResourceRef = { type: 'property', id: prop.id, propertyId: prop.id, subaccountId: prop.subaccountId ?? null };
  if (roleGrants(ctx, permission, ref)) return { allowed: true, via: 'role', reason: 'role grants permission in scope' };
  if (!ctx.permissions.has(permission)) return { allowed: false, via: 'denied', reason: 'permission not granted by any role' };
  if (await hasRelationship(ctx, PROPERTY_RELATIONS, ref)) return { allowed: true, via: 'relationship', reason: `relationship ${PROPERTY_RELATIONS.join('|')}` };
  if (prop.subaccountId && (await hasRelationship(ctx, SUBACCOUNT_RELATIONS, { type: 'subaccount', id: prop.subaccountId }))) return { allowed: true, via: 'relationship', reason: 'relationship to subaccount' };
  if (prop.portfolioId && (await hasRelationship(ctx, ['owner_of'], { type: 'portfolio', id: prop.portfolioId }))) return { allowed: true, via: 'relationship', reason: 'owner_of portfolio' };
  return { allowed: false, via: 'denied', reason: 'no covering role or relationship' };
}

/** Enforce access to one property (or a child unit/building via its property). Denied -> audited 404. */
export async function requirePropertyAccess(ctx: RequestContext, permission: Permission, prop: PropertyRef, resource: { type: string; id: string } = { type: 'property', id: prop.id }): Promise<AccessDecision> {
  if (!ctx.actor) throw errors.unauthenticated();
  const d = await decidePropertyAccess(ctx, permission, prop);
  if (!d.allowed) {
    await audit(ctx, { action: 'access.denied', resourceType: resource.type, resourceId: resource.id, outcome: 'deny', metadata: { permission, reason: d.reason, propertyId: prop.id } });
    throw errors.notFound();
  }
  return d;
}

export type PropertyScope = { all: true } | { all: false; propertyIds: string[]; portfolioIds: string[]; subaccountIds: string[] };

/**
 * Everything the actor may see for `permission`, used to filter list queries (Day 16 "tenant filters and
 * RBAC/ReBAC"). Org-wide roles see all; otherwise the union of scoped role assignments and relationship edges.
 */
export async function resolvePropertyScope(ctx: RequestContext, permission: Permission): Promise<PropertyScope> {
  if (!ctx.actor || !ctx.tenantOrgId) return { all: false, propertyIds: [], portfolioIds: [], subaccountIds: [] };
  const granting = propertyRoles(ctx).filter((r) => (ROLE_PERMISSIONS[r.role] as readonly string[]).includes(permission));
  if (granting.some((r) => r.scopeType === 'org' || r.scopeType === 'platform')) return { all: true };
  const propertyIds = new Set(granting.filter((r) => r.scopeType === 'property' && r.scopeId).map((r) => r.scopeId!));
  const subaccountIds = new Set(granting.filter((r) => r.scopeType === 'subaccount' && r.scopeId).map((r) => r.scopeId!));
  const portfolioIds = new Set<string>();
  if (ctx.permissions.has(permission)) {
    const now = new Date();
    const edges = await prisma.relationshipEdge.findMany({
      where: {
        tenantOrgId: ctx.tenantOrgId, subjectType: 'user', subjectId: ctx.actor.userId,
        OR: [
          { objectType: 'property', relation: { in: PROPERTY_RELATIONS } },
          { objectType: 'portfolio', relation: 'owner_of' },
          { objectType: 'subaccount', relation: { in: SUBACCOUNT_RELATIONS } },
        ],
        AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
      },
      select: { objectType: true, objectId: true },
    });
    for (const e of edges) {
      if (e.objectType === 'property') propertyIds.add(e.objectId);
      else if (e.objectType === 'portfolio') portfolioIds.add(e.objectId);
      else subaccountIds.add(e.objectId);
    }
  }
  return { all: false, propertyIds: [...propertyIds], portfolioIds: [...portfolioIds], subaccountIds: [...subaccountIds] };
}

/** Prisma filter restricting a Property query to the actor's scope. Empty scope matches nothing (not a 403: the role is valid, the actor simply has no properties yet). */
export function propertyScopeWhere(scope: PropertyScope): Prisma.PropertyWhereInput {
  if (scope.all) return {};
  const or: Prisma.PropertyWhereInput[] = [];
  if (scope.propertyIds.length) or.push({ id: { in: scope.propertyIds } });
  if (scope.portfolioIds.length) or.push({ portfolioId: { in: scope.portfolioIds } });
  if (scope.subaccountIds.length) or.push({ subaccountId: { in: scope.subaccountIds } });
  return or.length ? { OR: or } : { id: { in: [] } };
}

/** Portfolio visibility: org-wide roles, owner_of edge, ownerUserId, or any visible property inside it. */
export function portfolioScopeWhere(ctx: RequestContext, scope: PropertyScope): Prisma.PortfolioWhereInput {
  if (scope.all) return {};
  const or: Prisma.PortfolioWhereInput[] = [{ ownerUserId: ctx.actor!.userId }];
  if (scope.portfolioIds.length) or.push({ id: { in: scope.portfolioIds } });
  if (scope.propertyIds.length || scope.subaccountIds.length) or.push({ properties: { some: propertyScopeWhere({ ...scope, portfolioIds: [] }) } });
  return { OR: or };
}

export async function requirePortfolioAccess(ctx: RequestContext, permission: Permission, portfolioId: string): Promise<void> {
  if (!ctx.actor) throw errors.unauthenticated();
  const scope = await resolvePropertyScope(ctx, permission);
  const row = await prisma.portfolio.findFirst({ where: { id: portfolioId, tenantOrgId: ctx.tenantOrgId!, ...portfolioScopeWhere(ctx, scope) }, select: { id: true } });
  if (!row) {
    await audit(ctx, { action: 'access.denied', resourceType: 'portfolio', resourceId: portfolioId, outcome: 'deny', metadata: { permission, reason: 'no covering role or relationship' } });
    throw errors.notFound();
  }
}
