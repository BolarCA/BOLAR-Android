import { Router } from 'express';
import { createHash } from 'node:crypto';
import { idParams, mediaAsset, mediaPage, mediaQuery, createMedia, createMediaResponse, downloadUrl, MEDIA_MAX_BYTES, MEDIA_INLINE_MAX_BYTES, MEDIA_MIME_TYPES } from '@bolar/contracts';
import { errors, toPage, decodeCursor, type RequestContext } from '@bolar/shared';
import type { MediaAsset } from '@bolar/db';
import { defineRoute, mount, toDto, type RouteDef } from '../../shared/route.js';
import { tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { storage, signedUrlTtlSeconds, orgPrefix, assertOrgKey, safeFileName } from '../storage/adapter.js';
import { virusScanner } from '../storage/scanner.js';
import { resolveOwner, requireOwnerAccess, isStaff } from '../document/owner-access.js';
import { decodeInline } from '../document/service.js';

/**
 * Media (Day 27): photos/videos/PDFs attached to work orders, units, properties, inspections and vendors.
 * Access = `media:*` permission AND a relationship to the owner (assigned vendor, requester, manager,
 * owner, tenant); vendors without `assigned_to` see 404. Thumbnails are a placeholder (null) until the
 * media worker lands; status moves uploading -> uploaded.
 */
async function loadMedia(ctx: RequestContext, id: string, permission: 'media:read' | 'media:write') {
  const asset = await tenantDb(ctx).mediaAsset.findFirst({ where: { id } });
  if (!asset) throw errors.notFound();
  const owner = (await resolveOwner(ctx.tenantOrgId!, asset.ownerType, asset.ownerId)) ?? { type: asset.ownerType, id: asset.ownerId, propertyId: null, relatedUserIds: [] };
  await requireOwnerAccess(ctx, permission, owner);
  return asset;
}

async function withDownload(asset: MediaAsset) {
  if (asset.status !== 'uploaded' && asset.status !== 'processed') return toDto(asset);
  const signed = await storage().signedUrl(asset.storageKey, 'GET', signedUrlTtlSeconds());
  return { ...toDto(asset), downloadUrl: signed.url, downloadExpiresAt: signed.expiresAt };
}

export const mediaRoutes: RouteDef[] = [
  defineRoute({ method: 'get', path: '/media', operationId: 'listMedia', summary: 'List media for an owner (requires a relationship to the owner)', tags: ['media'], auth: 'session', permission: 'media:read',
    request: { query: mediaQuery }, responses: { 200: mediaPage },
    handler: async ({ query, ctx }) => {
      const owner = await resolveOwner(ctx.tenantOrgId!, query.ownerType, query.ownerId);
      if (!owner) throw errors.notFound();
      await requireOwnerAccess(ctx, 'media:read', owner);
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).mediaAsset.findMany({ where: { ownerType: query.ownerType, ownerId: query.ownerId, status: { not: 'failed' } }, take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: await Promise.all(page.items.map(withDownload)) } };
    } }),

  defineRoute({ method: 'post', path: '/media', operationId: 'createMedia', summary: 'Upload media (inline base64 <= 1 MB, or signed PUT URL up to 10 MB)', tags: ['media'], auth: 'session', permission: 'media:write',
    request: { body: createMedia }, responses: { 201: createMediaResponse },
    handler: async ({ body, ctx }) => {
      const owner = await resolveOwner(ctx.tenantOrgId!, body.ownerType, body.ownerId);
      if (!owner) throw errors.validation([{ path: 'body.ownerId', message: 'Unknown owner' }]);
      await requireOwnerAccess(ctx, 'media:write', owner);
      const inline = decodeInline(body.contentBase64, MEDIA_INLINE_MAX_BYTES);
      if (!inline && !body.sizeBytes) throw errors.validation([{ path: 'body.sizeBytes', message: 'sizeBytes is required when contentBase64 is omitted' }]);
      const sizeBytes = inline?.length ?? body.sizeBytes!;
      if (sizeBytes > MEDIA_MAX_BYTES) throw errors.validation([{ path: 'body.sizeBytes', message: 'Media is limited to 10 MB' }]);
      const db = tenantDb(ctx);
      const id = createHash('sha1').update(`${ctx.requestId}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 24);
      const key = `${orgPrefix(ctx.tenantOrgId!)}media/${body.ownerType}/${body.ownerId}/${id}-${safeFileName(body.fileName)}`;
      let asset = await db.mediaAsset.create({ data: { tenantOrgId: ctx.tenantOrgId!, id, ownerType: body.ownerType, ownerId: body.ownerId, storageKey: key, thumbnailKey: null, fileName: body.fileName, mimeType: body.mimeType, sizeBytes, status: inline ? 'uploaded' : 'uploading', uploadedBy: ctx.actor!.userId } });
      let uploadUrl: { url: string; expiresAt: string } | undefined;
      if (inline) {
        await storage().putObject({ key, body: inline, contentType: body.mimeType, metadata: { tenantOrgId: ctx.tenantOrgId!, mediaId: asset.id } });
        const scan = await virusScanner().scan({ key, body: inline, mimeType: body.mimeType, sizeBytes: inline.length });
        if (scan.verdict === 'infected') { asset = await db.mediaAsset.update({ where: { id: asset.id }, data: { status: 'failed' } }); throw errors.conflict('File failed the malware scan'); }
        await publish(ctx, 'media.uploaded', { mediaId: asset.id, ownerType: asset.ownerType, ownerId: asset.ownerId, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes });
      } else {
        uploadUrl = await storage().signedUrl(key, 'PUT', signedUrlTtlSeconds());
      }
      await audit(ctx, { action: 'media.upload', resourceType: asset.ownerType, resourceId: asset.ownerId, after: { mediaId: asset.id, fileName: asset.fileName, mimeType: asset.mimeType, sizeBytes, status: asset.status } });
      return { status: 201, body: { ...(await withDownload(asset)), ...(uploadUrl ? { uploadUrl: uploadUrl.url, uploadExpiresAt: uploadUrl.expiresAt } : {}) } };
    } }),

  defineRoute({ method: 'post', path: '/media/:id/finalize', operationId: 'finalizeMedia', summary: 'Confirm a signed-URL upload: verify bytes, scan, mark uploaded', tags: ['media'], auth: 'session', permission: 'media:write',
    request: { params: idParams }, responses: { 200: mediaAsset },
    handler: async ({ params, ctx }) => {
      const asset = await loadMedia(ctx, params.id, 'media:write');
      if (asset.status !== 'uploading') return { status: 200, body: await withDownload(asset) };
      assertOrgKey(ctx.tenantOrgId!, asset.storageKey);
      const head = await storage().headObject(asset.storageKey);
      if (!head) throw errors.conflict('Upload has not been received yet');
      if (head.sizeBytes > MEDIA_MAX_BYTES) throw errors.validation([{ path: 'body', message: 'Media is limited to 10 MB' }]);
      if (!(MEDIA_MIME_TYPES as readonly string[]).includes(head.contentType) && head.contentType !== asset.mimeType) throw errors.validation([{ path: 'body', message: 'Uploaded content type is not allowed' }]);
      const scan = await virusScanner().scan({ key: asset.storageKey, mimeType: asset.mimeType, sizeBytes: head.sizeBytes });
      const updated = await tenantDb(ctx).mediaAsset.update({ where: { id: asset.id }, data: { sizeBytes: head.sizeBytes, status: scan.verdict === 'infected' ? 'failed' : 'uploaded' } });
      await audit(ctx, { action: 'media.finalize', resourceType: asset.ownerType, resourceId: asset.ownerId, outcome: scan.verdict === 'infected' ? 'error' : 'allow', metadata: { mediaId: asset.id, sizeBytes: head.sizeBytes, scan: scan.engine, verdict: scan.verdict } });
      if (scan.verdict === 'infected') throw errors.conflict('File failed the malware scan');
      await publish(ctx, 'media.uploaded', { mediaId: updated.id, ownerType: updated.ownerType, ownerId: updated.ownerId, mimeType: updated.mimeType, sizeBytes: updated.sizeBytes });
      return { status: 200, body: await withDownload(updated) };
    } }),

  defineRoute({ method: 'get', path: '/media/:id', operationId: 'getMedia', summary: 'Get media metadata with a signed download URL', tags: ['media'], auth: 'session', permission: 'media:read',
    request: { params: idParams }, responses: { 200: mediaAsset },
    handler: async ({ params, ctx }) => ({ body: await withDownload(await loadMedia(ctx, params.id, 'media:read')) }) }),

  defineRoute({ method: 'get', path: '/media/:id/download', operationId: 'getMediaDownloadUrl', summary: 'Issue a short-lived signed download URL for a media asset', tags: ['media'], auth: 'session', permission: 'media:read',
    request: { params: idParams }, responses: { 200: downloadUrl },
    handler: async ({ params, ctx }) => {
      const asset = await loadMedia(ctx, params.id, 'media:read');
      if (asset.status !== 'uploaded' && asset.status !== 'processed') throw errors.conflict(`Media is ${asset.status}`);
      assertOrgKey(ctx.tenantOrgId!, asset.storageKey);
      const signed = await storage().signedUrl(asset.storageKey, 'GET', signedUrlTtlSeconds());
      await audit(ctx, { action: 'media.download', resourceType: asset.ownerType, resourceId: asset.ownerId, metadata: { mediaId: asset.id, expiresAt: signed.expiresAt } });
      return { body: { url: signed.url, expiresAt: signed.expiresAt } };
    } }),

  defineRoute({ method: 'delete', path: '/media/:id', operationId: 'deleteMedia', summary: 'Delete a media asset (uploader or staff in scope)', tags: ['media'], auth: 'session', permission: 'media:write',
    request: { params: idParams }, responses: { 204: null },
    handler: async ({ params, ctx }) => {
      const asset = await loadMedia(ctx, params.id, 'media:write');
      if (asset.uploadedBy !== ctx.actor!.userId && !isStaff(ctx)) {
        await audit(ctx, { action: 'access.denied', resourceType: asset.ownerType, resourceId: asset.ownerId, outcome: 'deny', metadata: { permission: 'media:write', reason: 'not uploader', mediaId: asset.id } });
        throw errors.notFound();
      }
      assertOrgKey(ctx.tenantOrgId!, asset.storageKey);
      await storage().deleteObject(asset.storageKey);
      await tenantDb(ctx).mediaAsset.delete({ where: { id: asset.id } });
      await audit(ctx, { action: 'media.delete', resourceType: asset.ownerType, resourceId: asset.ownerId, before: { mediaId: asset.id, fileName: asset.fileName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes } });
      return { status: 204 };
    } }),
];

export const mediaRouter: Router = Router();
mount(mediaRouter, mediaRoutes);
