import { errors, type Permission, type RequestContext, type Role } from '@bolar/shared';
import type { Prisma, WorkOrder, WorkOrderEvent } from '@bolar/db';
import { SLA_HOURS_BY_PRIORITY, WORK_ORDER_OPEN_STATUSES, type WorkOrderPriority, type WorkOrderDto, type WorkOrderEventDto, type WorkOrderStatus } from '@bolar/contracts';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { hasRelationship, hasScopedPermission, requireAccess, type ResourceRef } from '../../shared/access.js';
import { toDto } from '../../shared/route.js';
import { vendorTrades } from '../vendor/assignment.js';
import type { WorkOrderActorKind } from './state-machine.js';

/** Roles whose work_order permissions are scoped by RBAC/ReBAC on the property (not by being the requester or assignee). */
const STAFF_ROLES: readonly Role[] = ['platform_admin', 'org_admin', 'subaccount_admin', 'property_manager', 'landlord', 'support_agent'];

export const isStaff = (ctx: RequestContext) => ctx.roles.some((r) => STAFF_ROLES.includes(r.role));
export const hasRole = (ctx: RequestContext, role: Role) => ctx.roles.some((r) => r.role === role);
export const workOrderRef = (wo: { id: string; propertyId: string }): ResourceRef => ({ type: 'work_order', id: wo.id, propertyId: wo.propertyId });
export const workOrderNumber = (id: string) => `WO-${id.slice(-6).toUpperCase()}`;
export const isOpenStatus = (s: string) => (WORK_ORDER_OPEN_STATUSES as readonly string[]).includes(s);

export function slaDueFor(priority: WorkOrderPriority, from: Date): Date {
  return new Date(from.getTime() + SLA_HOURS_BY_PRIORITY[priority] * 3_600_000);
}

const activeEdge = (now: Date) => ({ AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] });

