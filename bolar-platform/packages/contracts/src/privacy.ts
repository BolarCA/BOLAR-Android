// privacy contracts (Day 48): DSAR intake, identity verification, discovery, exception review, decision, fulfilment.
import { z } from './openapi-zod.js';
import { emailSchema, idSchema, pageOf, paginationQuery } from './common.js';

export const PRIVACY_REQUEST_KINDS = ['access', 'deletion', 'correction', 'portability'] as const;
export const PRIVACY_REQUEST_STATUSES = ['received', 'identity_verification', 'discovery', 'exception_review', 'approved', 'denied', 'fulfilled', 'closed'] as const;
export const PRIVACY_DECISIONS = ['approved', 'denied', 'partial'] as const;

export const privacyIntake = z
  .object({ orgSlug: z.string().min(1).max(64), kind: z.enum(PRIVACY_REQUEST_KINDS), email: emailSchema })
  .openapi('PrivacyIntake');
export const privacyIntakeResponse = z
  .object({ id: idSchema, status: z.enum(PRIVACY_REQUEST_STATUSES), kind: z.enum(PRIVACY_REQUEST_KINDS), dueAt: z.string(), verificationUrl: z.string().nullable() })
  .openapi('PrivacyIntakeResponse');
export const privacyVerify = z.object({ externalId: z.string().min(4).max(128) }).openapi('PrivacyVerify');
export const privacyVerifyResponse = z
  .object({ id: idSchema, status: z.enum(PRIVACY_REQUEST_STATUSES), identityVerified: z.boolean(), identityStatus: z.enum(['pending', 'verified', 'failed']) })
  .openapi('PrivacyVerifyResponse');

export const privacyRequest = z
  .object({
    id: idSchema,
    kind: z.enum(PRIVACY_REQUEST_KINDS),
    subjectEmail: z.string(),
    subjectProfileId: idSchema.nullable(),
    status: z.enum(PRIVACY_REQUEST_STATUSES),
    identityVerifiedAt: z.string().nullable(),
    identityMethod: z.string().nullable(),
    discoveryJson: z.record(z.unknown()),
    exceptionsJson: z.array(z.record(z.unknown())),
    decision: z.string().nullable(),
    decidedBy: idSchema.nullable(),
    decidedAt: z.string().nullable(),
    dueAt: z.string(),
    confirmationDraft: z.string().nullable(),
    manifestJson: z.record(z.unknown()).nullable(),
    createdBy: idSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('PrivacyRequest');
export const privacyRequestPage = pageOf(privacyRequest, 'PrivacyRequest');
export const privacyRequestQuery = paginationQuery.extend({ status: z.enum(PRIVACY_REQUEST_STATUSES).optional(), kind: z.enum(PRIVACY_REQUEST_KINDS).optional() });

export const privacyDecide = z
  .object({ decision: z.enum(PRIVACY_DECISIONS), note: z.string().min(5).max(2000) })
  .openapi('PrivacyDecide');
export const privacyNote = z.object({ note: z.string().max(2000).optional() }).openapi('PrivacyNote');

export type PrivacyRequestDto = z.infer<typeof privacyRequest>;
