import { AppError, errors, type Permission, type RequestContext } from '@bolar/shared';
import { LEASE_OCCUPYING_STATES, type LeaseDetailDto, type LeaseDto, type LeasePartyDto, type LeaseTransitionOptionDto, type LeaseState } from '@bolar/contracts';
import type { Prisma } from '@bolar/db';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { hasRelationship, requireAccess, type ResourceRef } from '../../shared/access.js';
import { publish } from '../../shared/events.js';
import { toDto } from '../../shared/route.js';
import { LEASE_TRANSITIONS, leaseMachine, type LeaseGuardContext } from './state-machine.js';
import { evaluateAndPersist, unresolvedBlocks } from '../compliance/service.js';
import { logger } from '../../logger.js';

/**
 * Compliance hook (blueprint Day 24 "rule checks", Day 45): when a lease enters review the deposit/rent rules for
 * the property's jurisdiction are evaluated and persisted so the review workspace shows hits; approval is refused
 * while a block-level hit is unresolved in the compliance queue.
 */
async function leaseComplianceFacts(ctx: RequestContext, row: LeaseRow): Promise<Record<string, unknown>> {
  const property = await prisma.property.findFirst({ where: { id: row.propertyId, tenantOrgId: ctx.tenantOrgId! }, select: { state: true } });
  const current = row.versions?.find((v) => v.id === row.currentVersionId) ?? row.versions?.[row.versions.length - 1];
  const terms = (current?.termsJson ?? {}) as Record<string, unknown>;
  return { rentCents: row.rentCents, depositCents: row.depositCents, state: property?.state ?? null, lateFeePercent: typeof terms.lateFeePercent === 'number' ? terms.lateFeePercent : null, leaseStatus: row.status };
}

async function evaluateLeaseCompliance(ctx: RequestContext, row: LeaseRow): Promise<void> {
  try {
    await evaluateAndPersist(ctx, { domains: ['deposit', 'rent'], resourceType: 'lease', resourceId: row.id, propertyId: row.propertyId, facts: await leaseComplianceFacts(ctx, row) });
  } catch (err) {
    // Rule evaluation must never hide the lease transition; the queue shows nothing and the audit log records the error.
    logger.error({ err, leaseId: row.id, requestId: ctx.requestId }, 'lease compliance evaluation failed');
  }
}

export const LEASE_INCLUDE = {
  unit: { include: { property: true } },
  parties: { include: { tenantProfile: { select: { id: true, displayName: true, kind: true, userId: true, email: true } } } },
  charges: true,
  versions: { orderBy: { version: 'asc' } },
} satisfies Prisma.LeaseInclude;
export type LeaseRow = Prisma.LeaseGetPayload<{ include: typeof LEASE_INCLUDE }>;

/** Roles that only ever see leases they are a party to (blueprint tenant portal rules). */
const PARTY_ONLY_ROLES = new Set(['tenant', 'occupant']);
const STAFF_RELATIONS = ['owner_of', 'manages', 'represents', 'bookkeeper_for', 'tenant_of', 'occupant_of'] as const;

export function partyRestricted(ctx: RequestContext): boolean {
  return ctx.roles.length > 0 && ctx.roles.every((r) => PARTY_ONLY_ROLES.has(r.role));
}

export function isParty(ctx: RequestContext, row: LeaseRow): boolean {
  return !!ctx.actor && row.parties.some((p) => p.tenantProfile.userId === ctx.actor!.userId);
}

function activeEdgeWindow(now = new Date()) {
  return { AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] };
}

