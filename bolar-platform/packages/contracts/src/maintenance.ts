// maintenance contracts (blueprint Days 31-35): maintenance requests, work orders, state machine, SLA.
import { z } from './openapi-zod.js';
import { centsSchema, idSchema, pageOf, paginationQuery } from './common.js';

export const WORK_ORDER_CATEGORIES = ['plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'pest', 'safety', 'other'] as const;
export type WorkOrderCategory = (typeof WORK_ORDER_CATEGORIES)[number];
export const WORK_ORDER_PRIORITIES = ['emergency', 'high', 'normal', 'low'] as const;
export type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];
export const WORK_ORDER_STATUSES = ['new', 'triaged', 'assigned', 'scheduled', 'in_progress', 'blocked', 'review', 'complete', 'reopened', 'canceled'] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
export const WORK_ORDER_OPEN_STATUSES: readonly WorkOrderStatus[] = ['new', 'triaged', 'assigned', 'scheduled', 'in_progress', 'blocked', 'review', 'reopened'];
export const ENTRY_PERMISSIONS = ['ask', 'granted', 'denied'] as const;
export const REQUESTER_KINDS = ['tenant', 'staff', 'inspection', 'system'] as const;
export const WORK_ORDER_EVENT_TYPES = ['created', 'status_changed', 'assigned', 'unassigned', 'note', 'message', 'media_added', 'sla_breached', 'escalated', 'duplicate'] as const;

/** SLA targets by priority in hours (Day 32). */
export const SLA_HOURS_BY_PRIORITY: Record<WorkOrderPriority, number> = { emergency: 24, high: 72, normal: 7 * 24, low: 14 * 24 };
/** Window after completion in which a requester may reopen. */
export const REOPEN_WINDOW_DAYS = 30;
/** Window for the duplicate hint on create: same unit + category. */
export const DUPLICATE_WINDOW_DAYS = 7;

export const availabilityWindow = z
  .object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }) })
  .refine((w) => new Date(w.end).getTime() > new Date(w.start).getTime(), { message: 'Window end must be after start', path: ['end'] })
  .openapi('AvailabilityWindow');

export const createWorkOrder = z
  .object({
    title: z.string().trim().min(3).max(140),
    description: z.string().trim().min(10).max(4000),
    category: z.enum(WORK_ORDER_CATEGORIES),
    priority: z.enum(WORK_ORDER_PRIORITIES).default('normal'),
    entryPermission: z.enum(ENTRY_PERMISSIONS).default('ask'),
    availability: z.array(availabilityWindow).max(5).default([]),
    /** Staff only: explicit property/unit. Tenants are resolved from their occupancy relationship. */
    propertyId: idSchema.optional(),
    unitId: idSchema.optional(),
    /** Media already uploaded through POST /media with ownerType work_order are linked by event. */
    mediaIds: z.array(idSchema).max(20).optional(),
    estimateCents: centsSchema.optional(),
  })
  .openapi('CreateWorkOrder');

