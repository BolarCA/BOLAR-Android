import { createHash } from 'node:crypto';
import { createStorageAdapter } from '@bolar/integrations';
import { forTenant } from '@bolar/db';
import { systemContext, type RequestContext } from '@bolar/shared';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { logger } from '../../logger.js';

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Drop redacted field names anywhere in the manifest (ssnLast4, dateOfBirth, ...). */
export function applyRedaction<T>(value: T, fields: string[]): T {
  if (!fields.length || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => applyRedaction(v, fields)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (fields.includes(k)) continue;
    out[k] = applyRedaction(v, fields);
  }
  return out as T;
}

interface Owner { ownerType: string; ownerId: string }

/** Resolve the record owners whose documents and audit trail belong in the packet. Tenant-scoped client only. */
async function ownersForSource(db: ReturnType<typeof forTenant>, sourceType: string, sourceId: string): Promise<{ owners: Owner[]; subjectIds: string[]; leaseIds: string[] }> {
  const owners: Owner[] = [{ ownerType: sourceType, ownerId: sourceId }];
  const subjectIds: string[] = [];
  const leaseIds: string[] = [];
  if (sourceType === 'case') {
    const c = await db.case.findFirst({ where: { id: sourceId } });
    if (c?.leaseId) { owners.push({ ownerType: 'lease', ownerId: c.leaseId }); leaseIds.push(c.leaseId); }
    if (c?.propertyId) owners.push({ ownerType: 'property', ownerId: c.propertyId });
    if (c?.tenantProfileId) { owners.push({ ownerType: 'tenant_profile', ownerId: c.tenantProfileId }); subjectIds.push(c.tenantProfileId); }
  } else if (sourceType === 'lease') {
    leaseIds.push(sourceId);
  } else if (sourceType === 'property') {
    const leases = await db.lease.findMany({ where: { propertyId: sourceId }, select: { id: true } });
    for (const l of leases) { owners.push({ ownerType: 'lease', ownerId: l.id }); leaseIds.push(l.id); }
  } else if (sourceType === 'tenant_profile') {
    subjectIds.push(sourceId);
  } else if (sourceType === 'agency_request') {
    const r = await db.agencyRequest.findFirst({ where: { id: sourceId } });
    const scope = (r?.scopeJson ?? {}) as { propertyIds?: string[]; leaseIds?: string[]; tenantProfileIds?: string[]; documentIds?: string[] };
    for (const id of scope.propertyIds ?? []) owners.push({ ownerType: 'property', ownerId: id });
    for (const id of scope.leaseIds ?? []) { owners.push({ ownerType: 'lease', ownerId: id }); leaseIds.push(id); }
    for (const id of scope.tenantProfileIds ?? []) { owners.push({ ownerType: 'tenant_profile', ownerId: id }); subjectIds.push(id); }
  } else if (sourceType === 'privacy_request') {
    const r = await db.privacyRequest.findFirst({ where: { id: sourceId } });
    const d = (r?.discoveryJson ?? {}) as { subjects?: { tenantProfileIds?: string[] }; ids?: { leaseIds?: string[] } };
    for (const id of d.subjects?.tenantProfileIds ?? []) { owners.push({ ownerType: 'tenant_profile', ownerId: id }); subjectIds.push(id); }
    for (const id of d.ids?.leaseIds ?? []) { owners.push({ ownerType: 'lease', ownerId: id }); leaseIds.push(id); }
  }
  if (leaseIds.length) {
    const parties = await db.leaseParty.findMany({ where: { leaseId: { in: leaseIds } }, select: { tenantProfileId: true } });
    for (const p of parties) if (!subjectIds.includes(p.tenantProfileId)) { subjectIds.push(p.tenantProfileId); owners.push({ ownerType: 'tenant_profile', ownerId: p.tenantProfileId }); }
  }
  return { owners, subjectIds, leaseIds };
}

/**
 * Build the evidence packet manifest for an approved export job (Day 50). Every query goes through the
 * tenant-scoped client so a second org's documents or audit rows can never appear. Idempotent: a completed
 * job returns its stored manifest.
 */