/** Prisma filter limiting a list to the leases the actor may see. */
export async function visibleLeaseWhere(ctx: RequestContext): Promise<Prisma.LeaseWhereInput> {
  if (!ctx.actor || !ctx.tenantOrgId) return { id: { in: [] } };
  const base = { tenantOrgId: ctx.tenantOrgId, subjectType: 'user', subjectId: ctx.actor.userId, ...activeEdgeWindow() };
  if (partyRestricted(ctx)) {
    const edges = await prisma.relationshipEdge.findMany({ where: { ...base, relation: { in: ['tenant_of', 'occupant_of'] }, objectType: 'lease' }, select: { objectId: true } });
    return { OR: [{ parties: { some: { tenantProfile: { userId: ctx.actor.userId } } } }, { id: { in: edges.map((e) => e.objectId) } }] };
  }
  if (ctx.roles.some((r) => r.scopeType === 'org' || r.scopeType === 'platform')) return {};
  const edges = await prisma.relationshipEdge.findMany({ where: { ...base, relation: { in: [...STAFF_RELATIONS] }, objectType: { in: ['property', 'lease'] } }, select: { objectType: true, objectId: true } });
  const propertyIds = [...ctx.roles.filter((r) => r.scopeType === 'property' && r.scopeId).map((r) => r.scopeId!), ...edges.filter((e) => e.objectType === 'property').map((e) => e.objectId)];
  const leaseIds = edges.filter((e) => e.objectType === 'lease').map((e) => e.objectId);
  const subaccountIds = ctx.roles.filter((r) => r.scopeType === 'subaccount' && r.scopeId).map((r) => r.scopeId!);
  const or: Prisma.LeaseWhereInput[] = [{ propertyId: { in: propertyIds } }, { id: { in: leaseIds } }];
  if (subaccountIds.length) or.push({ unit: { property: { subaccountId: { in: subaccountIds } } } });
  return { OR: or };
}

/** Resource-level access: parties (via TenantProfile.userId) or relationships for tenants; scoped RBAC/ReBAC for staff. Denied -> 404. */
export async function assertLeaseAccess(ctx: RequestContext, row: LeaseRow, permission: Permission): Promise<void> {
  if (!ctx.actor) throw errors.unauthenticated();
  const ref: ResourceRef = { type: 'lease', id: row.id, propertyId: row.propertyId, subaccountId: row.unit.property.subaccountId };
  if (isParty(ctx, row) && ctx.permissions.has(permission)) return;
  if (partyRestricted(ctx)) {
    if (ctx.permissions.has(permission) && (await hasRelationship(ctx, ['tenant_of', 'occupant_of'], ref))) return;
    await audit(ctx, { action: 'access.denied', resourceType: 'lease', resourceId: row.id, outcome: 'deny', metadata: { permission, reason: 'not a party to this lease' } });
    throw errors.notFound();
  }
  await requireAccess(ctx, permission, ref, [...STAFF_RELATIONS]);
}

export async function loadLease(ctx: RequestContext, id: string, permission: Permission): Promise<LeaseRow> {
  const row = await tenantDb(ctx).lease.findFirst({ where: { id }, include: LEASE_INCLUDE });
  if (!row) throw errors.notFound();
  await assertLeaseAccess(ctx, row, permission);
  return row;
}

export async function reloadLease(ctx: RequestContext, id: string): Promise<LeaseRow> {
  return tenantDb(ctx).lease.findFirstOrThrow({ where: { id }, include: LEASE_INCLUDE });
}

/** Occupying leases on the unit whose [startDate,endDate] intersects the given range (Day 22 overlap rule). */
export async function findOverlaps(ctx: RequestContext, unitId: string, startDate: Date, endDate: Date, excludeId?: string) {
  return tenantDb(ctx).lease.findMany({
    where: { unitId, status: { in: [...LEASE_OCCUPYING_STATES] }, ...(excludeId ? { id: { not: excludeId } } : {}), startDate: { lte: endDate }, endDate: { gte: startDate } },
    select: { id: true, status: true, startDate: true, endDate: true },
    orderBy: { startDate: 'asc' },
  });
}

function partyDto(p: LeaseRow['parties'][number]): LeasePartyDto {
  return { id: p.id, leaseId: p.leaseId, tenantProfileId: p.tenantProfileId, role: p.role as LeasePartyDto['role'], signedAt: p.signedAt ? p.signedAt.toISOString() : null, displayName: p.tenantProfile.displayName, kind: p.tenantProfile.kind, userId: p.tenantProfile.userId };
}

