import { Router } from 'express';
import { idParams, documentDetail, documentPage, documentQuery, createDocument, createDocumentResponse, createDocumentVersion, createDocumentVersionResponse, finalizeDocumentVersion, documentVersionParams, downloadUrl } from '@bolar/contracts';
import { errors, toPage, decodeCursor, type Classification } from '@bolar/shared';
import { defineRoute, mount, type RouteDef } from '../../shared/route.js';
import { tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { requireAccess } from '../../shared/access.js';
import { resolveOwner, requireOwnerAccess, isStaff } from './owner-access.js';
import { documentDto, versionDto, clearedDocumentClassification, decodeInline, loadDocument, requireDocumentClearance, createVersionRecord, finalizeVersion, downloadUrlFor, isUnderLegalHold, ownerVisibilityFilter, classificationsUpTo } from './service.js';

/**
 * Documents (Day 26): classified, owner-linked, versioned objects in org-prefixed storage.
 * Confidential/restricted reads pass the sensitive-access gate; restricted rows are hidden from
 * lists unless cleared; deletion is soft and blocked under legal hold; every step is audited.
 */
export const documentRoutes: RouteDef[] = [
  defineRoute({ method: 'get', path: '/documents', operationId: 'listDocuments', summary: 'List documents visible to the caller (restricted rows hidden unless cleared)', tags: ['document'], auth: 'session', permission: 'document:read',
    request: { query: documentQuery }, responses: { 200: documentPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const visibility = await ownerVisibilityFilter(ctx);
      if (visibility === null) return { body: { items: [], nextCursor: null } };
      if (query.ownerType && query.ownerId && !isStaff(ctx)) {
        const owner = await resolveOwner(ctx.tenantOrgId!, query.ownerType, query.ownerId);
        if (!owner) return { body: { items: [], nextCursor: null } };
        await requireOwnerAccess(ctx, 'document:read', owner);
      }
      const cleared = await clearedDocumentClassification(ctx);
      // Classification gate on lists: restricted rows are invisible unless the caller is cleared for them;
      // confidential rows are listed (metadata only) and gated on detail/download.
      const allowed = classificationsUpTo(cleared === 'restricted' ? 'restricted' : 'confidential');
      if (query.classification && !allowed.includes(query.classification)) return { body: { items: [], nextCursor: null } };
      const rows = await tenantDb(ctx).document.findMany({
        where: {
          deletedAt: null,
          ...visibility,
          ...(query.ownerType ? { ownerType: query.ownerType } : {}), ...(query.ownerId ? { ownerId: query.ownerId } : {}),
          ...(query.category ? { category: query.category } : {}),
          classification: query.classification ? query.classification : { in: allowed },
          ...(query.q ? { title: { contains: query.q, mode: 'insensitive' } } : {}),
        },
        take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: page.items.map(documentDto) } };
    } }),

  defineRoute({ method: 'post', path: '/documents', operationId: 'createDocument', summary: 'Create a document and its first version; returns a signed upload URL unless bytes are inlined', tags: ['document'], auth: 'session', permission: 'document:write',
    request: { body: createDocument }, responses: { 201: createDocumentResponse },
    handler: async ({ body, ctx }) => {
      const owner = await resolveOwner(ctx.tenantOrgId!, body.ownerType, body.ownerId);
      if (!owner) throw errors.validation([{ path: 'body.ownerId', message: 'Unknown owner' }]);
      await requireOwnerAccess(ctx, 'document:write', owner, { collection: true });
      const inline = decodeInline(body.contentBase64);
      const db = tenantDb(ctx);
      const doc = await db.document.create({ data: { tenantOrgId: ctx.tenantOrgId!, ownerType: body.ownerType, ownerId: body.ownerId, title: body.title, classification: body.classification, category: body.category, createdBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'document.create', resourceType: 'document', resourceId: doc.id, after: { ownerType: doc.ownerType, ownerId: doc.ownerId, title: doc.title, classification: doc.classification, category: doc.category } });
      const { row, uploadUrl } = await createVersionRecord(ctx, doc, { fileName: body.fileName, mimeType: body.mimeType, inline });
      const fresh = await db.document.findFirstOrThrow({ where: { id: doc.id } });
      return { status: 201, body: { ...documentDto(fresh), version: versionDto(row), ...(uploadUrl ? { uploadUrl: uploadUrl.url, uploadExpiresAt: uploadUrl.expiresAt } : {}) } };
    } }),

  defineRoute({ method: 'get', path: '/documents/:id', operationId: 'getDocument', summary: 'Get a document with its versions (confidential/restricted require sensitive clearance)', tags: ['document'], auth: 'session', permission: 'document:read',
    request: { params: idParams }, responses: { 200: documentDetail },
    handler: async ({ params, ctx }) => {
      const { doc } = await loadDocument(ctx, params.id, 'document:read');
      await requireDocumentClearance(ctx, doc);
      const versions = await tenantDb(ctx).documentVersion.findMany({ where: { documentId: doc.id }, orderBy: { version: 'desc' } });
      return { body: { ...documentDto(doc), versions: versions.map(versionDto) } };
    } }),

  defineRoute({ method: 'post', path: '/documents/:id/versions', operationId: 'createDocumentVersion', summary: 'Add a new version (signed upload URL, or inline bytes for small files)', tags: ['document'], auth: 'session', permission: 'document:write',
    request: { params: idParams, body: createDocumentVersion }, responses: { 201: createDocumentVersionResponse },
    handler: async ({ params, body, ctx }) => {
      const { doc } = await loadDocument(ctx, params.id, 'document:write');
      if (await isUnderLegalHold(ctx.tenantOrgId!, doc)) throw errors.legalHold('Document is under legal hold; new versions are blocked');
      const inline = decodeInline(body.contentBase64);
      const { row, uploadUrl } = await createVersionRecord(ctx, doc, { fileName: body.fileName, mimeType: body.mimeType, inline });
      return { status: 201, body: { version: versionDto(row), ...(uploadUrl ? { uploadUrl: uploadUrl.url, uploadExpiresAt: uploadUrl.expiresAt } : {}) } };
    } }),

  defineRoute({ method: 'post', path: '/documents/:id/versions/:versionId/finalize', operationId: 'finalizeDocumentVersion', summary: 'Confirm an upload: hash, scan, promote to current version', tags: ['document'], auth: 'session', permission: 'document:write',
    request: { params: documentVersionParams, body: finalizeDocumentVersion.optional() }, responses: { 200: documentDetail },
    handler: async ({ params, body, ctx }) => {
      const { doc } = await loadDocument(ctx, params.id, 'document:write');
      const db = tenantDb(ctx);
      const version = await db.documentVersion.findFirst({ where: { id: params.versionId, documentId: doc.id } });
      if (!version) throw errors.notFound();
      await finalizeVersion(ctx, doc, version, body?.sha256);
      const fresh = await db.document.findFirstOrThrow({ where: { id: doc.id } });
      const versions = await db.documentVersion.findMany({ where: { documentId: doc.id }, orderBy: { version: 'desc' } });
      return { status: 200, body: { ...documentDto(fresh), versions: versions.map(versionDto) } };
    } }),

  defineRoute({ method: 'get', path: '/documents/:id/versions/:versionId/download', operationId: 'getDocumentDownloadUrl', summary: 'Issue a short-lived signed download URL', tags: ['document'], auth: 'session', permission: 'document:read',
    request: { params: documentVersionParams }, responses: { 200: downloadUrl },
    handler: async ({ params, ctx }) => {
      const { doc } = await loadDocument(ctx, params.id, 'document:read');
      await requireDocumentClearance(ctx, doc);
      const version = await tenantDb(ctx).documentVersion.findFirst({ where: { id: params.versionId, documentId: doc.id } });
      if (!version) throw errors.notFound();
      return { body: await downloadUrlFor(ctx, doc, version) };
    } }),

  defineRoute({ method: 'delete', path: '/documents/:id', operationId: 'deleteDocument', summary: 'Soft-delete a document (blocked under legal hold)', tags: ['document'], auth: 'mfa', permission: 'document:write',
    request: { params: idParams }, responses: { 204: null },
    handler: async ({ params, ctx }) => {
      const { doc } = await loadDocument(ctx, params.id, 'document:write');
      // Deleting another user's upload needs a staff role in scope; uploaders may remove their own.
      if (doc.createdBy !== ctx.actor!.userId) await requireAccess(ctx, 'document:write', { type: 'document', id: doc.id });
      if (await isUnderLegalHold(ctx.tenantOrgId!, doc)) {
        await audit(ctx, { action: 'document.delete', resourceType: 'document', resourceId: doc.id, outcome: 'deny', metadata: { reason: 'legal_hold' } });
        throw errors.legalHold();
      }
      await tenantDb(ctx).document.update({ where: { id: doc.id }, data: { deletedAt: new Date() } });
      await audit(ctx, { action: 'document.delete', resourceType: 'document', resourceId: doc.id, before: { title: doc.title, classification: doc.classification as Classification, ownerType: doc.ownerType, ownerId: doc.ownerId } });
      return { status: 204 };
    } }),
];

export const documentRouter: Router = Router();
mount(documentRouter, documentRoutes);
