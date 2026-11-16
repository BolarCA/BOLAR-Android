// property contracts (blueprint Days 16-20, schema p16, API p27): portfolios, properties, buildings, units.
import { z } from './openapi-zod.js';
import { centsSchema, idSchema, isoDateSchema, pageOf, paginationQuery } from './common.js';

export const PROPERTY_STATUSES = ['active', 'inactive', 'onboarding', 'archived'] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];
export const PROPERTY_TYPES = ['residential', 'commercial', 'mixed'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const UNIT_STATUSES = ['vacant', 'occupied', 'notice', 'make_ready', 'down', 'reserved'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

const stateSchema = z.string().trim().min(2).max(2).toUpperCase();
const postalSchema = z.string().trim().min(3).max(12);

// ---- Portfolios ----
export const portfolio = z
  .object({ id: idSchema, name: z.string(), ownerUserId: idSchema.nullable(), propertyCount: z.number().int().optional(), createdAt: z.string(), updatedAt: z.string() })
  .openapi('Portfolio');
export const portfolioPage = pageOf(portfolio, 'Portfolio');
export const createPortfolio = z.object({ name: z.string().trim().min(1).max(120), ownerUserId: idSchema.optional() }).openapi('CreatePortfolio');
export const updatePortfolio = z.object({ name: z.string().trim().min(1).max(120).optional(), ownerUserId: idSchema.nullable().optional() }).openapi('UpdatePortfolio');

// ---- Properties ----
export const unitCounts = z
  .object({ total: z.number().int(), vacant: z.number().int(), occupied: z.number().int(), notice: z.number().int(), make_ready: z.number().int(), down: z.number().int(), reserved: z.number().int() })
  .openapi('UnitCounts');

export const property = z
  .object({
    id: idSchema, portfolioId: idSchema.nullable(), subaccountId: idSchema.nullable(), name: z.string(),
    addressLine1: z.string(), addressLine2: z.string().nullable(), city: z.string(), state: z.string(), postalCode: z.string(), county: z.string().nullable(), country: z.string(),
    propertyType: z.enum(PROPERTY_TYPES), status: z.enum(PROPERTY_STATUSES), ownerUserId: idSchema.nullable(), createdAt: z.string(), updatedAt: z.string(),
    unitCounts: unitCounts.optional(),
  })
  .openapi('Property');
export const propertyPage = pageOf(property, 'Property');

export const building = z
  .object({ id: idSchema, propertyId: idSchema, name: z.string().nullable(), floors: z.number().int().nullable(), unitCount: z.number().int().optional(), createdAt: z.string() })
  .openapi('Building');
export const createBuilding = z.object({ name: z.string().trim().min(1).max(120).optional(), floors: z.number().int().min(1).max(200).optional() }).openapi('CreateBuilding');

export const propertyDetail = property
  .extend({ portfolio: z.object({ id: idSchema, name: z.string() }).nullable(), buildings: z.array(building), unitCounts })
  .openapi('PropertyDetail');

export const createProperty = z
  .object({
    name: z.string().trim().min(1).max(160),
    addressLine1: z.string().trim().min(1).max(200),
    addressLine2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    state: stateSchema,
    postalCode: postalSchema,
    county: z.string().trim().max(100).optional(),
    country: z.string().trim().length(2).toUpperCase().default('US'),
    propertyType: z.enum(PROPERTY_TYPES).default('residential'),
    status: z.enum(['active', 'inactive', 'onboarding']).default('onboarding'),
    portfolioId: idSchema.optional(),
    subaccountId: idSchema.optional(),
    ownerUserId: idSchema.optional(),
  })
  .openapi('CreateProperty');

export const updateProperty = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    addressLine1: z.string().trim().min(1).max(200).optional(),
    addressLine2: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().min(1).max(100).optional(),
    state: stateSchema.optional(),
    postalCode: postalSchema.optional(),
    county: z.string().trim().max(100).nullable().optional(),
    propertyType: z.enum(PROPERTY_TYPES).optional(),
    /** Archiving goes through POST /properties/:id/archive so it is audited as a distinct action. */
    status: z.enum(['active', 'inactive', 'onboarding']).optional(),
    portfolioId: idSchema.nullable().optional(),
    subaccountId: idSchema.nullable().optional(),
    ownerUserId: idSchema.nullable().optional(),
  })
  .openapi('UpdateProperty');

