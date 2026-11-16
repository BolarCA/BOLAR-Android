// media contracts (Day 27): media assets with thumbnail/status, relationship-gated access.
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery, classificationSchema } from './common.js';

export const MEDIA_OWNER_TYPES = ['work_order', 'unit', 'property', 'inspection', 'vendor'] as const;
export const MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'application/pdf'] as const;
export const MEDIA_STATUSES = ['uploading', 'uploaded', 'processed', 'failed'] as const;
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;
/** Inline base64 bodies are limited by the JSON body parser; larger files use the signed PUT URL returned on create. */
export const MEDIA_INLINE_MAX_BYTES = 1_000_000;

export const mediaAsset = z
  .object({
    id: idSchema, ownerType: z.enum(MEDIA_OWNER_TYPES), ownerId: idSchema, fileName: z.string(), mimeType: z.string(), sizeBytes: z.number().int(), classification: classificationSchema,
    status: z.enum(MEDIA_STATUSES), thumbnailKey: z.string().nullable(), uploadedBy: idSchema, createdAt: z.string(),
    downloadUrl: z.string().optional(), downloadExpiresAt: z.string().optional(),
  })
  .openapi('MediaAsset');
export const mediaPage = pageOf(mediaAsset, 'MediaAsset');

export const createMedia = z
  .object({
    ownerType: z.enum(MEDIA_OWNER_TYPES), ownerId: idSchema,
    fileName: z.string().trim().min(1).max(200).regex(/^[^/\\\0]+$/, 'File name must not contain path separators'),
    mimeType: z.enum(MEDIA_MIME_TYPES),
    /** Inline bytes (<= 1 MB). Omit to receive a signed PUT `uploadUrl`; then call finalize. */
    contentBase64: z.string().max(Math.ceil((MEDIA_INLINE_MAX_BYTES * 4) / 3) + 4).optional(),
    /** Required when contentBase64 is omitted; enforced again at finalize. */
    sizeBytes: z.number().int().min(1).max(MEDIA_MAX_BYTES).optional(),
  })
  .openapi('CreateMedia');

export const createMediaResponse = mediaAsset.extend({ uploadUrl: z.string().optional(), uploadExpiresAt: z.string().optional() }).openapi('CreateMediaResponse');

export const mediaQuery = paginationQuery.extend({ ownerType: z.enum(MEDIA_OWNER_TYPES), ownerId: idSchema });

export type MediaAssetDto = z.infer<typeof mediaAsset>;
export type CreateMediaDto = z.infer<typeof createMedia>;
export type CreateMediaResponseDto = z.infer<typeof createMediaResponse>;