export function serializeLease(row: LeaseRow): LeaseDto {
  const { unit, parties, charges: _c, versions: _v, tenantOrgId: _t, ...rest } = row;
  return {
    ...(toDto(rest) as unknown as Omit<LeaseDto, 'unit' | 'property' | 'parties'>),
    unit: { id: unit.id, unitNumber: unit.unitNumber, status: unit.status },
    property: { id: unit.property.id, name: unit.property.name, city: unit.property.city, state: unit.property.state },
    parties: parties.map(partyDto),
  };
}

export interface TransitionOptions {
  note?: string;
  signedAt?: string;
  activate?: boolean;
  /** Webhook/system actor: granted lease:write + lease:send for the transition, audited with actorId null. */
  system?: boolean;
  envelopeCompleted?: boolean;
}

function effectivePermissions(ctx: RequestContext, system: boolean): Permission[] {
  const set = new Set<Permission>(ctx.permissions);
  if (system) { set.add('lease:write'); set.add('lease:send'); }
  return [...set];
}

async function guardContext(ctx: RequestContext, row: LeaseRow, to: LeaseState, opts: TransitionOptions): Promise<LeaseGuardContext> {
  const needsOverlap = to === 'approved' || to === 'active';
  const overlaps = needsOverlap ? await findOverlaps(ctx, row.unitId, row.startDate, row.endDate, row.id) : [];
  const envelopeCompleted = opts.envelopeCompleted ?? (await tenantDb(ctx).signatureEnvelope.count({ where: { leaseId: row.id, status: 'completed' } })) > 0;
  return {
    lease: { status: row.status as LeaseState, startDate: row.startDate, endDate: row.endDate, createdBy: row.createdBy, currentVersionId: row.currentVersionId },
    partyCount: row.parties.length,
    versionCount: row.versions.length,
    overlaps: overlaps.length,
    actorId: ctx.actor?.userId ?? null,
    system: opts.system ?? false,
    note: opts.note,
    signedAt: opts.signedAt,
    activate: opts.activate,
    envelopeCompleted,
    today: new Date(),
  };
}

/** Next-state options for the actor (lifecycle rail). Note/signature artifacts are probed so the UI can collect them. */
export async function transitionOptions(ctx: RequestContext, row: LeaseRow): Promise<LeaseTransitionOptionDto[]> {
  const from = row.status as LeaseState;
  const perms = effectivePermissions(ctx, false);
  const probe = await guardContext(ctx, row, 'active', { note: 'probe', signedAt: new Date().toISOString() });
  const out: LeaseTransitionOptionDto[] = [];
  for (const to of [...new Set(leaseMachine.nextStates(from))]) {
    const r = leaseMachine.canTransition(from, to, perms, probe);
    out.push({ to, allowed: r.ok, reason: r.ok ? null : r.reason });
  }
  return out;
}

export async function serializeLeaseDetail(ctx: RequestContext, row: LeaseRow): Promise<LeaseDetailDto> {
  const transitions = await transitionOptions(ctx, row);
  const overlaps = await findOverlaps(ctx, row.unitId, row.startDate, row.endDate, row.id);
  const versions = row.versions.map((v) => toDto(v) as unknown as LeaseDetailDto['versions'][number]);
  return {
    ...serializeLease(row),
    charges: row.charges.map((c) => toDto(c) as unknown as LeaseDetailDto['charges'][number]),
    versions,
    currentVersion: versions.find((v) => v.id === row.currentVersionId) ?? null,
    transitions,
    allowedNextStates: transitions.filter((t) => t.allowed).map((t) => t.to),
    overlaps: overlaps.map((o) => ({ id: o.id, status: o.status as LeaseState, startDate: o.startDate.toISOString(), endDate: o.endDate.toISOString() })),
  };
}

