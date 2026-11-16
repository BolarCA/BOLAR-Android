import { Router } from 'express';
import {
  idParams, paginationQuery, vendorProfile, vendorPage, createVendor, updateVendor, vendorQuery, vendorContract, vendorContractPage, createVendorContract, inviteVendor, inviteVendorResponse,
  eligibleVendorsQuery, eligibleVendorsResponse, workOrderPage, WORK_ORDER_OPEN_STATUSES, type VendorProfileDto, type WorkOrderCategory,
} from '@bolar/contracts';
import { errors, toPage, decodeCursor } from '@bolar/shared';
import type { Prisma, VendorProfile } from '@bolar/db';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma, tenantDb } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { newOpaqueToken, hashToken } from '../../shared/tokens.js';
import { config } from '../../config.js';
import { evaluateAssignment, insuranceStatus, vendorCoveragePropertyIds, vendorTrades } from './assignment.js';
import { requireWorkOrderManage, toWorkOrderDtos } from '../maintenance/service.js';

const INVITE_TTL_MS = 7 * 86_400_000;

async function openCounts(tenantOrgId: string, vendorIds: string[]): Promise<Map<string, number>> {
  if (!vendorIds.length) return new Map();
  const groups = await prisma.workOrder.groupBy({ by: ['assignedVendorId'], where: { tenantOrgId, assignedVendorId: { in: vendorIds }, status: { in: [...WORK_ORDER_OPEN_STATUSES] } }, _count: { _all: true } });
  return new Map(groups.map((g) => [g.assignedVendorId!, g._count._all]));
}

export function toVendorDto(v: VendorProfile, openWorkOrders = 0): VendorProfileDto {
  const coverage = v.coverageJson as { propertyIds?: unknown; regions?: unknown } | null;
  return {
    ...(toDto(v) as unknown as VendorProfileDto),
    trades: vendorTrades(v),
    coverageJson: { propertyIds: vendorCoveragePropertyIds(v), regions: coverage && Array.isArray(coverage.regions) ? coverage.regions.map(String) : [] },
    insuranceStatus: insuranceStatus(v.insuranceExpiresAt),
    openWorkOrders,
  };
}

async function loadVendor(ctx: Parameters<typeof tenantDb>[0], id: string): Promise<VendorProfile> {
  const v = await tenantDb(ctx).vendorProfile.findFirst({ where: { id } });
  if (!v) throw errors.notFound();
  return v;
}

async function validateVendorUser(ctx: Parameters<typeof tenantDb>[0], userId: string): Promise<void> {
  const user = await prisma.userProfile.findFirst({ where: { id: userId, tenantOrgId: ctx.tenantOrgId! }, select: { id: true } });
  if (!user) throw errors.validation([{ path: 'body.userId', message: 'Unknown user' }]);
  const taken = await prisma.vendorProfile.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, userId }, select: { id: true } });
  if (taken) throw errors.conflict('This login is already linked to another vendor profile');
}

async function setVendorStatus(ctx: Parameters<typeof tenantDb>[0], id: string, status: 'approved' | 'suspended'): Promise<VendorProfileDto> {
  const v = await loadVendor(ctx, id);
  if (v.status === status) throw errors.conflict(`Vendor is already ${status}`);
  if (v.status === 'archived') throw errors.conflict('Archived vendors cannot change status');
  const updated = await prisma.vendorProfile.update({ where: { id: v.id }, data: { status } });
  await audit(ctx, { action: `vendor.${status === 'approved' ? 'approve' : 'suspend'}`, resourceType: 'vendor', resourceId: v.id, before: { status: v.status }, after: { status } });
  await publish(ctx, `vendor.${status}`, { vendorId: v.id, userId: v.userId });
  return toVendorDto(updated, (await openCounts(ctx.tenantOrgId!, [v.id])).get(v.id) ?? 0);
}

