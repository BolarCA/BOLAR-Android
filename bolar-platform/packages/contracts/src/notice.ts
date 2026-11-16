// notice contracts (Days 43-45): template-rendered notices with fair-housing/SOI guard and human approval gate.
import { z } from './openapi-zod.js';
import { idSchema, pageOf, paginationQuery } from './common.js';
import { ruleHit, screenTextHit } from './compliance.js';

export const NOTICE_KINDS = ['late_rent', 'lease_violation', 'entry', 'adverse_action', 'termination', 'general'] as const;
export const NOTICE_STATUSES = ['draft', 'pending_approval', 'approved', 'sent', 'rejected', 'canceled'] as const;

export const notice = z
  .object({
    id: idSchema, kind: z.enum(NOTICE_KINDS), templateKey: z.string(), recipientId: idSchema, leaseId: idSchema.nullable(), status: z.enum(NOTICE_STATUSES), bodyDraft: z.string(),
    variables: z.record(z.string(), z.unknown()), ruleEvaluationIds: z.array(idSchema), approvedBy: idSchema.nullable(), approvedAt: z.string().nullable(), sentAt: z.string().nullable(),
    createdBy: idSchema, createdAt: z.string(), updatedAt: z.string(),
    recipientName: z.string().optional(),
  })
  .openapi('Notice');
export const noticeWithGuard = notice.extend({ guard: z.object({ flagged: z.boolean(), hits: z.array(screenTextHit) }), ruleHits: z.array(ruleHit), result: z.enum(['allow', 'warn', 'block', 'review']) }).openapi('NoticeWithGuard');
export const noticePage = pageOf(notice, 'Notice');
export const noticeQuery = paginationQuery.extend({ status: z.enum(NOTICE_STATUSES).optional(), kind: z.enum(NOTICE_KINDS).optional(), recipientId: idSchema.optional(), leaseId: idSchema.optional() });
export const createNotice = z
  .object({
    kind: z.enum(NOTICE_KINDS), templateKey: z.string().min(1).max(120), recipientId: idSchema, leaseId: idSchema.optional(),
    variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
    /** Used only when no approved template exists for templateKey (ad-hoc notice); still guarded and approved. */
    body: z.string().max(20000).optional(),
    /** Extra facts for domain=notice rules, e.g. { entryLeadHours: 12, emergency: false }. */
    facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
    propertyId: idSchema.optional(),
  })
  .openapi('CreateNotice');
export const rejectNotice = z.object({ note: z.string().min(3).max(2000) }).openapi('RejectNotice');

export type NoticeDto = z.infer<typeof notice>;
export type NoticeWithGuardDto = z.infer<typeof noticeWithGuard>;
