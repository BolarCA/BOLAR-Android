import { z } from './openapi-zod.js';
import { CLASSIFICATIONS, ACCESS_PURPOSES } from '@bolar/shared';

export const idSchema = z.string().min(1).max(64);
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const centsSchema = z.number().int().min(0).max(1_000_000_000_00);
export const isoDateSchema = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
export const classificationSchema = z.enum(CLASSIFICATIONS);
export const purposeSchema = z.enum(ACCESS_PURPOSES);

export const errorBodySchema = z
  .object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    fieldErrors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .openapi('ErrorBody');
export type ErrorBodyDto = z.infer<typeof errorBodySchema>;

export const paginationQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export function pageOf<T extends z.ZodTypeAny>(item: T, name: string) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() }).openapi(`${name}Page`);
}

export const okSchema = z.object({ ok: z.literal(true) }).openapi('Ok');
export const idParams = z.object({ id: idSchema });