async function setUnitStatus(ctx: RequestContext, row: LeaseRow, toStatus: string, reason: string): Promise<void> {
  if (row.unit.status === toStatus) return;
  const db = tenantDb(ctx);
  await db.unit.update({ where: { id: row.unitId }, data: { status: toStatus } });
  await db.unitStatusHistory.create({ data: { tenantOrgId: ctx.tenantOrgId!, unitId: row.unitId, fromStatus: row.unit.status, toStatus, changedBy: ctx.actor?.userId ?? 'system', reason } });
  await publish(ctx, 'unit.status_changed', { unitId: row.unitId, propertyId: row.propertyId, from: row.unit.status, to: toStatus, leaseId: row.id });
}

/**
 * Apply a lifecycle transition (Day 23): permission + guard check, status update, occupancy side effects,
 * audit event and `lease.transitioned` domain event. Guard failures carry the reason (409), overlap is 409 conflict.
 */
export async function transitionLease(ctx: RequestContext, row: LeaseRow, to: LeaseState, opts: TransitionOptions = {}): Promise<LeaseRow> {
  const from = row.status as LeaseState;
  const system = opts.system ?? false;
  const perms = effectivePermissions(ctx, system);
  // Permission first: an actor who may never reach `to` is denied before state is revealed (403, audited).
  const reaching = LEASE_TRANSITIONS.filter((t) => t.to === to);
  const gctx = await guardContext(ctx, row, to, opts);
  const result = leaseMachine.canTransition(from, to, perms, gctx);
  if (!result.ok) {
    if (result.reason === 'actor not allowed' || (reaching.length > 0 && !reaching.some((t) => t.allowed(perms)))) {
      await audit(ctx, { action: 'access.denied', resourceType: 'lease', resourceId: row.id, outcome: 'deny', metadata: { permission: 'lease:transition', from, to } });
      throw errors.forbidden();
    }
    if (result.reason.startsWith('no transition')) throw errors.invalidTransition(from, to);
    if (gctx.overlaps > 0 && /occupies/.test(result.reason)) throw errors.conflict(result.reason);
    if (/Approver cannot/.test(result.reason)) throw errors.forbidden(result.reason);
    if (/note/.test(result.reason)) throw errors.validation([{ path: 'body.note', message: result.reason }]);
    throw new AppError('invalid_transition', result.reason, 409, { details: { from, to } });
  }

  if (to === 'approved') {
    const blocks = await unresolvedBlocks(ctx, 'lease', row.id);
    if (blocks.length) throw errors.conflict(`Blocked by compliance rule ${blocks.join(', ')}; resolve it in the compliance queue first`);
  }

  const db = tenantDb(ctx);
  const now = new Date();
  await db.lease.update({ where: { id: row.id }, data: { status: to } });
  if (to === 'review') await evaluateLeaseCompliance(ctx, row);
  if (to === 'signed') {
    const signedAt = opts.signedAt ? new Date(opts.signedAt) : now;
    await db.leaseParty.updateMany({ where: { leaseId: row.id, signedAt: null }, data: { signedAt } });
  }
  if (to === 'active') await setUnitStatus(ctx, row, 'occupied', `lease ${row.id} active`);
  if (to === 'terminated') await setUnitStatus(ctx, row, 'notice', `lease ${row.id} terminated`);

  await audit(ctx, { action: 'lease.transition', resourceType: 'lease', resourceId: row.id, before: { status: from }, after: { status: to }, metadata: { from, to, note: opts.note ?? null, system, signedAt: opts.signedAt ?? null } });
  await publish(ctx, 'lease.transitioned', { leaseId: row.id, from, to, propertyId: row.propertyId, unitId: row.unitId, note: opts.note ?? null });
  if (to === 'signed') await publish(ctx, 'lease.signed', { leaseId: row.id, propertyId: row.propertyId, unitId: row.unitId });
  return reloadLease(ctx, row.id);
}