/** VendorProfile ids whose portal login is the actor (vendor access is limited to assigned jobs, p19 invariant). */
export async function myVendorIds(ctx: RequestContext): Promise<string[]> {
  if (!ctx.actor || !ctx.tenantOrgId) return [];
  const rows = await prisma.vendorProfile.findMany({ where: { tenantOrgId: ctx.tenantOrgId, userId: ctx.actor.userId }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Units the actor occupies, via tenant_of/occupant_of edges on unit or lease. */
export async function myUnitIds(ctx: RequestContext): Promise<string[]> {
  if (!ctx.actor || !ctx.tenantOrgId) return [];
  const now = new Date();
  const edges = await prisma.relationshipEdge.findMany({
    where: { tenantOrgId: ctx.tenantOrgId, subjectType: 'user', subjectId: ctx.actor.userId, relation: { in: ['tenant_of', 'occupant_of'] }, objectType: { in: ['unit', 'lease'] }, ...activeEdge(now) },
    select: { objectType: true, objectId: true },
  });
  const unitIds = new Set(edges.filter((e) => e.objectType === 'unit').map((e) => e.objectId));
  const leaseIds = edges.filter((e) => e.objectType === 'lease').map((e) => e.objectId);
  if (leaseIds.length) {
    const leases = await prisma.lease.findMany({ where: { tenantOrgId: ctx.tenantOrgId, id: { in: leaseIds } }, select: { unitId: true } });
    for (const l of leases) unitIds.add(l.unitId);
  }
  return [...unitIds];
}

async function assignedWorkOrderIds(ctx: RequestContext): Promise<string[]> {
  if (!ctx.actor || !ctx.tenantOrgId) return [];
  const rows = await prisma.relationshipEdge.findMany({ where: { tenantOrgId: ctx.tenantOrgId, subjectType: 'user', subjectId: ctx.actor.userId, relation: 'assigned_to', objectType: 'work_order', ...activeEdge(new Date()) }, select: { objectId: true } });
  return rows.map((r) => r.objectId);
}

/** Properties a staff actor covers, or null for org-wide visibility. */
async function staffPropertyIds(ctx: RequestContext): Promise<string[] | null> {
  if (ctx.roles.some((r) => STAFF_ROLES.includes(r.role) && (r.scopeType === 'org' || r.scopeType === 'platform'))) return null;
  const ids = new Set(ctx.roles.filter((r) => STAFF_ROLES.includes(r.role) && r.scopeType === 'property' && r.scopeId).map((r) => r.scopeId!));
  const edges = await prisma.relationshipEdge.findMany({ where: { tenantOrgId: ctx.tenantOrgId!, subjectType: 'user', subjectId: ctx.actor!.userId, relation: { in: ['manages', 'owner_of'] }, objectType: 'property', ...activeEdge(new Date()) }, select: { objectId: true } });
  for (const e of edges) ids.add(e.objectId);
  return [...ids];
}

/** Prisma filter limiting a list to what the actor may see (staff by property scope, vendors by assignment, residents by request/unit). */
export async function visibilityWhere(ctx: RequestContext): Promise<Prisma.WorkOrderWhereInput> {
  const ors: Prisma.WorkOrderWhereInput[] = [];
  if (isStaff(ctx)) {
    const props = await staffPropertyIds(ctx);
    if (props === null) return {};
    ors.push({ propertyId: { in: props } });
  }
  if (hasRole(ctx, 'vendor')) {
    const [vendorIds, woIds] = await Promise.all([myVendorIds(ctx), assignedWorkOrderIds(ctx)]);
    ors.push({ assignedVendorId: { in: vendorIds } }, { id: { in: woIds } });
  }
  if (hasRole(ctx, 'tenant') || hasRole(ctx, 'occupant') || !isStaff(ctx)) {
    ors.push({ requesterId: ctx.actor!.userId }, { unitId: { in: await myUnitIds(ctx) } });
  }
  return { OR: ors };
}

async function denyWorkOrder(ctx: RequestContext, wo: { id: string; propertyId: string }, permission: Permission, reason: string): Promise<never> {
  await audit(ctx, { action: 'access.denied', resourceType: 'work_order', resourceId: wo.id, outcome: 'deny', metadata: { permission, reason } });
  throw errors.notFound();
}

/** Is the actor the vendor assigned to this order (profile match or assigned_to edge)? */
export async function isAssignedVendor(ctx: RequestContext, wo: WorkOrder): Promise<boolean> {
  if (!hasRole(ctx, 'vendor')) return false;
  if (wo.assignedVendorId && (await myVendorIds(ctx)).includes(wo.assignedVendorId)) return true;
  return hasRelationship(ctx, ['assigned_to'], workOrderRef(wo));
}

/**
 * View access (Day 32/33 invariants): staff via scoped RBAC or manages/owner_of relationship (requireAccess, denied -> 404 + audit);
 * vendors only for assigned jobs; residents only for their own requests or their unit. Residents/vendors hold `work_order:read`
 * org-wide by role, so RBAC alone is never sufficient for them - the requester/assignment check is mandatory.
 */
export async function requireWorkOrderView(ctx: RequestContext, wo: WorkOrder): Promise<void> {
  if (!ctx.actor) throw errors.unauthenticated();
  if (isStaff(ctx)) { await requireAccess(ctx, 'work_order:read', workOrderRef(wo), ['manages', 'owner_of']); return; }
  if (wo.requesterId === ctx.actor.userId) return;
  if (await isAssignedVendor(ctx, wo)) return;
  if (wo.unitId && (await myUnitIds(ctx)).includes(wo.unitId)) return;
  await denyWorkOrder(ctx, wo, 'work_order:read', 'not requester, occupant or assigned vendor');
}

/** Staff write access on a specific order (manager/admin in scope, or manages relationship). */
export async function requireWorkOrderManage(ctx: RequestContext, wo: WorkOrder, permission: Permission = 'work_order:write'): Promise<void> {
  if (!ctx.actor) throw errors.unauthenticated();
  if (!isStaff(ctx)) await denyWorkOrder(ctx, wo, permission, 'not staff');
  await requireAccess(ctx, permission, workOrderRef(wo), ['manages']);
}

/** Who the actor is for the state machine. A user can be several (e.g. a manager who filed the request). */
export async function actorKindsFor(ctx: RequestContext, wo: WorkOrder): Promise<WorkOrderActorKind[]> {
  const kinds: WorkOrderActorKind[] = [];
  if (isStaff(ctx) && ctx.permissions.has('work_order:write')) {
    const ref = workOrderRef(wo);
    if (hasScopedPermission(ctx, 'work_order:write', ref) || (await hasRelationship(ctx, ['manages'], ref))) kinds.push('manager');
  }
  if (ctx.permissions.has('work_order:vendor_update') && (await isAssignedVendor(ctx, wo))) kinds.push('vendor');
  if (wo.requesterId === ctx.actor!.userId) kinds.push('tenant');
  return kinds;
}

export async function addEvent(ctx: RequestContext, workOrderId: string, eventType: string, payload: Record<string, unknown> = {}): Promise<WorkOrderEvent> {
  return prisma.workOrderEvent.create({ data: { tenantOrgId: ctx.tenantOrgId!, workOrderId, eventType, actorId: ctx.actor?.userId ?? null, payload: payload as never } });
}

export function eventDto(e: WorkOrderEvent, names: Map<string, string>): WorkOrderEventDto {
  return { ...(toDto(e) as unknown as WorkOrderEventDto), actorName: e.actorId ? (names.get(e.actorId) ?? null) : null, payload: (e.payload ?? {}) as Record<string, unknown> };
}

/** Enrich rows with property/unit/vendor/people summaries in a handful of batched queries. */
export async function toWorkOrderDtos(tenantOrgId: string, rows: WorkOrder[], now = new Date()): Promise<WorkOrderDto[]> {
  if (rows.length === 0) return [];
  const ids = <T>(xs: (T | null)[]) => [...new Set(xs.filter((x): x is T => x !== null))];
  const [properties, units, vendors, users] = await Promise.all([
    prisma.property.findMany({ where: { tenantOrgId, id: { in: ids(rows.map((r) => r.propertyId)) } }, select: { id: true, name: true } }),
    prisma.unit.findMany({ where: { tenantOrgId, id: { in: ids(rows.map((r) => r.unitId)) } }, select: { id: true, unitNumber: true } }),
    prisma.vendorProfile.findMany({ where: { tenantOrgId, id: { in: ids(rows.map((r) => r.assignedVendorId)) } }, select: { id: true, name: true, status: true, trades: true, phone: true, email: true } }),
    prisma.userProfile.findMany({ where: { tenantOrgId, id: { in: ids([...rows.map((r) => r.requesterId), ...rows.map((r) => r.assignedUserId)]) } }, select: { id: true, name: true } }),
  ]);
  const pMap = new Map(properties.map((p) => [p.id, p]));
  const uMap = new Map(units.map((u) => [u.id, u]));
  const vMap = new Map(vendors.map((v) => [v.id, v]));
  const nMap = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => {
    const vendor = r.assignedVendorId ? vendorsummary(vMap.get(r.assignedVendorId)) : null;
    const base = toDto(r) as unknown as Record<string, unknown>;
    return {
      ...base,
      number: workOrderNumber(r.id),
      status: r.status as WorkOrderStatus,
      availabilityJson: Array.isArray(r.availabilityJson) ? r.availabilityJson : [],
      overdue: Boolean(r.slaDueAt && r.slaDueAt < now && isOpenStatus(r.status)),
      property: pMap.get(r.propertyId) ?? null,
      unit: r.unitId ? (uMap.get(r.unitId) ?? null) : null,
      vendor,
      requester: nMap.get(r.requesterId) ?? null,
      assignee: r.assignedUserId ? (nMap.get(r.assignedUserId) ?? null) : null,
    } as WorkOrderDto;
  });
}

function vendorsummary(v: { id: string; name: string; status: string; trades: unknown; phone: string | null; email: string | null } | undefined) {
  return v ? { id: v.id, name: v.name, status: v.status, trades: vendorTrades(v), phone: v.phone, email: v.email } : null;
}

export async function userNames(tenantOrgId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const users = await prisma.userProfile.findMany({ where: { tenantOrgId, id: { in: uniq } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}
