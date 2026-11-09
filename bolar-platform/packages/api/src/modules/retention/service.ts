import { createStorageAdapter } from '@bolar/integrations';
import { errors, systemContext, type RequestContext } from '@bolar/shared';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { isHeld } from '../legal-hold/service.js';

export interface SweepResult { scanned: number; proposed: number; held: number; ranAt: string }

/** Platform defaults plus org overrides; an org policy with the same key shadows the platform default. */
export async function effectivePolicies(tenantOrgId: string) {
  const rows = await prisma.retentionPolicy.findMany({ where: { OR: [{ tenantOrgId: null }, { tenantOrgId }] }, orderBy: [{ key: 'asc' }, { tenantOrgId: 'desc' }], take: 500 });
  const byKey = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const existing = byKey.get(r.key);
    if (!existing || (existing.tenantOrgId === null && r.tenantOrgId !== null)) byKey.set(r.key, r);
  }
  return [...byKey.values()].map((p) => ({ ...p, isPlatformDefault: p.tenantOrgId === null }));
}

export async function policyByKey(tenantOrgId: string, key: string) {
  return (await effectivePolicies(tenantOrgId)).find((p) => p.key === key) ?? null;
}

/**
 * Daily sweep (Day 47 "worker proposes high-risk deletion but does not execute without gate").
 * Due assignments become `proposed` (or `held` when a legal hold covers them). Never deletes. Idempotent:
 * only `retained` rows are touched, so re-running the same day is a no-op.
 */
export async function sweepRetention(ctx: RequestContext, now = new Date()): Promise<SweepResult> {
  const tenantOrgId = ctx.tenantOrgId!;
  const due = await prisma.retentionAssignment.findMany({ where: { tenantOrgId, state: 'retained', retainUntil: { lte: now } }, orderBy: { retainUntil: 'asc' }, take: 500 });
  let proposed = 0, held = 0;
  for (const a of due) {
    const check = await isHeld(tenantOrgId, a.resourceType, a.resourceId);
    if (check.held) {
      await prisma.retentionAssignment.update({ where: { id: a.id }, data: { state: 'held' } });
      await audit(ctx, { action: 'retention.held', resourceType: a.resourceType, resourceId: a.resourceId, metadata: { assignmentId: a.id, holdIds: check.holdIds } });
      held++;
    } else {
      await prisma.retentionAssignment.update({ where: { id: a.id }, data: { state: 'proposed', proposedAt: now } });
      await audit(ctx, { action: 'retention.proposed', resourceType: a.resourceType, resourceId: a.resourceId, metadata: { assignmentId: a.id, retainUntil: a.retainUntil.toISOString(), proposedBy: 'system' } });
      proposed++;
    }
  }
  return { scanned: due.length, proposed, held, ranAt: now.toISOString() };
}

/** Runs the sweep for every org; used by the worker's daily schedule. */
export async function sweepAllTenants(now = new Date()): Promise<Record<string, SweepResult>> {
  const orgs = await prisma.tenantOrg.findMany({ select: { id: true } });
  const out: Record<string, SweepResult> = {};
  for (const o of orgs) out[o.id] = await sweepRetention(systemContext(o.id, `retention_sweep_${now.getTime()}`), now);
  return out;
}

/**
 * Execute an approved disposition. Only notifications (hard delete), documents (soft delete) and media
 * (row + object) are disposed automatically; everything else is marked disposed with a manual note.
 */
export async function disposeAssignment(ctx: RequestContext, assignmentId: string, note?: string) {
  const tenantOrgId = ctx.tenantOrgId!;
  const a = await prisma.retentionAssignment.findFirst({ where: { id: assignmentId, tenantOrgId } });
  if (!a) throw errors.notFound();
  if (a.state !== 'approved') throw errors.invalidTransition(a.state, 'disposed');
  const check = await isHeld(tenantOrgId, a.resourceType, a.resourceId);
  if (check.held) {
    await prisma.retentionAssignment.update({ where: { id: a.id }, data: { state: 'held' } });
    await audit(ctx, { action: 'retention.dispose_blocked', resourceType: a.resourceType, resourceId: a.resourceId, outcome: 'deny', metadata: { assignmentId: a.id, holdIds: check.holdIds } });
    throw errors.legalHold();
  }
  const policy = await prisma.retentionPolicy.findUnique({ where: { id: a.policyId } });
  let dispositionNote = 'manual';
  let performed: Record<string, unknown> = {};
  if (a.resourceType === 'notification') {
    const r = await prisma.notification.deleteMany({ where: { id: a.resourceId, tenantOrgId } });
    dispositionNote = r.count ? 'hard_deleted' : 'already_gone';
    performed = { deleted: r.count };
  } else if (a.resourceType === 'document') {
    const r = await prisma.document.updateMany({ where: { id: a.resourceId, tenantOrgId, deletedAt: null }, data: { deletedAt: new Date() } });
    dispositionNote = r.count ? 'soft_deleted' : 'already_gone';
    performed = { softDeleted: r.count };
  } else if (a.resourceType === 'media') {
    const m = await prisma.mediaAsset.findFirst({ where: { id: a.resourceId, tenantOrgId } });
    if (m) {
      const storage = createStorageAdapter();
      await storage.deleteObject(m.storageKey);
      if (m.thumbnailKey) await storage.deleteObject(m.thumbnailKey);
      await prisma.mediaAsset.delete({ where: { id: m.id } });
      dispositionNote = 'deleted_with_object';
      performed = { deleted: 1, storageKey: m.storageKey };
    } else dispositionNote = 'already_gone';
  }
  const updated = await prisma.retentionAssignment.update({ where: { id: a.id }, data: { state: 'disposed', disposedAt: new Date() } });
  await audit(ctx, { action: 'retention.disposed', resourceType: a.resourceType, resourceId: a.resourceId, before: { state: a.state }, after: { state: 'disposed', ...performed }, metadata: { assignmentId: a.id, policyKey: policy?.key, disposition: policy?.disposition, dispositionNote, note } });
  return { row: updated, dispositionNote };
}
