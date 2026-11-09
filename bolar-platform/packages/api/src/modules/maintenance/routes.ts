import { Router } from 'express';
import {
  z, idParams, paginationQuery, createWorkOrder, createWorkOrderResponse, updateWorkOrder, transitionWorkOrder, assignWorkOrder, workOrderNote, markDuplicate,
  workOrder, workOrderPage, workOrderDetail, workOrderEvent, workOrderEventPage, workOrderQuery, slaScanResponse, DUPLICATE_WINDOW_DAYS, WORK_ORDER_OPEN_STATUSES,
  type WorkOrderStatus, type WorkOrderPriority,
} from '@bolar/contracts';
import { errors, toPage, decodeCursor } from '@bolar/shared';
import type { Prisma, WorkOrder } from '@bolar/db';
import { defineRoute, mount } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { requireAccess } from '../../shared/access.js';
import { publish } from '../../shared/events.js';
import { evaluateAssignment } from '../vendor/assignment.js';
import { workOrderMachine, allowedTransitions, type TransitionGuardContext, type WorkOrderActorKind } from './state-machine.js';
import {
  actorKindsFor, addEvent, eventDto, isOpenStatus, isStaff, myUnitIds, requireWorkOrderManage, requireWorkOrderView, slaDueFor, toWorkOrderDtos, userNames, visibilityWhere, workOrderRef,
} from './service.js';

async function loadWorkOrder(ctx: Parameters<typeof tenantDb>[0], id: string): Promise<WorkOrder> {
  const wo = await tenantDb(ctx).workOrder.findFirst({ where: { id } });
  if (!wo) throw errors.notFound();
  return wo;
}

