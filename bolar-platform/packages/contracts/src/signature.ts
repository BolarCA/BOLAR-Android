// signature contracts (blueprint Day 57): e-sign envelopes linked to lease versions.
import { z } from './openapi-zod.js';
import { idSchema } from './common.js';

export const ENVELOPE_STATUSES = ['created', 'sent', 'delivered', 'completed', 'declined', 'voided'] as const;

export const envelopeRecipient = z.object({ name: z.string(), email: z.string(), role: z.string(), tenantProfileId: idSchema.optional() }).openapi('EnvelopeRecipient');

export const signatureEnvelope = z
  .object({
    id: idSchema,
    provider: z.string(),
    externalId: z.string().nullable(),
    leaseId: idSchema,
    leaseVersionId: idSchema.nullable(),
    documentVersionId: idSchema.nullable(),
    status: z.enum(ENVELOPE_STATUSES),
    recipients: z.array(envelopeRecipient),
    lastEventId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('SignatureEnvelope');
export const signatureEnvelopeList = z.object({ items: z.array(signatureEnvelope) }).openapi('SignatureEnvelopeList');

export const createEnvelope = z
  .object({
    /** Optional explicit document version to sign; defaults to the current lease version's document. */
    documentVersionId: idSchema.optional(),
  })
  .openapi('CreateEnvelope');

export const voidEnvelope = z.object({ reason: z.string().trim().min(3).max(500) }).openapi('VoidEnvelope');

export type SignatureEnvelopeDto = z.infer<typeof signatureEnvelope>;
export type EnvelopeRecipientDto = z.infer<typeof envelopeRecipient>;
