import type { LegalHoldScopeDto } from '@bolar/contracts';
import { errors } from '@bolar/shared';
import { prisma } from '../../shared/db.js';

export interface HoldCheck { held: boolean; holdIds: string[] }

type ScopeKey = keyof LegalHoldScopeDto;
const SCOPE_KEY_FOR_TYPE: Record<string, ScopeKey> = {
  property: 'propertyIds',
  lease: 'leaseIds',
  case: 'caseIds',
  user: 'userIds',
  document: 'documentIds',
  tenant_profile: 'tenantProfileIds',
};

/**
 * Resolve the chain of (type, id) pairs a resource inherits holds from (Day 49 "prevent deletion for held records").
 * - document -> its owner (lease | property | case | tenant_profile) and that owner's parents
 * - lease -> its property; case -> its lease, property and tenant profile
 * - media / notification / other -> themselves only (plus owner for media when the owner type is scoped)
 */
export async function resolveHoldTargets(tenantOrgId: string, resourceType: string, resourceId: string): Promise<{ type: string; id: string }[]> {
  const targets: { type: string; id: string }[] = [{ type: resourceType, id: resourceId }];
  const seen = new Set([`${resourceType}:${resourceId}`]);
  const push = async (type: string, id: string | null | undefined) => {
    if (!id || seen.has(`${type}:${id}`)) return;
    seen.add(`${type}:${id}`);
    targets.push({ type, id });
    await expand(type, id);
  };
  const expand = async (type: string, id: string) => {
    if (type === 'document') {
      const doc = await prisma.document.findFirst({ where: { id, tenantOrgId }, select: { ownerType: true, ownerId: true } });
      if (doc && SCOPE_KEY_FOR_TYPE[doc.ownerType]) await push(doc.ownerType, doc.ownerId);
    } else if (type === 'media') {
      const m = await prisma.mediaAsset.findFirst({ where: { id, tenantOrgId }, select: { ownerType: true, ownerId: true } });
      if (m && SCOPE_KEY_FOR_TYPE[m.ownerType]) await push(m.ownerType, m.ownerId);
    } else if (type === 'lease') {
      const lease = await prisma.lease.findFirst({ where: { id, tenantOrgId }, select: { propertyId: true } });
      if (lease) await push('property', lease.propertyId);
    } else if (type === 'case') {
      const c = await prisma.case.findFirst({ where: { id, tenantOrgId }, select: { leaseId: true, propertyId: true, tenantProfileId: true } });
      if (c) {
        await push('lease', c.leaseId);
        await push('property', c.propertyId);
        await push('tenant_profile', c.tenantProfileId);
      }
    } else if (type === 'tenant_profile') {
      const parties = await prisma.leaseParty.findMany({ where: { tenantOrgId, tenantProfileId: id }, select: { leaseId: true } });
      for (const p of parties) await push('lease', p.leaseId);
    }
  };
  await expand(resourceType, resourceId);
  return targets;
}

/**
 * Is the resource (or any parent it belongs to) covered by an active legal hold?
 * Exported for the document/retention/privacy modules; also served as GET /legal-holds/check.
 */
export async function isHeld(tenantOrgId: string, resourceType: string, resourceId: string): Promise<HoldCheck> {
  const holds = await prisma.legalHold.findMany({ where: { tenantOrgId, status: 'active' }, select: { id: true, scopeJson: true } });
  if (holds.length === 0) return { held: false, holdIds: [] };
  const targets = await resolveHoldTargets(tenantOrgId, resourceType, resourceId);
  const holdIds = holds
    .filter((h) => {
      const scope = (h.scopeJson ?? {}) as Partial<Record<ScopeKey, string[]>>;
      return targets.some((t) => {
        const key = SCOPE_KEY_FOR_TYPE[t.type];
        return !!key && (scope[key] ?? []).includes(t.id);
      });
    })
    .map((h) => h.id);
  return { held: holdIds.length > 0, holdIds };
}

/** Convenience for callers that only need a boolean. */
export async function assertNotHeld(tenantOrgId: string, resourceType: string, resourceId: string): Promise<void> {
  const { held } = await isHeld(tenantOrgId, resourceType, resourceId);
  if (held) throw errors.legalHold();
}

/** Flag Document.legalHold for documents directly or indirectly covered so list views can show the badge without a join. */
export async function syncDocumentHoldFlags(tenantOrgId: string, scope: LegalHoldScopeDto, value: boolean): Promise<number> {
  const ownerOr: { ownerType: string; ownerId: { in: string[] } }[] = [];
  if (scope.leaseIds?.length) ownerOr.push({ ownerType: 'lease', ownerId: { in: scope.leaseIds } });
  if (scope.propertyIds?.length) ownerOr.push({ ownerType: 'property', ownerId: { in: scope.propertyIds } });
  if (scope.caseIds?.length) ownerOr.push({ ownerType: 'case', ownerId: { in: scope.caseIds } });
  if (scope.tenantProfileIds?.length) ownerOr.push({ ownerType: 'tenant_profile', ownerId: { in: scope.tenantProfileIds } });
  const where = { tenantOrgId, OR: [...(scope.documentIds?.length ? [{ id: { in: scope.documentIds } }] : []), ...ownerOr] };
  if (where.OR.length === 0) return 0;
  if (!value) {
    // Only clear the flag for documents no longer covered by another active hold.
    const docs = await prisma.document.findMany({ where, select: { id: true } });
    let cleared = 0;
    for (const d of docs) {
      const { held } = await isHeld(tenantOrgId, 'document', d.id);
      if (!held) { await prisma.document.update({ where: { id: d.id }, data: { legalHold: false } }); cleared++; }
    }
    return cleared;
  }
  const r = await prisma.document.updateMany({ where, data: { legalHold: true } });
  return r.count;
}
