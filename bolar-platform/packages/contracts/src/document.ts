// document contracts (Day 26): document + version metadata, upload/download signed URLs.
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery, classificationSchema } from './common.js';

export const DOCUMENT_OWNER_TYPES = ['lease', 'tenant_profile', 'property', 'unit', 'work_order', 'vendor', 'case', 'application', 'org'] as const;
export const DOCUMENT_CATEGORIES = ['lease', 'id', 'screening_report', 'insurance', 'notice', 'invoice', 'general'] as const;
export const SCAN_STATUSES = ['pending', 'clean', 'infected', 'skipped'] as const;

/** Max inline (base64) payload accepted by the JSON API; larger files go through the signed PUT URL. */
export const DOCUMENT_INLINE_MAX_BYTES = 1_000_000;
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

const fileNameSchema = z.string().trim().min(1).max(200).regex(/^[^/\\\0]+$/, 'File name must not contain path separators');
const mimeTypeSchema = z.string().trim().min(3).max(120).regex(/^[\w.+-]+\/[\w.+-]+$/, 'Invalid MIME type');

export const documentVersion = z
  .object({
    id: idSchema, documentId: idSchema, version: z.number().int(), fileName: z.string(), mimeType: z.string(), sizeBytes: z.number().int(), sha256: z.string(),
    scanStatus: z.enum(SCAN_STATUSES), createdBy: idSchema, createdAt: z.string(),
  })
  .openapi('DocumentVersion');

export const document = z
  .object({
    id: idSchema, ownerType: z.enum(DOCUMENT_OWNER_TYPES), ownerId: idSchema, title: z.string(), classification: classificationSchema, category: z.enum(DOCUMENT_CATEGORIES),
    currentVersionId: idSchema.nullable(), retentionPolicyId: idSchema.nullable(), legalHold: z.boolean(), createdBy: idSchema, createdAt: z.string(), updatedAt: z.string(),
    /** True when the caller must pass the sensitive-access gate before reading or downloading (confidential/restricted). */
    gated: z.boolean(),
  })
  .openapi('Document');
export const documentPage = pageOf(document, 'Document');

export const documentDetail = document.extend({ versions: z.array(documentVersion) }).openapi('DocumentDetail');

export const documentQuery = paginationQuery.extend({
  ownerType: z.enum(DOCUMENT_OWNER_TYPES).optional(),
  ownerId: idSchema.optional(),
  classification: classificationSchema.optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  q: z.string().trim().max(100).optional(),
});

export const createDocument = z
  .object({
    ownerType: z.enum(DOCUMENT_OWNER_TYPES), ownerId: idSchema, title: z.string().trim().min(1).max(200), classification: classificationSchema.default('internal'), category: z.enum(DOCUMENT_CATEGORIES).default('general'),
    fileName: fileNameSchema, mimeType: mimeTypeSchema,
    /** Optional inline bytes (<= 1 MB). When omitted, upload the bytes to `uploadUrl` with PUT, then finalize. */
    contentBase64: z.string().max(Math.ceil((DOCUMENT_INLINE_MAX_BYTES * 4) / 3) + 4).optional(),
  })
  .openapi('CreateDocument');

export const signedUrl = z.object({ url: z.string(), expiresAt: z.string(), method: z.enum(['GET', 'PUT']) }).openapi('SignedUrl');
export const downloadUrl = z.object({ url: z.string(), expiresAt: z.string() }).openapi('DownloadUrl');

export const createDocumentResponse = document
  .extend({ version: documentVersion, uploadUrl: z.string().optional(), uploadExpiresAt: z.string().optional() })
  .openapi('CreateDocumentResponse');

export const createDocumentVersion = z
  .object({ fileName: fileNameSchema, mimeType: mimeTypeSchema, contentBase64: z.string().max(Math.ceil((DOCUMENT_INLINE_MAX_BYTES * 4) / 3) + 4).optional() })
  .openapi('CreateDocumentVersion');
export const createDocumentVersionResponse = z
  .object({ version: documentVersion, uploadUrl: z.string().optional(), uploadExpiresAt: z.string().optional() })
  .openapi('CreateDocumentVersionResponse');

export const finalizeDocumentVersion = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional() }).openapi('FinalizeDocumentVersion');

export const documentVersionParams = z.object({ id: idSchema, versionId: idSchema });

export type DocumentDto = z.infer<typeof document>;
export type DocumentDetailDto = z.infer<typeof documentDetail>;
export type DocumentVersionDto = z.infer<typeof documentVersion>;
export type CreateDocumentDto = z.infer<typeof createDocument>;
export type CreateDocumentResponseDto = z.infer<typeof createDocumentResponse>;
export type DownloadUrlDto = z.infer<typeof downloadUrl>;
