import { errors, type Permission, type RequestContext, type Role } from '@bolar/shared';
import { Prisma } from '@bolar/db';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';

/**
 * Finance access model (blueprint p20/p31). `finance:read` is held by staff *and* by tenants/landlords,
 * so lists are narrowed by relationship for non-staff roles:
 *  - staff roles (bookkeeper, admins, property manager) see the whole org;
 *  - tenants see invoices/payments of leases they are party to (`tenant_of` edge or TenantProfile.userId);
 *  - landlords see invoices of properties they own (`owner_of` edge or Property.ownerUserId).
 * Ledger, chart of accounts and reconciliation views are staff-only. Bank data needs `bank:read`.
 */
const STAFF_ROLES: readonly Role[] = ['platform_admin', 'org_admin', 'subaccount_admin', 'property_manager', 'bookkeeper', 'support_agent'];

export type FinanceScope = { kind: 'org' } | { kind: 'scoped'; leaseIds: string[]; propertyIds: string[] };

export function isFinanceStaff(ctx: RequestContext): boolean {
  return ctx.roles.some((r) => STAFF_ROLES.includes(r.role));
}

export async function financeScope(ctx: RequestContext): Promise<FinanceScope> {
  if (!ctx.actor || !ctx.tenantOrgId) throw errors.unauthenticated();
  if (isFinanceStaff(ctx)) return { kind: 'org' };
  const now = new Date();
  const edges = await prisma.relationshipEdge.findMany({
    where: {
      tenantOrgId: ctx.tenantOrgId, subjectType: 'user', subjectId: ctx.actor.userId, relation: { in: ['tenant_of', 'occupant_of', 'owner_of'] },
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
    },
    select: { relation: true, objectType: true, objectId: true },
  });
  const leaseIds = new Set<string>();
  const propertyIds = new Set<string>();
  const unitIds: string[] = [];
  for (const e of edges) {
    if ((e.relation === 'tenant_of' || e.relation === 'occupant_of') && e.objectType === 'lease') leaseIds.add(e.objectId);
    else if (e.relation === 'tenant_of' && e.objectType === 'unit') unitIds.push(e.objectId);
    else if (e.relation === 'owner_of' && e.objectType === 'property') propertyIds.add(e.objectId);
  }
  if (unitIds.length) {
    const leases = await prisma.lease.findMany({ where: { tenantOrgId: ctx.tenantOrgId, unitId: { in: unitIds } }, select: { id: true } });
    for (const l of leases) leaseIds.add(l.id);
  }
  const profiles = await prisma.tenantProfile.findMany({ where: { tenantOrgId: ctx.tenantOrgId, userId: ctx.actor.userId }, select: { id: true } });
  if (profiles.length) {
    const parties = await prisma.leaseParty.findMany({ where: { tenantOrgId: ctx.tenantOrgId, tenantProfileId: { in: profiles.map((p) => p.id) } }, select: { leaseId: true } });
    for (const p of parties) leaseIds.add(p.leaseId);
  }
  const owned = await prisma.property.findMany({ where: { tenantOrgId: ctx.tenantOrgId, ownerUserId: ctx.actor.userId }, select: { id: true } });
  for (const p of owned) propertyIds.add(p.id);
  return { kind: 'scoped', leaseIds: [...leaseIds], propertyIds: [...propertyIds] };
}

/** Prisma `where` fragment restricting invoices to the actor's scope. Returns null when the scope is empty. */
export function invoiceScopeWhere(scope: FinanceScope): Prisma.InvoiceWhereInput | null {
  if (scope.kind === 'org') return {};
  if (!scope.leaseIds.length && !scope.propertyIds.length) return null;
  const or: Prisma.InvoiceWhereInput[] = [];
  if (scope.leaseIds.length) or.push({ leaseId: { in: scope.leaseIds } });
  if (scope.propertyIds.length) or.push({ lease: { propertyId: { in: scope.propertyIds } } });
  return { OR: or };
}

export function leaseInScope(scope: FinanceScope, lease: { id: string; propertyId: string }): boolean {
  if (scope.kind === 'org') return true;
  return scope.leaseIds.includes(lease.id) || scope.propertyIds.includes(lease.propertyId);
}

/** Deny with an `access.denied` audit row; 404 for a specific resource (no existence leak), 403 for collections. */
export async function denyFinance(ctx: RequestContext, permission: Permission, ref?: { type: string; id: string } | null, reason = 'outside finance scope'): Promise<never> {
  await audit(ctx, { action: 'access.denied', resourceType: ref?.type ?? 'finance', resourceId: ref?.id ?? null, outcome: 'deny', metadata: { permission, reason } });
  throw ref ? errors.notFound() : errors.forbidden();
}

/** Staff-only finance surfaces (ledger, chart of accounts, reconciliation, aging). */
export async function requireFinanceStaff(ctx: RequestContext, permission: Permission = 'finance:read'): Promise<void> {
  if (!ctx.actor) throw errors.unauthenticated();
  if (!isFinanceStaff(ctx)) await denyFinance(ctx, permission, null, 'ledger views are staff-only');
}

export function canSeeBankData(ctx: RequestContext): boolean {
  return ctx.permissions.has('bank:read');
}

/** Posted journal rows are immutable at the DB level (trigger). Surface that as 409 rather than 500. */
export function isImmutabilityViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /immutable|append-only/i.test(msg) || (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2010' && /immutable/i.test(JSON.stringify(err.meta ?? {})));
}

export async function guardImmutable<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isImmutabilityViolation(err)) throw errors.conflict('Posted ledger records are immutable; post a reversal instead');
    throw err;
  }
}
