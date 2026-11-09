import { Router, raw } from 'express';
import { z, okSchema } from '@bolar/contracts';
import { errors } from '@bolar/shared';
import { defineRoute, mount, type RouteDef } from '../../shared/route.js';
import { localStorage } from './adapter.js';
import { logger } from '../../logger.js';

export { storage, localStorage, signedUrlTtlSeconds, orgPrefix, assertOrgKey, safeFileName, resetStorageForTests } from './adapter.js';
export { virusScanner, setVirusScanner, NoopVirusScanner, type VirusScanner, type ScanResult } from './scanner.js';

const MAX_PUT_BYTES = 25 * 1024 * 1024;

const signedQuery = z.object({
  key: z.string().min(1).max(512),
  method: z.enum(['GET', 'PUT']),
  exp: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[a-f0-9]{64}$/),
});

/**
 * Validate the HMAC signature produced by LocalStorageAdapter.signedUrl. Expired or tampered
 * links answer 404 (never 403) so the URL leaks nothing about the object (blueprint p21 signed URL expiry).
 */
function verifyOrNotFound(q: z.infer<typeof signedQuery>, expectedMethod: 'GET' | 'PUT') {
  const local = localStorage();
  if (!local) throw errors.notFound();
  if (q.method !== expectedMethod || !q.key.startsWith('org/') || !local.verify(q.key, q.method, q.exp, q.sig)) {
    logger.info({ reason: q.exp < Math.floor(Date.now() / 1000) ? 'expired' : 'invalid_signature', method: expectedMethod }, 'storage link rejected');
    throw errors.notFound();
  }
  return local;
}

function bodyToBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  if (body && typeof body === 'object' && Object.keys(body as object).length > 0) return Buffer.from(JSON.stringify(body), 'utf8');
  return Buffer.alloc(0);
}

/**
 * Local-driver object endpoints (Day 26). Public routes: the signed URL *is* the credential.
 * Keys are always `org/<tenantOrgId>/...`; the signer only hands out keys inside the caller's org.
 */
export const storageRoutes: RouteDef[] = [
  defineRoute({ method: 'get', path: '/storage/object', operationId: 'getStorageObject', summary: 'Download an object with a signed URL (local driver)', tags: ['storage'], auth: 'public',
    request: { query: signedQuery }, responses: { 200: z.string().openapi('StorageObjectBytes', { description: 'Raw object bytes; Content-Type is the stored MIME type.' }) },
    handler: async ({ query, res }) => {
      const local = verifyOrNotFound(query, 'GET');
      const obj = await local.getObject(query.key);
      if (!obj) throw errors.notFound();
      const fileName = query.key.split('/').pop() ?? 'file';
      res.status(200)
        .set({
          'Content-Type': obj.contentType || 'application/octet-stream',
          'Content-Length': String(obj.body.length),
          'Content-Disposition': `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        .end(obj.body);
      return { status: 200 };
    } }),
  defineRoute({ method: 'put', path: '/storage/object', operationId: 'putStorageObject', summary: 'Upload object bytes with a signed URL (local driver, max 25 MB)', tags: ['storage'], auth: 'public',
    request: { query: signedQuery }, responses: { 200: okSchema.extend({ key: z.string(), sizeBytes: z.number().int(), sha256: z.string() }).openapi('StoragePutResult') },
    handler: async ({ query, req }) => {
      const local = verifyOrNotFound(query, 'PUT');
      const body = bodyToBuffer(req.body);
      if (body.length === 0) throw errors.validation([{ path: 'body', message: 'Empty upload body' }]);
      if (body.length > MAX_PUT_BYTES) throw errors.validation([{ path: 'body', message: 'Object exceeds 25 MB' }]);
      const contentType = (req.header('content-type') ?? 'application/octet-stream').split(';')[0]!.trim() || 'application/octet-stream';
      const put = await local.putObject({ key: query.key, body, contentType });
      return { status: 200, body: { ok: true as const, key: put.key, sizeBytes: put.sizeBytes, sha256: put.sha256 } };
    } }),
];

export const storageRouter: Router = Router();
// Raw bytes for uploads: express.json() in app.ts only consumes application/json, every other type lands here untouched.
storageRouter.use('/storage/object', raw({ type: () => true, limit: `${MAX_PUT_BYTES + 1024}` }));
mount(storageRouter, storageRoutes);
