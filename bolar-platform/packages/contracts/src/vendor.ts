// vendor contracts (blueprint Day 33): vendor rolodex, trades, coverage, insurance, contracts, assignment rules.
import { z } from './openapi-zod.js';
import { centsSchema, emailSchema, idSchema, pageOf, paginationQuery } from './common.js';
import { WORK_ORDER_CATEGORIES, type WorkOrderCategory } from './maintenance.js';

export const VENDOR_TRADES = ['plumbing', 'electrical', 'hvac', 'appliance', 'general', 'pest', 'roofing', 'landscaping', 'cleaning', 'locksmith', 'other'] as const;
export type VendorTrade = (typeof VENDOR_TRADES)[number];
export const VENDOR_STATUSES = ['pending', 'approved', 'suspended', 'archived'] as const;
export const VENDOR_CONTRACT_KINDS = ['msa', 'warranty', 'insurance_certificate', 'w9'] as const;

/** Work order category -> trades that may take it. An empty list means any trade qualifies. */
export const CATEGORY_TRADES: Record<WorkOrderCategory, readonly VendorTrade[]> = {
  plumbing: ['plumbing', 'general'],
  electrical: ['electrical', 'general'],
  hvac: ['hvac', 'general'],
  appliance: ['appliance', 'electrical', 'plumbing', 'general'],
  structural: ['general', 'roofing'],
  pest: ['pest'],
  safety: ['general', 'electrical', 'locksmith'],
  other: [],
};

export const ASSIGNMENT_REASONS = ['vendor_not_approved', 'trade_mismatch', 'outside_coverage', 'insurance_missing', 'insurance_expired', 'over_budget', 'no_portal_login'] as const;
export type AssignmentReason = (typeof ASSIGNMENT_REASONS)[number];

export const vendorCoverage = z.object({ propertyIds: z.array(idSchema).max(500).default([]), regions: z.array(z.string().max(64)).max(50).default([]) }).openapi('VendorCoverage');

export const vendorProfile = z
  .object({
    id: idSchema,
    userId: idSchema.nullable(),
    name: z.string(),
    status: z.enum(VENDOR_STATUSES),
    trades: z.array(z.string()),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    insuranceExpiresAt: z.string().nullable(),
    insuranceStatus: z.enum(['missing', 'valid', 'expiring', 'expired']),
    licenseNumber: z.string().nullable(),
    coverageJson: vendorCoverage,
    budgetLimitCents: z.number().int().nullable(),
    openWorkOrders: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('VendorProfile');
export const vendorPage = pageOf(vendorProfile, 'VendorProfile');

export const createVendor = z
  .object({
    name: z.string().trim().min(2).max(140),
    trades: z.array(z.enum(VENDOR_TRADES)).min(1).max(10),
    email: emailSchema.optional(),
    phone: z.string().trim().min(7).max(32).optional(),
    insuranceExpiresAt: z.string().datetime({ offset: true }).optional(),
    licenseNumber: z.string().trim().max(64).optional(),
    coverage: vendorCoverage.optional(),
    budgetLimitCents: centsSchema.optional(),
    /** Link an existing vendor-role login in this org. */
    userId: idSchema.optional(),
  })
  .openapi('CreateVendor');

export const updateVendor = z
  .object({
    name: z.string().trim().min(2).max(140).optional(),
    trades: z.array(z.enum(VENDOR_TRADES)).min(1).max(10).optional(),
    email: emailSchema.nullable().optional(),
    phone: z.string().trim().min(7).max(32).nullable().optional(),
    insuranceExpiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    licenseNumber: z.string().trim().max(64).nullable().optional(),
    coverage: vendorCoverage.optional(),
    budgetLimitCents: centsSchema.nullable().optional(),
    userId: idSchema.nullable().optional(),
  })
  .openapi('UpdateVendor');

export const vendorQuery = paginationQuery.extend({ status: z.enum(VENDOR_STATUSES).optional(), trade: z.enum(VENDOR_TRADES).optional(), q: z.string().max(100).optional() });

export const vendorContract = z
  .object({ id: idSchema, vendorId: idSchema, kind: z.enum(VENDOR_CONTRACT_KINDS), storageKey: z.string(), documentId: idSchema.nullable(), startsAt: z.string().nullable(), endsAt: z.string().nullable(), createdAt: z.string() })
  .openapi('VendorContract');
export const vendorContractPage = pageOf(vendorContract, 'VendorContract');
export const createVendorContract = z
  .object({ kind: z.enum(VENDOR_CONTRACT_KINDS), storageKey: z.string().trim().min(1).max(512).optional(), documentId: idSchema.optional(), startsAt: z.string().datetime({ offset: true }).optional(), endsAt: z.string().datetime({ offset: true }).optional() })
  .refine((c) => Boolean(c.storageKey) || Boolean(c.documentId), { message: 'Provide storageKey or documentId', path: ['storageKey'] })
  .refine((c) => !c.startsAt || !c.endsAt || new Date(c.endsAt) > new Date(c.startsAt), { message: 'endsAt must be after startsAt', path: ['endsAt'] })
  .openapi('CreateVendorContract');

export const inviteVendor = z.object({ email: emailSchema }).openapi('InviteVendor');
export const inviteVendorResponse = z
  .object({ invitationId: idSchema, email: z.string(), role: z.literal('vendor'), status: z.literal('pending'), expiresAt: z.string(), acceptUrl: z.string().optional() })
  .openapi('InviteVendorResponse');

export const eligibleVendorsQuery = z.object({ workOrderId: idSchema });
export const eligibleVendor = z.object({ vendor: vendorProfile, eligible: z.boolean(), reasons: z.array(z.enum(ASSIGNMENT_REASONS)) }).openapi('EligibleVendor');
export const eligibleVendorsResponse = z.object({ workOrderId: idSchema, category: z.enum(WORK_ORDER_CATEGORIES), items: z.array(eligibleVendor) }).openapi('EligibleVendorsResponse');

export type VendorProfileDto = z.infer<typeof vendorProfile>;
export type VendorContractDto = z.infer<typeof vendorContract>;
export type EligibleVendorDto = z.infer<typeof eligibleVendor>;