export const propertyQuery = paginationQuery.extend({
  status: z.enum(PROPERTY_STATUSES).optional(),
  city: z.string().trim().max(100).optional(),
  state: stateSchema.optional(),
  portfolioId: idSchema.optional(),
  subaccountId: idSchema.optional(),
  /** Case-insensitive contains on name, address line 1 and city. */
  q: z.string().trim().max(100).optional(),
  /** Archived properties are hidden unless requested explicitly via status=archived or includeArchived=true. */
  includeArchived: z.coerce.boolean().optional(),
});

// ---- Units ----
export const unit = z
  .object({
    id: idSchema, propertyId: idSchema, buildingId: idSchema.nullable(), unitNumber: z.string(), bedrooms: z.number().int().nullable(), bathrooms: z.number().nullable(), squareFeet: z.number().int().nullable(),
    status: z.enum(UNIT_STATUSES), targetRentCents: z.number().int(), availableFrom: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
    /** Statuses reachable from the current one (for UI affordances); the API still enforces. */
    nextStatuses: z.array(z.enum(UNIT_STATUSES)).optional(),
  })
  .openapi('Unit');
export const unitPage = pageOf(unit, 'Unit');
export const createUnit = z
  .object({
    unitNumber: z.string().trim().min(1).max(20),
    buildingId: idSchema.optional(),
    bedrooms: z.number().int().min(0).max(50).optional(),
    bathrooms: z.number().min(0).max(50).multipleOf(0.5).optional(),
    squareFeet: z.number().int().min(0).max(1_000_000).optional(),
    targetRentCents: centsSchema.default(0),
    availableFrom: isoDateSchema.optional(),
    /** Initial status; defaults to vacant. */
    status: z.enum(UNIT_STATUSES).default('vacant'),
  })
  .openapi('CreateUnit');
export const updateUnit = z
  .object({
    unitNumber: z.string().trim().min(1).max(20).optional(),
    buildingId: idSchema.nullable().optional(),
    bedrooms: z.number().int().min(0).max(50).nullable().optional(),
    bathrooms: z.number().min(0).max(50).multipleOf(0.5).nullable().optional(),
    squareFeet: z.number().int().min(0).max(1_000_000).nullable().optional(),
    targetRentCents: centsSchema.optional(),
    availableFrom: isoDateSchema.nullable().optional(),
  })
  .openapi('UpdateUnit');
export const unitQuery = paginationQuery.extend({ status: z.enum(UNIT_STATUSES).optional(), buildingId: idSchema.optional(), q: z.string().trim().max(20).optional() });
export const unitStatusChange = z
  .object({ toStatus: z.enum(UNIT_STATUSES), reason: z.string().trim().min(3).max(500), availableFrom: isoDateSchema.optional() })
  .openapi('UnitStatusChange');
export const unitStatusHistory = z
  .object({ id: idSchema, unitId: idSchema, fromStatus: z.enum(UNIT_STATUSES).nullable(), toStatus: z.enum(UNIT_STATUSES), changedBy: idSchema, reason: z.string().nullable(), changedAt: z.string() })
  .openapi('UnitStatusHistory');
export const unitStatusHistoryPage = pageOf(unitStatusHistory, 'UnitStatusHistory');

// ---- Hierarchy (Day 19) ----
export const propertyHierarchy = z
  .object({
    portfolio: z.object({ id: idSchema, name: z.string() }).nullable(),
    property,
    buildings: z.array(building.extend({ units: z.array(unit) })),
    /** Units not assigned to any building. */
    unassignedUnits: z.array(unit),
    unitCounts,
    /** True when the unit set exceeded the hierarchy cap; use GET /properties/:id/units with cursors instead. */
    truncated: z.boolean(),
  })
  .openapi('PropertyHierarchy');

export type PortfolioDto = z.infer<typeof portfolio>;
export type PropertyDto = z.infer<typeof property>;
export type PropertyDetailDto = z.infer<typeof propertyDetail>;
export type BuildingDto = z.infer<typeof building>;
export type UnitDto = z.infer<typeof unit>;
export type UnitStatusHistoryDto = z.infer<typeof unitStatusHistory>;
export type PropertyHierarchyDto = z.infer<typeof propertyHierarchy>;
export type UnitCountsDto = z.infer<typeof unitCounts>;
