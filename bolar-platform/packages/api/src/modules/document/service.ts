import { createHash } from 'node:crypto';
import { errors, isGated, classificationRank, type Classification, type RequestContext } from '@bolar/shared';
import type { Document, DocumentVersion } from '@bolar/db';
import { DOCUMENT_INLINE_MAX_BYTES, DOCUMENT_MAX_BYTES } from '@bolar/contracts';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { requireSensitiveAccess, clearedClassificationFor } from '../../shared/access.js';
import { toDto } from '../../shared/route.js';
import { storage, signedUrlTtlSeconds, orgPrefix, assertOrgKey, safeFileName } from '../storage/adapter.js';
import { virusScanner } from '../storage/scanner.js';
import { resolveOwner, requireOwnerAccess, visibleOwnersFor, type ResolvedOwner } from './owner-access.js';

export function documentDto(doc: Document) {
  return { ...toDto(doc), gated: isGated(doc.classification as Classification) };
}

export function versionDto(v: DocumentVersion) {
  return toDto(v);
}

/** Highest classification the actor clears for documents: explicit permission + purpose, or an approved request. */
export async function clearedDocumentClassification(ctx: RequestContext): Promise<Classification> {
  if (ctx.permissions.has('document:read_restricted') && ctx.purpose) return 'restricted';
  return clearedClassificationFor(ctx, 'document');
}

export function decodeInline(contentBase64: string | undefined, max = DOCUMENT_INLINE_MAX_BYTES): Buffer | null {
  if (contentBase64 === undefined) return null;
  const body = Buffer.from(contentBase64, 'base64');
  if (body.length === 0) throw errors.validation([{ path: 'body.contentBase64', message: 'Empty file' }]);
  if (body.length > max) throw errors.validation([{ path: 'body.contentBase64', message: `Inline uploads are limited to ${max} bytes; use the signed upload URL` }]);
  return body;
}

export function versionKey(tenantOrgId: string, documentId: string, version: number, fileName: string): string {
  return `${orgPrefix(tenantOrgId)}documents/${documentId}/v${version}/${safeFileName(fileName)}`;
}

/** Load a non-deleted document in the tenant and enforce owner access for `permission`. */
export async function loadDocument(ctx: RequestContext, id: string, permission: 'document:read' | 'document:write'): Promise<{ doc: Document; owner: ResolvedOwner }> {
  const doc = await tenantDb(ctx).document.findFirst({ where: { id, deletedAt: null } });
  if (!doc) throw errors.notFound();
  const owner = (await resolveOwner(ctx.tenantOrgId!, doc.ownerType, doc.ownerId)) ?? { type: doc.ownerType, id: doc.ownerId, propertyId: null, relatedUserIds: [] };
  await requireOwnerAccess(ctx, permission, owner);
  return { doc, owner };
}

/** Classification gate for confidential/restricted documents (invariant p21 "classification gates"). */
export async function requireDocumentClearance(ctx: RequestContext, doc: Document): Promise<void> {
  await requireSensitiveAccess(ctx, { resourceType: 'document', resourceId: doc.id, classification: doc.classification as Classification }, 'document:read_restricted');
}

export async function createVersionRecord(ctx: RequestContext, doc: Document, input: { fileName: string; mimeType: string; inline: Buffer | null }) {
  const db = tenantDb(ctx);
  const last = await db.documentVersion.findFirst({ where: { documentId: doc.id }, orderBy: { version: 'desc' }, select: { version: true } });
  const version = (last?.version ?? 0) + 1;
  const key = versionKey(ctx.tenantOrgId!, doc.id, version, input.fileName);
  let row = await db.documentVersion.create({ data: { tenantOrgId: ctx.tenantOrgId!, documentId: doc.id, version, storageKey: key, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.inline?.length ?? 0, sha256: '', scanStatus: 'pending', createdBy: ctx.actor!.userId } });
  await audit(ctx, { action: 'document.version_create', resourceType: 'document', resourceId: doc.id, after: { versionId: row.id, version, fileName: input.fileName, mimeType: input.mimeType, inline: !!input.inline } });
  let uploadUrl: { url: string; expiresAt: string } | undefined;
  if (input.inline) {
    await storage().putObject({ key, body: input.inline, contentType: input.mimeType, metadata: { tenantOrgId: ctx.tenantOrgId!, documentId: doc.id } });
    row = await finalizeVersion(ctx, doc, row, undefined);
  } else {
    uploadUrl = await storage().signedUrl(key, 'PUT', signedUrlTtlSeconds());
  }
  return { row, uploadUrl };
}