export const updateWorkOrder = z
  .object({
    title: z.string().trim().min(3).max(140).optional(),
    description: z.string().trim().min(10).max(4000).optional(),
    category: z.enum(WORK_ORDER_CATEGORIES).optional(),
    priority: z.enum(WORK_ORDER_PRIORITIES).optional(),
    entryPermission: z.enum(ENTRY_PERMISSIONS).optional(),
    availability: z.array(availabilityWindow).max(5).optional(),
    unitId: idSchema.nullable().optional(),
    estimateCents: centsSchema.nullable().optional(),
    scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .openapi('UpdateWorkOrder');

export const transitionWorkOrder = z
  .object({
    to: z.enum(WORK_ORDER_STATUSES),
    note: z.string().trim().min(1).max(2000).optional(),
    scheduledFor: z.string().datetime({ offset: true }).optional(),
    actualCents: centsSchema.optional(),
  })
  .openapi('TransitionWorkOrder');

export const assignWorkOrder = z
  .object({ vendorId: idSchema.optional(), userId: idSchema.optional() })
  .refine((b) => Boolean(b.vendorId) !== Boolean(b.userId), { message: 'Provide exactly one of vendorId or userId', path: ['vendorId'] })
  .openapi('AssignWorkOrder');

export const workOrderNote = z.object({ body: z.string().trim().min(1).max(4000), kind: z.enum(['note', 'message']).default('note') }).openapi('WorkOrderNote');
export const markDuplicate = z.object({ duplicateOfId: idSchema }).openapi('MarkWorkOrderDuplicate');

export const workOrderEvent = z
  .object({ id: idSchema, workOrderId: idSchema, eventType: z.string(), actorId: idSchema.nullable(), actorName: z.string().nullable().optional(), payload: z.record(z.unknown()), createdAt: z.string() })
  .openapi('WorkOrderEvent');
export const workOrderEventPage = pageOf(workOrderEvent, 'WorkOrderEvent');

export const vendorSummary = z.object({ id: idSchema, name: z.string(), status: z.string(), trades: z.array(z.string()), phone: z.string().nullable(), email: z.string().nullable() }).openapi('VendorSummary');

export const workOrder = z
  .object({
    id: idSchema,
    number: z.string(),
    propertyId: idSchema,
    unitId: idSchema.nullable(),
    requesterId: idSchema,
    requesterKind: z.enum(REQUESTER_KINDS),
    title: z.string(),
    description: z.string(),
    category: z.enum(WORK_ORDER_CATEGORIES),
    priority: z.enum(WORK_ORDER_PRIORITIES),
    status: z.enum(WORK_ORDER_STATUSES),
    assignedVendorId: idSchema.nullable(),
    assignedUserId: idSchema.nullable(),
    entryPermission: z.enum(ENTRY_PERMISSIONS),
    availabilityJson: z.array(availabilityWindow),
    slaDueAt: z.string().nullable(),
    overdue: z.boolean(),
    scheduledFor: z.string().nullable(),
    completedAt: z.string().nullable(),
    reopenedCount: z.number().int(),
    duplicateOfId: idSchema.nullable(),
    estimateCents: z.number().int().nullable(),
    actualCents: z.number().int().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    property: z.object({ id: idSchema, name: z.string() }).nullable(),
    unit: z.object({ id: idSchema, unitNumber: z.string() }).nullable(),
    vendor: vendorSummary.nullable(),
    requester: z.object({ id: idSchema, name: z.string() }).nullable(),
    assignee: z.object({ id: idSchema, name: z.string() }).nullable(),
  })
  .openapi('WorkOrder');
export const workOrderPage = pageOf(workOrder, 'WorkOrder');
export const createWorkOrderResponse = workOrder.extend({ possibleDuplicateId: idSchema.nullable() }).openapi('CreateWorkOrderResponse');
export const workOrderDetail = workOrder
  .extend({ events: z.array(workOrderEvent), allowedTransitions: z.array(z.enum(WORK_ORDER_STATUSES)), actorKinds: z.array(z.enum(['manager', 'vendor', 'tenant'])) })
  .openapi('WorkOrderDetail');

const statusList = z.preprocess((v) => {
  if (v === undefined) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  return arr.flatMap((s) => String(s).split(',')).map((s) => s.trim()).filter(Boolean);
}, z.array(z.enum(WORK_ORDER_STATUSES)).optional());
const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true').optional();

export const workOrderQuery = paginationQuery.extend({
  status: statusList,
  priority: z.enum(WORK_ORDER_PRIORITIES).optional(),
  category: z.enum(WORK_ORDER_CATEGORIES).optional(),
  propertyId: idSchema.optional(),
  assignedVendorId: idSchema.optional(),
  assignedUserId: idSchema.optional(),
  /** Staff: requested by me or assigned to me. */
  mine: boolParam,
  /** Open orders past slaDueAt. */
  overdue: boolParam,
  /** Include canceled orders (hidden by default). */
  includeCanceled: boolParam,
  q: z.string().max(100).optional(),
});

export const slaScanResponse = z.object({ scanned: z.number().int(), breached: z.array(idSchema) }).openapi('SlaScanResponse');

export type WorkOrderDto = z.infer<typeof workOrder>;
export type WorkOrderDetailDto = z.infer<typeof workOrderDetail>;
export type WorkOrderEventDto = z.infer<typeof workOrderEvent>;
export type CreateWorkOrderInput = z.input<typeof createWorkOrder>;
