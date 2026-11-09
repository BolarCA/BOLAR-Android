// lease contracts (blueprint Days 22-24): draft model, versions, parties, charges, lifecycle transitions.
import { z } from './openapi-zod.js';
import { centsSchema, idSchema, isoDateSchema, pageOf, paginationQuery } from './common.js';

export const LEASE_STATES = ['draft', 'review', 'approved', 'sent', 'signed', 'active', 'renewal', 'terminated', 'canceled'] as const;
export type LeaseState = (typeof LEASE_STATES)[number];
/** States that occupy a unit for overlap purposes (Day 22 "no active lease overlap"). */
export const LEASE_OCCUPYING_STATES: readonly LeaseState[] = ['approved', 'sent', 'signed', 'active', 'renewal'];
export const LEASE_PARTY_ROLES = ['primary', 'co_tenant', 'guarantor', 'occupant', 'corporate_sponsor'] as const;
export const CHARGE_TYPES = ['rent', 'parking', 'pet', 'utility', 'storage', 'fee'] as const;
export const CHARGE_CADENCES = ['monthly', 'weekly', 'one_time'] as const;

const termsJsonSchema = z.record(z.string().min(1).max(80), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).openapi('LeaseTerms');

export const leaseParty = z
  .object({ id: idSchema, leaseId: idSchema, tenantProfileId: idSchema, role: z.enum(LEASE_PARTY_ROLES), signedAt: z.string().nullable(), displayName: z.string(), kind: z.string(), userId: idSchema.nullable() })
  .openapi('LeaseParty');
export const addLeaseParty = z.object({ tenantProfileId: idSchema, role: z.enum(LEASE_PARTY_ROLES).default('co_tenant') }).openapi('AddLeaseParty');

export const recurringCharge = z
  .object({ id: idSchema, leaseId: idSchema, type: z.enum(CHARGE_TYPES), amountCents: z.number().int(), cadence: z.enum(CHARGE_CADENCES), startsOn: z.string().nullable(), endsOn: z.string().nullable(), accountCode: z.string().nullable() })
  .openapi('RecurringCharge');
export const addRecurringCharge = z
  .object({ type: z.enum(CHARGE_TYPES), amountCents: centsSchema, cadence: z.enum(CHARGE_CADENCES).default('monthly'), startsOn: isoDateSchema.optional(), endsOn: isoDateSchema.optional(), accountCode: z.string().max(16).optional() })
  .openapi('AddRecurringCharge');

export const leaseVersion = z
  .object({ id: idSchema, leaseId: idSchema, version: z.number().int(), termsJson: z.record(z.string(), z.unknown()), documentId: idSchema.nullable(), createdBy: idSchema, createdAt: z.string() })
  .openapi('LeaseVersion');
export const createLeaseVersion = z.object({ termsJson: termsJsonSchema, documentId: idSchema.optional() }).openapi('CreateLeaseVersion');

const leaseBase = z.object({
  id: idSchema,
  propertyId: idSchema,
  unitId: idSchema,
  status: z.enum(LEASE_STATES),
  startDate: z.string(),
  endDate: z.string(),
  rentCents: z.number().int(),
  depositCents: z.number().int(),
  currentVersionId: idSchema.nullable(),
  templateKey: z.string().nullable(),
  createdBy: idSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  unit: z.object({ id: idSchema, unitNumber: z.string(), status: z.string() }),
  property: z.object({ id: idSchema, name: z.string(), city: z.string(), state: z.string() }),
  parties: z.array(leaseParty),
});
export const lease = leaseBase.openapi('Lease');
export const leasePage = pageOf(lease, 'Lease');

/** One allowed-or-blocked next state for the current actor (feeds the lifecycle rail and blocked banner). */
export const leaseTransitionOption = z.object({ to: z.enum(LEASE_STATES), allowed: z.boolean(), reason: z.string().nullable() }).openapi('LeaseTransitionOption');

export const leaseDetail = leaseBase
  .extend({
    charges: z.array(recurringCharge),
    versions: z.array(leaseVersion),
    currentVersion: leaseVersion.nullable(),
    transitions: z.array(leaseTransitionOption),
    /** Convenience: states the actor can move to right now. */
    allowedNextStates: z.array(z.enum(LEASE_STATES)),
    /** Overlapping occupying leases on the same unit (blocked state). */
    overlaps: z.array(z.object({ id: idSchema, status: z.enum(LEASE_STATES), startDate: z.string(), endDate: z.string() })),
  })
  .openapi('LeaseDetail');

export const createLease = z
  .object({
    propertyId: idSchema,
    unitId: idSchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    rentCents: centsSchema.refine((v) => v > 0, 'Rent must be greater than zero'),
    depositCents: centsSchema.default(0),
    templateKey: z.string().max(80).optional(),
    /** Primary tenant; added as the `primary` party. */
    tenantProfileId: idSchema.optional(),
    /** Initial terms; stored as version 1. */
    termsJson: termsJsonSchema.optional(),
  })
  .openapi('CreateLease');

export const updateLease = z
  .object({ startDate: isoDateSchema.optional(), endDate: isoDateSchema.optional(), rentCents: centsSchema.refine((v) => v > 0, 'Rent must be greater than zero').optional(), depositCents: centsSchema.optional(), templateKey: z.string().max(80).nullable().optional() })
  .openapi('UpdateLease');

export const transitionLease = z
  .object({
    to: z.enum(LEASE_STATES),
    /** Required when rejecting (review -> draft) or terminating. Shown as the counsel review note. */
    note: z.string().trim().max(2000).optional(),
    /** Wet-signature artifact for sent -> signed without an e-sign envelope. */
    signedAt: isoDateSchema.optional(),
    /** Explicit activation more than 30 days before the start date. */
    activate: z.boolean().optional(),
  })
  .openapi('TransitionLease');

export const leaseQuery = paginationQuery.extend({ status: z.enum(LEASE_STATES).optional(), propertyId: idSchema.optional(), unitId: idSchema.optional(), tenantProfileId: idSchema.optional() });

/** Pickers for the create drawer: properties -> units the actor may draft leases for. */
export const leaseFormOptions = z
  .object({ properties: z.array(z.object({ id: idSchema, name: z.string(), units: z.array(z.object({ id: idSchema, unitNumber: z.string(), status: z.string(), targetRentCents: z.number().int() })) })) })
  .openapi('LeaseFormOptions');

export type LeaseDto = z.infer<typeof lease>;
export type LeaseDetailDto = z.infer<typeof leaseDetail>;
export type LeasePartyDto = z.infer<typeof leaseParty>;
export type RecurringChargeDto = z.infer<typeof recurringCharge>;
export type LeaseVersionDto = z.infer<typeof leaseVersion>;
export type LeaseTransitionOptionDto = z.infer<typeof leaseTransitionOption>;
export type CreateLeaseDto = z.infer<typeof createLease>;
export type TransitionLeaseDto = z.infer<typeof transitionLease>;
export type LeaseFormOptionsDto = z.infer<typeof leaseFormOptions>;