async function endAssignmentEdges(tenantOrgId: string, workOrderId: string): Promise<void> {
  await prisma.relationshipEdge.updateMany({ where: { tenantOrgId, relation: 'assigned_to', objectType: 'work_order', objectId: workOrderId, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, data: { endsAt: new Date() } });
}

/** Apply one state-machine transition with its side effects, event, audit and domain event. Caller has already verified view access. */
async function applyTransition(ctx: Parameters<typeof tenantDb>[0], wo: WorkOrder, to: WorkOrderStatus, kinds: WorkOrderActorKind[], input: { note?: string; scheduledFor?: string; actualCents?: number }): Promise<WorkOrder> {
  const from = wo.status as WorkOrderStatus;
  const now = new Date();
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : wo.scheduledFor;
  const guard: TransitionGuardContext & { from: WorkOrderStatus } = { hasAssignee: Boolean(wo.assignedVendorId || wo.assignedUserId), scheduledFor, note: input.note, completedAt: wo.completedAt, actorKinds: kinds, now, from };
  workOrderMachine.assertTransition(from, to, kinds, guard);
  const data: Prisma.WorkOrderUncheckedUpdateInput = { status: to };
  if (to === 'scheduled') data.scheduledFor = scheduledFor;
  if (to === 'review' && input.actualCents !== undefined) data.actualCents = input.actualCents;
  if (to === 'complete') data.completedAt = now;
  if (to === 'reopened') data.reopenedCount = { increment: 1 };
  if (to === 'triaged' && from === 'assigned') { data.assignedVendorId = null; data.assignedUserId = null; data.scheduledFor = null; }
  const updated = await prisma.workOrder.update({ where: { id: wo.id }, data });
  if (to === 'triaged' && from === 'assigned') {
    await endAssignmentEdges(ctx.tenantOrgId!, wo.id);
    await addEvent(ctx, wo.id, 'unassigned', { vendorId: wo.assignedVendorId, userId: wo.assignedUserId, reason: input.note });
  }
  await addEvent(ctx, wo.id, 'status_changed', { from, to, note: input.note ?? null, scheduledFor: to === 'scheduled' ? scheduledFor?.toISOString() : undefined, actualCents: input.actualCents });
  await audit(ctx, { action: 'work_order.transition', resourceType: 'work_order', resourceId: wo.id, before: { status: from }, after: { status: to, note: input.note ?? null } });
  await publish(ctx, 'work_order.transitioned', { workOrderId: wo.id, from, to, propertyId: wo.propertyId, requesterId: wo.requesterId, assignedVendorId: updated.assignedVendorId });
  return updated;
}

export const maintenanceRoutes = [
  // ---- Day 31: tenant request intake ----
  defineRoute({ method: 'post', path: '/work-orders', operationId: 'createWorkOrder', summary: 'Submit a maintenance request (tenant) or create a work order (staff)', tags: ['maintenance'], auth: 'session',
    request: { body: createWorkOrder }, responses: { 201: createWorkOrderResponse },
    handler: async ({ body, ctx }) => {
      const db = tenantDb(ctx);
      let propertyId: string; let unitId: string | null; let requesterKind: 'tenant' | 'staff';
      if (body.propertyId) {
        if (!ctx.permissions.has('work_order:write')) throw errors.forbidden();
        const prop = await db.property.findFirst({ where: { id: body.propertyId }, select: { id: true } });
        if (!prop) throw errors.validation([{ path: 'body.propertyId', message: 'Unknown property' }]);
        await requireAccess(ctx, 'work_order:write', { type: 'property', id: prop.id, propertyId: prop.id }, ['manages']);
        propertyId = prop.id; requesterKind = 'staff'; unitId = null;
        if (body.unitId) {
          const unit = await db.unit.findFirst({ where: { id: body.unitId, propertyId }, select: { id: true } });
          if (!unit) throw errors.validation([{ path: 'body.unitId', message: 'Unit does not belong to this property' }]);
          unitId = unit.id;
        }
      } else {
        if (!ctx.permissions.has('maintenance:request')) throw errors.forbidden();
        const units = await myUnitIds(ctx);
        if (units.length === 0) throw errors.validation([{ path: 'body.unitId', message: 'No occupied unit is linked to your account. Contact your property manager.' }]);
        unitId = body.unitId && units.includes(body.unitId) ? body.unitId : units[0]!;
        const unit = await db.unit.findFirst({ where: { id: unitId }, select: { propertyId: true } });
        if (!unit) throw errors.validation([{ path: 'body.unitId', message: 'Unknown unit' }]);
        propertyId = unit.propertyId; requesterKind = 'tenant';
      }
      const now = new Date();
      const dupSince = new Date(now.getTime() - DUPLICATE_WINDOW_DAYS * 86_400_000);
      const dup = await db.workOrder.findFirst({ where: { propertyId, unitId, category: body.category, status: { in: [...WORK_ORDER_OPEN_STATUSES] }, createdAt: { gte: dupSince } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
      const row = await db.workOrder.create({ data: { tenantOrgId: ctx.tenantOrgId!,
        propertyId, unitId, requesterId: ctx.actor!.userId, requesterKind, title: body.title, description: body.description, category: body.category, priority: body.priority,
        entryPermission: body.entryPermission, availabilityJson: body.availability as never, slaDueAt: slaDueFor(body.priority, now), estimateCents: body.estimateCents ?? null, status: 'new',
      } });
      await addEvent(ctx, row.id, 'created', { priority: row.priority, category: row.category, requesterKind, possibleDuplicateId: dup?.id ?? null });
      if (body.mediaIds?.length) await addEvent(ctx, row.id, 'media_added', { mediaIds: body.mediaIds });
      await audit(ctx, { action: 'work_order.create', resourceType: 'work_order', resourceId: row.id, after: { title: row.title, category: row.category, priority: row.priority, propertyId, unitId, requesterKind } });
      await publish(ctx, 'work_order.created', { workOrderId: row.id, propertyId, unitId, priority: row.priority, category: row.category, requesterId: row.requesterId, slaDueAt: row.slaDueAt?.toISOString() ?? null, templateKey: 'workorder.created' });
      const [dto] = await toWorkOrderDtos(ctx.tenantOrgId!, [row], now);
      return { status: 201, body: { ...dto!, possibleDuplicateId: dup?.id ?? null } };
    } }),

  defineRoute({ method: 'get', path: '/work-orders', operationId: 'listWorkOrders', summary: 'List work orders visible to the actor (board/list with filters)', tags: ['maintenance'], auth: 'session', permission: 'work_order:read',
    request: { query: workOrderQuery }, responses: { 200: workOrderPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const now = new Date();
      const filters: Prisma.WorkOrderWhereInput[] = [await visibilityWhere(ctx)];
      if (query.status?.length) filters.push({ status: { in: query.status } });
      else if (!query.includeCanceled) filters.push({ status: { not: 'canceled' } });
      if (query.priority) filters.push({ priority: query.priority });
      if (query.category) filters.push({ category: query.category });
      if (query.propertyId) filters.push({ propertyId: query.propertyId });
      if (query.assignedVendorId) filters.push({ assignedVendorId: query.assignedVendorId });
      if (query.assignedUserId) filters.push({ assignedUserId: query.assignedUserId });
      if (query.mine) filters.push({ OR: [{ requesterId: ctx.actor!.userId }, { assignedUserId: ctx.actor!.userId }] });
      if (query.overdue) filters.push({ slaDueAt: { lt: now }, status: { in: [...WORK_ORDER_OPEN_STATUSES] } });
      if (query.q) filters.push({ OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { description: { contains: query.q, mode: 'insensitive' } }] });
      const rows = await tenantDb(ctx).workOrder.findMany({ where: { AND: filters }, take: query.limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: await toWorkOrderDtos(ctx.tenantOrgId!, page.items, now) } };
    } }),

  // ---- Day 35: SLA scan (manager or scheduler). Idempotent per order: one sla_breached event. ----
  defineRoute({ method: 'post', path: '/work-orders/sla/scan', operationId: 'scanWorkOrderSla', summary: 'Mark overdue open work orders as SLA breached (idempotent)', tags: ['maintenance'], auth: 'session', permission: 'work_order:write',
    responses: { 200: slaScanResponse },
    handler: async ({ ctx }) => {
      const now = new Date();
      const overdue = await tenantDb(ctx).workOrder.findMany({ where: { AND: [await visibilityWhere(ctx), { slaDueAt: { lt: now }, status: { in: [...WORK_ORDER_OPEN_STATUSES] } }] }, take: 500, orderBy: { slaDueAt: 'asc' } });
      const already = new Set((await prisma.workOrderEvent.findMany({ where: { tenantOrgId: ctx.tenantOrgId!, eventType: 'sla_breached', workOrderId: { in: overdue.map((o) => o.id) } }, select: { workOrderId: true } })).map((e) => e.workOrderId));
      const breached: string[] = [];
      for (const wo of overdue) {
        if (already.has(wo.id)) continue;
        await addEvent(ctx, wo.id, 'sla_breached', { slaDueAt: wo.slaDueAt?.toISOString(), priority: wo.priority, status: wo.status, hoursOverdue: Math.round((now.getTime() - wo.slaDueAt!.getTime()) / 3_600_000) });
        await audit(ctx, { action: 'work_order.sla_breached', resourceType: 'work_order', resourceId: wo.id, metadata: { slaDueAt: wo.slaDueAt?.toISOString(), priority: wo.priority } });
        await publish(ctx, 'work_order.sla_breached', { workOrderId: wo.id, propertyId: wo.propertyId, priority: wo.priority, status: wo.status, slaDueAt: wo.slaDueAt?.toISOString(), assignedVendorId: wo.assignedVendorId });
        breached.push(wo.id);
      }
      return { status: 200, body: { scanned: overdue.length, breached } };
    } }),

  defineRoute({ method: 'get', path: '/work-orders/:id', operationId: 'getWorkOrder', summary: 'Work order detail with timeline, vendor summary and allowed next states', tags: ['maintenance'], auth: 'session', permission: 'work_order:read',
    request: { params: idParams }, responses: { 200: workOrderDetail },
    handler: async ({ params, ctx }) => {
      const wo = await loadWorkOrder(ctx, params.id);
      await requireWorkOrderView(ctx, wo);
      const now = new Date();
      const [events, kinds, [dto]] = await Promise.all([
        prisma.workOrderEvent.findMany({ where: { tenantOrgId: ctx.tenantOrgId!, workOrderId: wo.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 200 }),
        actorKindsFor(ctx, wo),
        toWorkOrderDtos(ctx.tenantOrgId!, [wo], now),
      ]);
      const names = await userNames(ctx.tenantOrgId!, events.map((e) => e.actorId));
      const allowed = allowedTransitions(wo.status as WorkOrderStatus, kinds, { hasAssignee: Boolean(wo.assignedVendorId || wo.assignedUserId), scheduledFor: wo.scheduledFor, completedAt: wo.completedAt, actorKinds: kinds, now });
      return { body: { ...dto!, events: events.map((e) => eventDto(e, names)), allowedTransitions: allowed, actorKinds: kinds } };
    } }),

  defineRoute({ method: 'patch', path: '/work-orders/:id', operationId: 'updateWorkOrder', summary: 'Update staff-editable fields (priority recomputes the SLA)', tags: ['maintenance'], auth: 'session', permission: 'work_order:write',
    request: { params: idParams, body: updateWorkOrder }, responses: { 200: workOrder },
    handler: async ({ params, body, ctx }) => {
      const wo = await loadWorkOrder(ctx, params.id);
      await requireWorkOrderManage(ctx, wo);
      if (!isOpenStatus(wo.status)) throw errors.conflict(`Work order is ${wo.status}`);
      const { availability, scheduledFor, unitId, ...rest } = body;
      const data: Prisma.WorkOrderUncheckedUpdateInput = { ...rest };
      if (availability) data.availabilityJson = availability as never;
      if (scheduledFor !== undefined) data.scheduledFor = scheduledFor ? new Date(scheduledFor) : null;
      if (unitId !== undefined) {
        if (unitId) {
          const unit = await tenantDb(ctx).unit.findFirst({ where: { id: unitId, propertyId: wo.propertyId }, select: { id: true } });
          if (!unit) throw errors.validation([{ path: 'body.unitId', message: 'Unit does not belong to this property' }]);
        }
        data.unitId = unitId;
      }
      if (body.priority && body.priority !== wo.priority) data.slaDueAt = slaDueFor(body.priority as WorkOrderPriority, wo.createdAt);
      const updated = await prisma.workOrder.update({ where: { id: wo.id }, data });
      if (body.priority && body.priority !== wo.priority) await addEvent(ctx, wo.id, 'escalated', { from: wo.priority, to: body.priority, slaDueAt: updated.slaDueAt?.toISOString() });
      await audit(ctx, { action: 'work_order.update', resourceType: 'work_order', resourceId: wo.id, before: { priority: wo.priority, title: wo.title, estimateCents: wo.estimateCents }, after: body });
      const [dto] = await toWorkOrderDtos(ctx.tenantOrgId!, [updated]);
      return { body: dto! };
    } }),

  // ---- Day 32: state machine ----
  defineRoute({ method: 'post', path: '/work-orders/:id/transition', operationId: 'transitionWorkOrder', summary: 'Move a work order to its next state (manager/vendor/tenant permissions enforced)', tags: ['maintenance'], auth: 'session',
    request: { params: idParams, body: transitionWorkOrder }, responses: { 200: workOrderDetail },
    handler: async ({ params, body, ctx }) => {
      const wo = await loadWorkOrder(ctx, params.id);
      await requireWorkOrderView(ctx, wo);
      const kinds = await actorKindsFor(ctx, wo);
      if (kinds.length === 0) throw errors.forbidden();
      const updated = await applyTransition(ctx, wo, body.to, kinds, body);
      const events = await prisma.workOrderEvent.findMany({ where: { tenantOrgId: ctx.tenantOrgId!, workOrderId: wo.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 200 });
      const names = await userNames(ctx.tenantOrgId!, events.map((e) => e.actorId));
      const now = new Date();
      const nextKinds = await actorKindsFor(ctx, updated);
      const [dto] = await toWorkOrderDtos(ctx.tenantOrgId!, [updated], now);
      const allowed = allowedTransitions(updated.status as WorkOrderStatus, nextKinds, { hasAssignee: Boolean(updated.assignedVendorId || updated.assignedUserId), scheduledFor: updated.scheduledFor, completedAt: updated.completedAt, actorKinds: nextKinds, now });
      return { status: 200, body: { ...dto!, events: events.map((e) => eventDto(e, names)), allowedTransitions: allowed, actorKinds: nextKinds } };
    } }),

  // ---- Day 33: assignment with vendor rules ----
  defineRoute({ method: 'post', path: '/work-orders/:id/assign', operationId: 'assignWorkOrder', summary: 'Assign a vendor (rules: approved, trade, coverage, insurance, budget) or an in-house user', tags: ['maintenance'], auth: 'session', permission: 'work_order:assign',
    request: { params: idParams, body: assignWorkOrder }, responses: { 200: workOrder },
    handler: async ({ params, body, ctx }) => {
      const wo = await loadWorkOrder(ctx, params.id);
      await requireWorkOrderManage(ctx, wo, 'work_order:assign');
      if (!isOpenStatus(wo.status) || wo.status === 'new' || wo.status === 'review') throw errors.conflict(`Cannot assign a work order that is ${wo.status}${wo.status === 'new' ? ' (triage it first)' : ''}`);
      const db = tenantDb(ctx);
      const data: Prisma.WorkOrderUncheckedUpdateInput = {};
      let edgeUserId: string | null = null;
      let eventPayload: Record<string, unknown>;
      if (body.vendorId) {
        const vendor = await db.vendorProfile.findFirst({ where: { id: body.vendorId } });
        if (!vendor) throw errors.validation([{ path: 'body.vendorId', message: 'Unknown vendor' }]);
        const verdict = evaluateAssignment(vendor, wo);
        if (!verdict.eligible) throw errors.validation(verdict.reasons.map((r) => ({ path: 'body.vendorId', message: r })), 'Vendor does not pass assignment rules');
        data.assignedVendorId = vendor.id; data.assignedUserId = null; edgeUserId = vendor.userId;
        eventPayload = { vendorId: vendor.id, vendorName: vendor.name };
      } else {
        const user = await prisma.userProfile.findFirst({ where: { id: body.userId!, tenantOrgId: ctx.tenantOrgId!, status: 'active' }, select: { id: true, name: true } });
        if (!user) throw errors.validation([{ path: 'body.userId', message: 'Unknown user' }]);
        data.assignedUserId = user.id; data.assignedVendorId = null; edgeUserId = user.id;
        eventPayload = { userId: user.id, userName: user.name };
      }
      await endAssignmentEdges(ctx.tenantOrgId!, wo.id);
      let updated = await prisma.workOrder.update({ where: { id: wo.id }, data });
      if (edgeUserId) await prisma.relationshipEdge.create({ data: { tenantOrgId: ctx.tenantOrgId!, subjectType: 'user', subjectId: edgeUserId, relation: 'assigned_to', objectType: 'work_order', objectId: wo.id, grantedBy: ctx.actor!.userId } });
      await addEvent(ctx, wo.id, 'assigned', eventPayload);
      await audit(ctx, { action: 'work_order.assign', resourceType: 'work_order', resourceId: wo.id, before: { assignedVendorId: wo.assignedVendorId, assignedUserId: wo.assignedUserId }, after: eventPayload });
      await publish(ctx, 'work_order.assigned', { workOrderId: wo.id, ...eventPayload, assigneeUserId: edgeUserId });
      if (updated.status === 'triaged') updated = await applyTransition(ctx, updated, 'assigned', ['manager'], {});
      const [dto] = await toWorkOrderDtos(ctx.tenantOrgId!, [updated]);
      return { status: 200, body: dto! };
    } }),

  defineRoute({ method: 'post', path: '/work-orders/:id/notes', operationId: 'addWorkOrderNote', summary: 'Add a note or message to the work order timeline', tags: ['maintenance'], auth: 'session', permission: 'work_order:read',
    request: { params: idParams, body: workOrderNote }, responses: { 201: workOrderEvent },
    handler: async ({ params, body, ctx }) => {
      const wo = await loadWorkOrder(ctx, params.id);
      await requireWorkOrderView(ctx, wo);
      const ev = await addEvent(ctx, wo.id, body.kind, { body: body.body });
      await audit(ctx, { action: 'work_order.note', resourceType: 'work_order', resourceId: wo.id, metadata: { kind: body.kind, eventId: ev.id } });
      if (body.kind === 'message') await publish(ctx, 'work_order.message', { workOrderId: wo.id, eventId: ev.id, requesterId: wo.requesterId, assignedVendorId: wo.assignedVendorId });
      return { status: 201, body: eventDto(ev, new Map([[ctx.actor!.userId, ctx.actor!.name]])) };
    } }),

  defineRoute({ method: 'get', path: '/work-orders/:id/events', operationId: 'listWorkOrderEvents', summary: 'Work order timeline (created, status changes, assignments, notes, SLA)', tags: ['maintenance'], auth: 'session', permission: 'work_order:read',
    request: { params: idParams, query: paginationQuery }, responses: { 200: workOrderEventPage },
    handler: async ({ params, query, ctx }) => {
      const wo = await loadWorkOrder(ctx, params.id);
      await requireWorkOrderView(ctx, wo);
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await prisma.workOrderEvent.findMany({ where: { tenantOrgId: ctx.tenantOrgId!, workOrderId: wo.id }, take: query.limit + 1, orderBy: { id: 'asc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      const names = await userNames(ctx.tenantOrgId!, page.items.map((e) => e.actorId));
      return { body: { ...page, items: page.items.map((e) => eventDto(e, names)) } };
    } }),

  defineRoute({ method: 'post', path: '/work-orders/:id/mark-duplicate', operationId: 'markWorkOrderDuplicate', summary: 'Mark a work order as a duplicate of another and cancel it', tags: ['maintenance'], auth: 'session', permission: 'work_order:write',
    request: { params: idParams, body: markDuplicate }, responses: { 200: workOrder },
    handler: async ({ params, body, ctx }) => {
      const wo = await loadWorkOrder(ctx, params.id);
      await requireWorkOrderManage(ctx, wo);
      if (body.duplicateOfId === wo.id) throw errors.validation([{ path: 'body.duplicateOfId', message: 'A work order cannot duplicate itself' }]);
      const original = await tenantDb(ctx).workOrder.findFirst({ where: { id: body.duplicateOfId }, select: { id: true, propertyId: true } });
      if (!original) throw errors.validation([{ path: 'body.duplicateOfId', message: 'Unknown work order' }]);
      if (original.propertyId !== wo.propertyId) throw errors.validation([{ path: 'body.duplicateOfId', message: 'Original must be at the same property' }]);
      let updated = await prisma.workOrder.update({ where: { id: wo.id }, data: { duplicateOfId: original.id } });
      await addEvent(ctx, wo.id, 'duplicate', { duplicateOfId: original.id });
      await audit(ctx, { action: 'work_order.mark_duplicate', resourceType: 'work_order', resourceId: wo.id, after: { duplicateOfId: original.id } });
      if (isOpenStatus(updated.status)) updated = await applyTransition(ctx, updated, 'canceled', ['manager'], { note: `Duplicate of ${original.id}` });
      const [dto] = await toWorkOrderDtos(ctx.tenantOrgId!, [updated]);
      return { status: 200, body: dto! };
    } }),
];

export const maintenanceRouter: Router = Router();
mount(maintenanceRouter, maintenanceRoutes);
export { isStaff, workOrderRef, z };
