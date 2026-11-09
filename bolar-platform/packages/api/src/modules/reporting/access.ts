import { errors, type Permission, type RequestContext, type Role } from '@bolar/shared';
import { Prisma } from '@bolar/db';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { propertyScopeWhere, resolvePropertyScope } from '../property/access.js';

/**
 * Reporting access model (blueprint Days 75-90 "tenant filters").
 *  - staff roles see the whole org;
 *  - landlords see rows of properties they are `owner_of` (property or portfolio edge) or own via `Property.ownerUserId`;
 *  - everyone else holding `finance:read` (tenants, corporate admins, ...) is denied with an `access.denied` audit row.
 * Every SQL statement the module runs is additionally filtered by `"tenantOrgId" = ctx.tenantOrgId`.
 */
const STAFF_ROLES: readonly Role[] = ['platform_admin', 'org_admin', 'subaccount_admin', 'property_manager', 'bookkeeper', 'support_agent'];

export type ReportScope = { kind: 'org' } | { kind: 'properties'; propertyIds: string[] };

export function isReportingStaff(ctx: RequestContext): boolean {
  return ctx.roles.some((r) => STAFF_ROLES.includes(r.role));
}

export async function denyReporting(ctx: RequestContext, permission: Permission, reason: string, ref?: { type: string; id: string } | null): Promise<never> {
  await audit(ctx, { action: 'access.denied', resourceType: ref?.type ?? 'report', resourceId: ref?.id ?? null, outcome: 'deny', metadata: { permission, reason } });
  throw ref ? errors.notFound() : errors.forbidden();
}

/** Resolve what the actor may report on. Throws 403 (audited) for roles that have no reporting surface. */
export async function reportingScope(ctx: RequestContext, permission: Permission = 'finance:read'): Promise<ReportScope> {
  if (!ctx.actor || !ctx.tenantOrgId) throw errors.unauthenticated();
  if (isReportingStaff(ctx)) return { kind: 'org' };
  if (!ctx.roles.some((r) => r.role === 'landlord')) return denyReporting(ctx, permission, 'reports are available to staff and landlords only');
  const scope = await resolvePropertyScope(ctx, 'property:read');
  if (scope.all) return { kind: 'org' };
  const owned = await prisma.property.findMany({
    where: { tenantOrgId: ctx.tenantOrgId, OR: [propertyScopeWhere(scope), { ownerUserId: ctx.actor.userId }] },
    select: { id: true },
  });
  return { kind: 'properties', propertyIds: owned.map((p) => p.id) };
}

/** Staff-only surfaces (AR aging, compliance hits, refresh). */
export async function requireReportingStaff(ctx: RequestContext, permission: Permission = 'finance:read'): Promise<void> {
  if (!ctx.actor) throw errors.unauthenticated();
  if (!isReportingStaff(ctx)) await denyReporting(ctx, permission, 'staff-only report');
}

/** SQL fragment restricting a view query to the scope's properties (the tenant filter is always added separately). */
export function scopeSql(scope: ReportScope, column = '"propertyId"'): Prisma.Sql {
  if (scope.kind === 'org') return Prisma.empty;
  if (!scope.propertyIds.length) return Prisma.sql` AND false`;
  return Prisma.sql` AND ${Prisma.raw(column)} IN (${Prisma.join(scope.propertyIds)})`;
}

/** A requested property filter outside the scope matches nothing (no existence leak). */
export function narrowScope(scope: ReportScope, propertyId?: string): ReportScope {
  if (!propertyId) return scope;
  if (scope.kind === 'org') return { kind: 'properties', propertyIds: [propertyId] };
  return { kind: 'properties', propertyIds: scope.propertyIds.includes(propertyId) ? [propertyId] : [] };
}
