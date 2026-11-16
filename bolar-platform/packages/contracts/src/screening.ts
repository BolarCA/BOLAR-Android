// screening contracts (Days 43, 58): applications, consent-gated screening orders, restricted results, adverse action workflow.
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery } from './common.js';
import { ruleHit } from './compliance.js';

export const APPLICATION_STATUSES = ['draft', 'submitted', 'screening', 'review', 'approved', 'conditionally_approved', 'denied', 'withdrawn'] as const;
export const SCREENING_ORDER_STATUSES = ['pending_consent', 'ordered', 'completed', 'failed', 'canceled'] as const;
export const SCREENING_PRODUCTS = ['credit', 'criminal', 'eviction'] as const;
export const ADVERSE_ACTION_STAGES = ['pre_adverse', 'waiting', 'final', 'disputed', 'withdrawn'] as const;
export const APPLICATION_DECISIONS = ['approved', 'conditionally_approved', 'denied'] as const;
/** Reason codes are the only vocabulary allowed on adverse action notices (no free text from AI). */
export const ADVERSE_REASON_CODES = ['insufficient_income', 'credit_history', 'eviction_record', 'criminal_record', 'incomplete_application', 'unverifiable_information', 'rental_history', 'other'] as const;

export const screeningOrder = z
  .object({
    id: idSchema, applicationId: idSchema, provider: z.string(), status: z.enum(SCREENING_ORDER_STATUSES), consentAt: z.string().nullable(), consentDocId: z.string().nullable(),
    externalId: z.string().nullable(), orderedBy: idSchema.nullable(), createdAt: z.string(), updatedAt: z.string(),
    /** Present once a result exists. The summary and report stay behind the sensitive-access gate. */
    resultId: idSchema.nullable(),
  })
  .openapi('ScreeningOrder');

export const adverseAction = z
  .object({
    id: idSchema, applicationId: idSchema, stage: z.enum(ADVERSE_ACTION_STAGES), noticeId: idSchema.nullable(), reasonCodes: z.array(z.string()),
    waitingPeriodEndsAt: z.string().nullable(), disputeOpenedAt: z.string().nullable(), approvedBy: idSchema.nullable(), createdAt: z.string(), updatedAt: z.string(),
    finalNoticeId: idSchema.nullable().optional(),
  })
  .openapi('AdverseAction');
export const adverseActionPage = pageOf(adverseAction, 'AdverseAction');
export const adverseActionQuery = paginationQuery.extend({ stage: z.enum(ADVERSE_ACTION_STAGES).optional(), applicationId: idSchema.optional() });

export const application = z
  .object({
    id: idSchema, propertyId: idSchema, unitId: idSchema.nullable(), applicantId: idSchema, status: z.enum(APPLICATION_STATUSES), submittedAt: z.string().nullable(),
    decidedAt: z.string().nullable(), decidedBy: idSchema.nullable(), createdAt: z.string(), updatedAt: z.string(),
    applicantName: z.string().optional(), propertyName: z.string().optional(),
  })
  .openapi('Application');
export const applicationDetail = application.extend({ screeningOrders: z.array(screeningOrder), adverseActions: z.array(adverseAction) }).openapi('ApplicationDetail');
export const applicationPage = pageOf(application, 'Application');
export const applicationQuery = paginationQuery.extend({ status: z.enum(APPLICATION_STATUSES).optional(), propertyId: idSchema.optional(), applicantId: idSchema.optional() });
export const createApplication = z.object({ propertyId: idSchema, unitId: idSchema.optional(), applicantId: idSchema }).openapi('CreateApplication');
export const recordConsent = z.object({ consentDocumentId: z.string().max(64).optional(), provider: z.enum(['mock', 'transunion']).optional() }).openapi('RecordScreeningConsent');
export const orderScreening = z.object({ products: z.array(z.enum(SCREENING_PRODUCTS)).min(1).default(['credit', 'criminal', 'eviction']) }).openapi('OrderScreening');
export const decideApplication = z
  .object({ decision: z.enum(APPLICATION_DECISIONS), reasonCodes: z.array(z.enum(ADVERSE_REASON_CODES)).max(8).default([]), note: z.string().max(2000).optional() })
  .openapi('DecideApplication');
export const decideApplicationResponse = z.object({ application, adverseAction: adverseAction.nullable() }).openapi('DecideApplicationResponse');

export const screeningSummary = z
  .object({ recommendation: z.enum(['accept', 'conditional', 'review', 'decline']), creditBand: z.string().optional(), evictionRecords: z.number().int(), criminalRecords: z.number().int(), providerContact: z.string() })
  .openapi('ScreeningSummary');
export const screeningResultResponse = z
  .object({ id: idSchema, orderId: idSchema, classification: z.literal('restricted'), receivedAt: z.string(), summary: screeningSummary.nullable(), download: z.object({ url: z.string(), expiresAt: z.string() }).nullable() })
  .openapi('ScreeningResultResponse');

export const applicationLookups = z
  .object({ properties: z.array(z.object({ id: idSchema, name: z.string(), city: z.string(), state: z.string() })), applicants: z.array(z.object({ id: idSchema, displayName: z.string(), status: z.string() })) })
  .openapi('ApplicationLookups');

export const screeningBlocked = z.object({ result: z.literal('block'), hits: z.array(ruleHit) }).openapi('ScreeningBlocked');

export type ApplicationDto = z.infer<typeof application>;
export type ApplicationDetailDto = z.infer<typeof applicationDetail>;
export type ScreeningOrderDto = z.infer<typeof screeningOrder>;
export type AdverseActionDto = z.infer<typeof adverseAction>;
export type ScreeningResultResponseDto = z.infer<typeof screeningResultResponse>;