export const vendorRoutes = [
  defineRoute({ method: 'get', path: '/vendors', operationId: 'listVendors', summary: 'Vendor rolodex with status/trade filters', tags: ['vendor'], auth: 'session', permission: 'vendor:read',
    request: { query: vendorQuery }, responses: { 200: vendorPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const where: Prisma.VendorProfileWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.trade ? { trades: { array_contains: [query.trade] } } : {}),
        ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { email: { contains: query.q, mode: 'insensitive' } }] } : {}),
      };
      const rows = await tenantDb(ctx).vendorProfile.findMany({ where, take: query.limit + 1, orderBy: [{ name: 'asc' }, { id: 'asc' }], ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      const counts = await openCounts(ctx.tenantOrgId!, page.items.map((v) => v.id));
      return { body: { ...page, items: page.items.map((v) => toVendorDto(v, counts.get(v.id) ?? 0)) } };
    } }),

  defineRoute({ method: 'post', path: '/vendors', operationId: 'createVendor', summary: 'Add a vendor profile (pending until approved)', tags: ['vendor'], auth: 'session', permission: 'vendor:write',
    request: { body: createVendor }, responses: { 201: vendorProfile },
    handler: async ({ body, ctx }) => {
      const db = tenantDb(ctx);
      const dup = await db.vendorProfile.findFirst({ where: { name: { equals: body.name, mode: 'insensitive' }, status: { not: 'archived' } }, select: { id: true } });
      if (dup) throw errors.conflict('A vendor with this name already exists');
      if (body.userId) await validateVendorUser(ctx, body.userId);
      if (body.coverage?.propertyIds.length) {
        const found = await db.property.count({ where: { id: { in: body.coverage.propertyIds } } });
        if (found !== body.coverage.propertyIds.length) throw errors.validation([{ path: 'body.coverage.propertyIds', message: 'Unknown property in coverage' }]);
      }
      const { coverage, insuranceExpiresAt, ...rest } = body;
      const row = await db.vendorProfile.create({ data: { tenantOrgId: ctx.tenantOrgId!, ...rest, trades: body.trades as never, coverageJson: (coverage ?? { propertyIds: [], regions: [] }) as never, insuranceExpiresAt: insuranceExpiresAt ? new Date(insuranceExpiresAt) : null, status: 'pending' } });
      await audit(ctx, { action: 'vendor.create', resourceType: 'vendor', resourceId: row.id, after: { name: row.name, trades: body.trades, status: row.status } });
      await publish(ctx, 'vendor.created', { vendorId: row.id });
      return { status: 201, body: toVendorDto(row) };
    } }),

  // Must be declared before /vendors/:id.
  defineRoute({ method: 'get', path: '/vendors/eligible', operationId: 'listEligibleVendors', summary: 'Vendors evaluated against assignment rules for a work order, with reasons for the ineligible ones', tags: ['vendor'], auth: 'session', permission: 'work_order:assign',
    request: { query: eligibleVendorsQuery }, responses: { 200: eligibleVendorsResponse },
    handler: async ({ query, ctx }) => {
      const wo = await tenantDb(ctx).workOrder.findFirst({ where: { id: query.workOrderId } });
      if (!wo) throw errors.notFound();
      await requireWorkOrderManage(ctx, wo, 'work_order:assign');
      const vendors = await tenantDb(ctx).vendorProfile.findMany({ where: { status: { not: 'archived' } }, orderBy: { name: 'asc' }, take: 200 });
      const counts = await openCounts(ctx.tenantOrgId!, vendors.map((v) => v.id));
      const items = vendors
        .map((v) => ({ vendor: toVendorDto(v, counts.get(v.id) ?? 0), ...evaluateAssignment(v, wo) }))
        .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.vendor.name.localeCompare(b.vendor.name));
      return { body: { workOrderId: wo.id, category: wo.category as WorkOrderCategory, items } };
    } }),

  defineRoute({ method: 'get', path: '/vendors/:id', operationId: 'getVendor', summary: 'Vendor detail', tags: ['vendor'], auth: 'session', permission: 'vendor:read',
    request: { params: idParams }, responses: { 200: vendorProfile },
    handler: async ({ params, ctx }) => {
      const v = await loadVendor(ctx, params.id);
      return { body: toVendorDto(v, (await openCounts(ctx.tenantOrgId!, [v.id])).get(v.id) ?? 0) };
    } }),

  defineRoute({ method: 'patch', path: '/vendors/:id', operationId: 'updateVendor', summary: 'Update vendor profile, trades, coverage, insurance, budget or linked login', tags: ['vendor'], auth: 'session', permission: 'vendor:write',
    request: { params: idParams, body: updateVendor }, responses: { 200: vendorProfile },
    handler: async ({ params, body, ctx }) => {
      const v = await loadVendor(ctx, params.id);
      if (body.userId && body.userId !== v.userId) await validateVendorUser(ctx, body.userId);
      if (body.coverage?.propertyIds.length) {
        const found = await tenantDb(ctx).property.count({ where: { id: { in: body.coverage.propertyIds } } });
        if (found !== body.coverage.propertyIds.length) throw errors.validation([{ path: 'body.coverage.propertyIds', message: 'Unknown property in coverage' }]);
      }
      const { coverage, insuranceExpiresAt, trades, ...rest } = body;
      const data: Prisma.VendorProfileUncheckedUpdateInput = { ...rest };
      if (trades) data.trades = trades as never;
      if (coverage) data.coverageJson = coverage as never;
      if (insuranceExpiresAt !== undefined) data.insuranceExpiresAt = insuranceExpiresAt ? new Date(insuranceExpiresAt) : null;
      const updated = await prisma.vendorProfile.update({ where: { id: v.id }, data });
      await audit(ctx, { action: 'vendor.update', resourceType: 'vendor', resourceId: v.id, before: { name: v.name, trades: vendorTrades(v), budgetLimitCents: v.budgetLimitCents, insuranceExpiresAt: v.insuranceExpiresAt }, after: body });
      return { body: toVendorDto(updated, (await openCounts(ctx.tenantOrgId!, [v.id])).get(v.id) ?? 0) };
    } }),

  defineRoute({ method: 'post', path: '/vendors/:id/approve', operationId: 'approveVendor', summary: 'Approve a vendor for assignment', tags: ['vendor'], auth: 'mfa', permission: 'vendor:write',
    request: { params: idParams }, responses: { 200: vendorProfile }, handler: async ({ params, ctx }) => ({ status: 200, body: await setVendorStatus(ctx, params.id, 'approved') }) }),
  defineRoute({ method: 'post', path: '/vendors/:id/suspend', operationId: 'suspendVendor', summary: 'Suspend a vendor (no new assignments; existing jobs stay visible)', tags: ['vendor'], auth: 'mfa', permission: 'vendor:write',
    request: { params: idParams }, responses: { 200: vendorProfile }, handler: async ({ params, ctx }) => ({ status: 200, body: await setVendorStatus(ctx, params.id, 'suspended') }) }),

  defineRoute({ method: 'get', path: '/vendors/:id/contracts', operationId: 'listVendorContracts', summary: 'Contracts, warranties, insurance certificates and W-9 metadata', tags: ['vendor'], auth: 'session', permission: 'vendor:read',
    request: { params: idParams, query: paginationQuery }, responses: { 200: vendorContractPage },
    handler: async ({ params, query, ctx }) => {
      const v = await loadVendor(ctx, params.id);
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).vendorContract.findMany({ where: { vendorId: v.id }, take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      return { body: toDto(toPage(rows, query.limit)) };
    } }),
  defineRoute({ method: 'post', path: '/vendors/:id/contracts', operationId: 'createVendorContract', summary: 'Attach contract metadata (file via storage key or documents module id)', tags: ['vendor'], auth: 'session', permission: 'vendor:write',
    request: { params: idParams, body: createVendorContract }, responses: { 201: vendorContract },
    handler: async ({ params, body, ctx }) => {
      const v = await loadVendor(ctx, params.id);
      const row = await tenantDb(ctx).vendorContract.create({ data: { tenantOrgId: ctx.tenantOrgId!, vendorId: v.id, kind: body.kind, storageKey: body.storageKey ?? `document:${body.documentId}`, documentId: body.documentId ?? null, startsAt: body.startsAt ? new Date(body.startsAt) : null, endsAt: body.endsAt ? new Date(body.endsAt) : null } });
      if (body.kind === 'insurance_certificate' && body.endsAt) await prisma.vendorProfile.update({ where: { id: v.id }, data: { insuranceExpiresAt: new Date(body.endsAt) } });
      await audit(ctx, { action: 'vendor.contract.create', resourceType: 'vendor', resourceId: v.id, after: { contractId: row.id, kind: row.kind, endsAt: row.endsAt } });
      return { status: 201, body: toDto(row) };
    } }),

  defineRoute({ method: 'post', path: '/vendors/:id/invite', operationId: 'inviteVendor', summary: 'Invite the vendor to the vendor portal (vendor role, 7-day token)', tags: ['vendor'], auth: 'mfa', permission: 'vendor:write',
    request: { params: idParams, body: inviteVendor }, responses: { 201: inviteVendorResponse },
    handler: async ({ params, body, ctx }) => {
      const v = await loadVendor(ctx, params.id);
      if (v.userId) throw errors.conflict('Vendor already has a portal login');
      const dup = await prisma.invitation.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, email: body.email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (dup) throw errors.conflict('An active invitation already exists for this email');
      const existing = await prisma.userProfile.findFirst({ where: { tenantOrgId: ctx.tenantOrgId!, email: body.email }, select: { status: true } });
      if (existing && existing.status !== 'invited') throw errors.conflict('A user with this email already exists; link them with PATCH /vendors/:id {userId}');
      const token = newOpaqueToken();
      const inv = await prisma.invitation.create({ data: { tenantOrgId: ctx.tenantOrgId!, email: body.email, role: 'vendor', scopeType: 'org', scopeId: ctx.tenantOrgId!, tokenHash: hashToken(token), invitedBy: ctx.actor!.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
      if (!v.email) await prisma.vendorProfile.update({ where: { id: v.id }, data: { email: body.email } });
      await audit(ctx, { action: 'vendor.invite', resourceType: 'vendor', resourceId: v.id, after: { invitationId: inv.id, role: 'vendor' } });
      const acceptUrl = `${config().WEB_BASE_URL}/accept-invite?token=${token}`;
      await publish(ctx, 'invitation.created', { invitationId: inv.id, acceptUrl, templateKey: 'invite.staff', vendorId: v.id });
      // Linking VendorProfile.userId when the invite is accepted is handled by the integrator (see docs/qa/maintenance-qa.md);
      // until then a manager can link the created login with PATCH /vendors/:id {userId}.
      return { status: 201, body: { invitationId: inv.id, email: inv.email, role: 'vendor' as const, status: 'pending' as const, expiresAt: inv.expiresAt.toISOString(), ...(config().NODE_ENV !== 'production' ? { acceptUrl } : {}) } };
    } }),

  defineRoute({ method: 'get', path: '/vendors/:id/work-orders', operationId: 'listVendorWorkOrders', summary: 'Work orders assigned to a vendor', tags: ['vendor'], auth: 'session', permission: 'vendor:read',
    request: { params: idParams, query: paginationQuery }, responses: { 200: workOrderPage },
    handler: async ({ params, query, ctx }) => {
      const v = await loadVendor(ctx, params.id);
      const c = decodeCursor<{ id: string }>(query.cursor);
      const rows = await tenantDb(ctx).workOrder.findMany({ where: { assignedVendorId: v.id }, take: query.limit + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: await toWorkOrderDtos(ctx.tenantOrgId!, page.items) } };
    } }),
];

export const vendorRouter: Router = Router();
mount(vendorRouter, vendorRoutes);