/**
 * Finalize an uploaded version: verify the object exists, compute sha256/size from storage, run the
 * (placeholder) virus scanner, promote to current version and publish `document.uploaded`.
 */
export async function finalizeVersion(ctx: RequestContext, doc: Document, version: DocumentVersion, expectedSha256: string | undefined): Promise<DocumentVersion> {
  assertOrgKey(ctx.tenantOrgId!, version.storageKey);
  if (version.scanStatus !== 'pending') return version;
  const obj = await storage().getObject(version.storageKey);
  if (!obj) throw errors.conflict('Upload has not been received yet');
  if (obj.body.length > DOCUMENT_MAX_BYTES) throw errors.validation([{ path: 'body', message: 'Object exceeds 25 MB' }]);
  const sha256 = createHash('sha256').update(obj.body).digest('hex');
  if (expectedSha256 && expectedSha256.toLowerCase() !== sha256) {
    await audit(ctx, { action: 'document.finalize', resourceType: 'document', resourceId: doc.id, outcome: 'error', metadata: { versionId: version.id, reason: 'sha256_mismatch' } });
    throw errors.conflict('Uploaded bytes do not match the provided sha256');
  }
  const scan = await virusScanner().scan({ key: version.storageKey, body: obj.body, mimeType: version.mimeType, sizeBytes: obj.body.length });
  const db = tenantDb(ctx);
  const updated = await db.documentVersion.update({ where: { id: version.id }, data: { sha256, sizeBytes: obj.body.length, scanStatus: scan.verdict } });
  if (scan.verdict === 'infected') {
    await audit(ctx, { action: 'document.finalize', resourceType: 'document', resourceId: doc.id, outcome: 'error', metadata: { versionId: version.id, scan: scan.engine, verdict: scan.verdict } });
    throw errors.conflict('File failed the malware scan');
  }
  await db.document.update({ where: { id: doc.id }, data: { currentVersionId: updated.id } });
  await audit(ctx, { action: 'document.finalize', resourceType: 'document', resourceId: doc.id, after: { versionId: updated.id, version: updated.version, sizeBytes: updated.sizeBytes, sha256, scan: scan.engine, verdict: scan.verdict } });
  await publish(ctx, 'document.uploaded', { documentId: doc.id, versionId: updated.id, version: updated.version, ownerType: doc.ownerType, ownerId: doc.ownerId, classification: doc.classification, category: doc.category, mimeType: updated.mimeType, sizeBytes: updated.sizeBytes });
  return updated;
}

/** Issue a time-boxed signed GET URL for a version (TTL from STORAGE_SIGNED_URL_TTL_SECONDS). */
export async function downloadUrlFor(ctx: RequestContext, doc: Document, version: DocumentVersion) {
  assertOrgKey(ctx.tenantOrgId!, version.storageKey);
  if (version.scanStatus !== 'clean') throw errors.conflict(`Version is ${version.scanStatus}; only clean versions can be downloaded`);
  const signed = await storage().signedUrl(version.storageKey, 'GET', signedUrlTtlSeconds());
  await audit(ctx, { action: 'document.download', resourceType: 'document', resourceId: doc.id, metadata: { versionId: version.id, version: version.version, expiresAt: signed.expiresAt, classification: doc.classification } });
  return { url: signed.url, expiresAt: signed.expiresAt };
}

/** Legal hold check: document flag, or an active LegalHold whose scope names the document or its owner. */
export async function isUnderLegalHold(tenantOrgId: string, doc: Document): Promise<boolean> {
  if (doc.legalHold) return true;
  const holds = await prisma.legalHold.findMany({ where: { tenantOrgId, status: 'active' }, select: { scopeJson: true } });
  const ownerKey = `${doc.ownerType}Ids`;
  return holds.some((h) => {
    const scope = (h.scopeJson ?? {}) as Record<string, unknown>;
    const inList = (k: string, id: string) => Array.isArray(scope[k]) && (scope[k] as unknown[]).includes(id);
    return inList('documentIds', doc.id) || inList(ownerKey, doc.ownerId);
  });
}

/** Prisma filter restricting a list to the owners a relationship-bound actor may see. */
export async function ownerVisibilityFilter(ctx: RequestContext): Promise<Record<string, unknown> | null> {
  const visible = await visibleOwnersFor(ctx);
  if (visible === null) return {};
  if (visible.length === 0) return null;
  return { OR: visible.map((v) => ({ ownerType: v.ownerType, ownerId: v.ownerId })) };
}

export function classificationsUpTo(cleared: Classification): Classification[] {
  return (['public', 'internal', 'confidential', 'restricted'] as Classification[]).filter((c) => classificationRank(c) <= classificationRank(cleared));
}
