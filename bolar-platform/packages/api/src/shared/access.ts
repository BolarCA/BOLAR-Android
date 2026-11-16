import {
  errors,
  isGated,
  permissionsForRoles,
  type Classification,
  type Permission,
  type Relation,
  type RequestContext,
  type ScopedRole,
} from '@bolar/shared';
import { prisma } from './db.js';
import { audit } from './audit.js';

export interface ResourceRef {
  type: string; // object type for relationships (property, lease, work_order, case, ...)
  id: string;
  propertyId?: string | null;
  subaccountId?: string | null;
  caseId?: string | null;
}

/** Permission granted by any role, ignoring scope (org-wide check). */
export function hasPermission(ctx: RequestContext, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

export function requirePermission(ctx: RequestContext, permission: Permission): void {
  if (!ctx.actor) throw errors.unauthenticated();
  if (!hasPermission(ctx, permission)) throw errors.forbidden();
}

/** Roles whose scope covers the resource. platform/org cover everything in the org. */
export function rolesCovering(roles: ScopedRole[], ref?: ResourceRef | null): ScopedRole[] {
  return roles.filter((r) => {
    if (r.scopeType === 'platform' || r.scopeType === 'org') return true;
    if (!ref) return false;
    if (r.scopeType === 'property') return !!ref.propertyId && r.scopeId === ref.propertyId || (ref.type === 'property' && r.scopeId === ref.id);
    if (r.scopeType === 'subaccount') return !!ref.subaccountId && r.scopeId === ref.subaccountId || (ref.type === 'subaccount' && r.scopeId === ref.id);
    if (r.scopeType === 'case') return !!ref.caseId && r.scopeId === ref.caseId || (ref.type === 'case' && r.scopeId === ref.id);
    return false;
  });
}

/** Scoped RBAC: permission must come from a role whose scope covers the resource. */
export function hasScopedPermission(ctx: RequestContext, permission: Permission, ref?: ResourceRef | null): boolean {
  const covering = rolesCovering(ctx.roles, ref);
  return permissionsForRoles(covering.map((r) => r.role)).has(permission);
}

/** ReBAC: does the actor hold one of the relations to the object (or its parent property/case)? */
export async function hasRelationship(ctx: RequestContext, relations: Relation[], ref: ResourceRef): Promise<boolean> {
  if (!ctx.actor || !ctx.tenantOrgId) return false;
  const now = new Date();
  const objects: { objectType: string; objectId: string }[] = [{ objectType: ref.type, objectId: ref.id }];
  if (ref.propertyId && ref.type !== 'property') objects.push({ objectType: 'property', objectId: ref.propertyId });
  if (ref.subaccountId) objects.push({ objectType: 'subaccount', objectId: ref.subaccountId });
  if (ref.caseId && ref.type !== 'case') objects.push({ objectType: 'case', objectId: ref.caseId });
  const edge = await prisma.relationshipEdge.findFirst({
    where: {
      tenantOrgId: ctx.tenantOrgId,
      subjectType: 'user',
      subjectId: ctx.actor.userId,
      relation: { in: relations },
      OR: objects,
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    },
    select: { id: true },
  });
  return !!edge;
}

export interface AccessDecision {
  allowed: boolean;
  via: 'role' | 'relationship' | 'denied';
  reason: string;
}

/**
 * Combined RBAC + ReBAC decision (Days 12-13). Allowed when a covering role grants the permission,
 * or when the actor has an allowed relationship to the resource and the permission is in the
 * relationship-permitted set.
 */
export async function decide(
  ctx: RequestContext,
  permission: Permission,
  ref?: ResourceRef | null,
  relations: Relation[] = [],
): Promise<AccessDecision> {
  if (!ctx.actor) return { allowed: false, via: 'denied', reason: 'unauthenticated' };
  if (hasScopedPermission(ctx, permission, ref)) return { allowed: true, via: 'role', reason: 'role grants permission in scope' };
  if (ref && relations.length && ctx.permissions.has(permission) && (await hasRelationship(ctx, relations, ref))) {
    return { allowed: true, via: 'relationship', reason: `relationship ${relations.join('|')}` };
  }
  return { allowed: false, via: 'denied', reason: 'no covering role or relationship' };
}

/**
 * Enforce access. On denial for a specific resource we answer 404 so restricted resource
 * existence is not leaked (API design rule p23); for collection/create actions we answer 403.
 */
export async function requireAccess(ctx: RequestContext, permission: Permission, ref?: ResourceRef | null, relations: Relation[] = []): Promise<AccessDecision> {
  if (!ctx.actor) throw errors.unauthenticated();
  const d = await decide(ctx, permission, ref, relations);
  if (!d.allowed) {
    await audit(ctx, { action: 'access.denied', resourceType: ref?.type ?? permission.split(':')[0]!, resourceId: ref?.id ?? null, outcome: 'deny', metadata: { permission, reason: d.reason } });
    throw ref ? errors.notFound() : errors.forbidden();
  }
  return d;
}

/**
 * Sensitive access gate (Day 14). Confidential/restricted data requires either an approved
 * SensitiveAccessRequest for the resource (or wildcard) that has not expired, or a role with the
 * explicit *_sensitive permission plus a declared purpose. Every pass and block is audited.
 */
export async function requireSensitiveAccess(
  ctx: RequestContext,
  ref: { resourceType: string; resourceId: string; classification: Classification },
  sensitivePermission?: Permission,
): Promise<void> {
  if (!isGated(ref.classification)) return;
  if (!ctx.actor || !ctx.tenantOrgId) throw errors.unauthenticated();
  if (sensitivePermission && ctx.permissions.has(sensitivePermission) && ctx.purpose) {
    await audit(ctx, { action: 'sensitive.access', resourceType: ref.resourceType, resourceId: ref.resourceId, outcome: 'allow', metadata: { via: 'permission', permission: sensitivePermission, classification: ref.classification } });
    return;
  }
  const approval = await prisma.sensitiveAccessRequest.findFirst({
    where: {
      tenantOrgId: ctx.tenantOrgId,
      actorId: ctx.actor.userId,
      resourceType: ref.resourceType,
      resourceId: { in: [ref.resourceId, '*'] },
      status: 'approved',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: 'desc' },
  });
  if (approval && (approval.classification === 'restricted' || ref.classification === 'confidential')) {
    await audit(ctx, { action: 'sensitive.access', resourceType: ref.resourceType, resourceId: ref.resourceId, outcome: 'allow', metadata: { via: 'approval', approvalId: approval.id, purpose: approval.purpose, classification: ref.classification } });
    return;
  }
  await audit(ctx, { action: 'sensitive.access', resourceType: ref.resourceType, resourceId: ref.resourceId, outcome: 'review_required', metadata: { classification: ref.classification } });
  throw errors.reviewRequired();
}

/** Highest classification the actor currently clears for a resource type (used to redact list responses). */
export async function clearedClassificationFor(ctx: RequestContext, resourceType: string, resourceId?: string): Promise<Classification> {
  if (!ctx.actor || !ctx.tenantOrgId) return 'public';
  const approval = await prisma.sensitiveAccessRequest.findFirst({
    where: { tenantOrgId: ctx.tenantOrgId, actorId: ctx.actor.userId, resourceType, resourceId: { in: [resourceId ?? '*', '*'] }, status: 'approved', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { createdAt: 'desc' },
  });
  if (approval?.classification === 'restricted') return 'restricted';
  if (approval?.classification === 'confidential') return 'confidential';
  return 'internal';
}