export async function runExportJob(exportJobId: string): Promise<{ status: string; manifest: Record<string, unknown> | null; sha256: string | null }> {
  const job = await prisma.exportJob.findUnique({ where: { id: exportJobId } });
  if (!job) throw new Error(`export job ${exportJobId} not found`);
  if (job.status === 'complete') return { status: job.status, manifest: job.manifestJson as Record<string, unknown>, sha256: job.manifestSha256 };
  if (job.status !== 'approved' && job.status !== 'running') throw new Error(`export job ${exportJobId} is ${job.status}; approval required before running`);
  const tenantOrgId = job.tenantOrgId;
  const db = forTenant(prisma, tenantOrgId);
  const ctx: RequestContext = systemContext(tenantOrgId, `export_${job.id}`);
  await prisma.exportJob.update({ where: { id: job.id }, data: { status: 'running', error: null } });
  try {
    const filters = (job.filtersJson ?? {}) as { dateFrom?: string; dateTo?: string; categories?: string[]; includeAudit?: boolean; scope?: { documentIds?: string[] } };
    const redaction = (job.redactionJson ?? {}) as { fields?: string[]; note?: string };
    const fields = redaction.fields ?? [];
    const { owners, subjectIds } = await ownersForSource(db, job.sourceType, job.sourceId);
    const dateWhere = filters.dateFrom || filters.dateTo ? { createdAt: { ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}), ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}) } } : {};
    const docs = await db.document.findMany({
      where: { deletedAt: null, OR: [...owners.map((o) => ({ ownerType: o.ownerType, ownerId: o.ownerId })), ...(filters.scope?.documentIds?.length ? [{ id: { in: filters.scope.documentIds } }] : [])], ...(filters.categories?.length ? { category: { in: filters.categories } } : {}), ...dateWhere },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } }, orderBy: { id: 'asc' }, take: 1000,
    });
    const files = docs.map((d) => {
      const v = d.versions[0] ?? null;
      return { documentId: d.id, versionId: v?.id ?? null, title: d.title, category: d.category, classification: d.classification, ownerType: d.ownerType, ownerId: d.ownerId, fileName: v?.fileName ?? null, sha256: v?.sha256 ?? null, storageKey: v?.storageKey ?? null, sizeBytes: v?.sizeBytes ?? null, legalHold: d.legalHold };
    });
    const auditTargets = [...owners.map((o) => ({ resourceType: o.ownerType, resourceId: o.ownerId })), ...docs.map((d) => ({ resourceType: 'document', resourceId: d.id }))];
    const auditRows = filters.includeAudit === false ? [] : await db.auditLog.findMany({ where: { OR: auditTargets, NOT: { action: 'access.denied' }, ...dateWhere }, orderBy: { id: 'asc' }, take: 5000 });
    const auditEvents = auditRows.map((a) => ({ id: a.id, actorId: a.actorId, action: a.action, resourceType: a.resourceType, resourceId: a.resourceId, outcome: a.outcome, requestId: a.requestId, purpose: a.purpose, metadata: a.metadata, createdAt: a.createdAt.toISOString() }));
    const subjectRows = subjectIds.length ? await db.tenantProfile.findMany({ where: { id: { in: subjectIds } }, select: { id: true, displayName: true, email: true, phone: true, dateOfBirth: true, ssnLast4: true, status: true, kind: true, classification: true } }) : [];
    const subjects = subjectRows.map((s) => ({ ...s, dateOfBirth: s.dateOfBirth ? s.dateOfBirth.toISOString().slice(0, 10) : null }));
    const base = {
      generatedAt: new Date().toISOString(),
      tenantOrgId,
      exportJobId: job.id,
      kind: job.kind,
      source: { type: job.sourceType, id: job.sourceId },
      filters: { ...filters },
      redaction: { fields, note: redaction.note ?? null },
      reviewer: { requestedBy: job.requestedBy, approvedBy: job.approvedBy },
      files,
      auditEvents,
      subjects,
      counts: { files: files.length, auditEvents: auditEvents.length, subjects: subjects.length, owners: owners.length },
    };
    const manifest = applyRedaction(base, fields);
    const body = Buffer.from(JSON.stringify(manifest, null, 2));
    const storageKey = `org/${tenantOrgId}/exports/${job.id}/manifest.json`;
    const put = await createStorageAdapter().putObject({ key: storageKey, body, contentType: 'application/json', metadata: { exportJobId: job.id, tenantOrgId } });
    const sha = put.sha256 || sha256Hex(body);
    await prisma.exportJob.update({ where: { id: job.id }, data: { status: 'complete', manifestJson: manifest as object, manifestSha256: sha, storageKey, completedAt: new Date() } });
    await audit(ctx, { action: 'export.completed', resourceType: 'export_job', resourceId: job.id, after: { manifestSha256: sha, storageKey, counts: manifest.counts } });
    await publish(ctx, 'export.completed', { exportJobId: job.id, tenantOrgId, manifestSha256: sha, storageKey });
    return { status: 'complete', manifest: manifest as Record<string, unknown>, sha256: sha };
  } catch (err) {
    logger.error({ err, exportJobId }, 'export job failed');
    const message = err instanceof Error ? err.message : 'export failed';
    await prisma.exportJob.update({ where: { id: job.id }, data: { status: 'failed', error: message.slice(0, 500) } });
    await audit(ctx, { action: 'export.failed', resourceType: 'export_job', resourceId: job.id, outcome: 'error', metadata: { error: message.slice(0, 200) } });
    return { status: 'failed', manifest: null, sha256: null };
  }
}

/** Audit manifest for one resource: ordered rows plus a sha256 over the serialized rows (Day 46 export). */
export async function buildAuditManifest(ctx: RequestContext, resourceType: string, resourceId: string, limit: number) {
  const db = forTenant(prisma, ctx.tenantOrgId!);
  const rows = await db.auditLog.findMany({ where: { resourceType, resourceId }, orderBy: { id: 'asc' }, take: limit + 1 });
  const truncated = rows.length > limit;
  const full = ctx.permissions.has('audit:read_sensitive');
  const items = (truncated ? rows.slice(0, limit) : rows).map((r) => ({
    id: r.id, actorId: r.actorId, action: r.action, resourceType: r.resourceType, resourceId: r.resourceId, outcome: r.outcome, requestId: r.requestId, purpose: r.purpose, policyVersion: r.policyVersion,
    before: full ? r.before : null, after: full ? r.after : null, metadata: r.metadata, createdAt: r.createdAt.toISOString(),
  }));
  const serialized = JSON.stringify(items);
  return { generatedAt: new Date().toISOString(), tenantOrgId: ctx.tenantOrgId!, resourceType, resourceId, count: items.length, truncated, sha256: sha256Hex(serialized), rows: items };
}
