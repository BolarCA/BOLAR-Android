// tenant-profile contracts (blueprint Day 21): CRUD with sensitive field classification.
import { z } from './openapi-zod.js';
import { emailSchema, idSchema, isoDateSchema, pageOf, paginationQuery } from './common.js';

export const TENANT_PROFILE_STATUSES = ['prospect', 'applicant', 'active', 'former', 'blocked'] as const;
export const TENANT_PROFILE_KINDS = ['individual', 'corporate', 'occupant'] as const;
export const CONTACT_KINDS = ['email', 'phone', 'mail'] as const;
export const OCCUPANT_RELATIONSHIPS = ['spouse', 'child', 'roommate', 'employee', 'other'] as const;

/**
 * Field classification for TenantProfile (blueprint p14/p17). Lists are redacted to the viewer's
 * cleared classification; detail nulls restricted fields unless the sensitive gate passes.
 */
export const TENANT_PROFILE_FIELD_CLASSIFICATION = {
  dateOfBirth: 'restricted',
  ssnLast4: 'restricted',
  email: 'confidential',
  phone: 'confidential',
} as const;

const phoneSchema = z.string().trim().min(7).max(32);

export const contactMethod = z
  .object({ id: idSchema, tenantProfileId: idSchema, kind: z.enum(CONTACT_KINDS), value: z.string().nullable(), isPrimary: z.boolean(), verifiedAt: z.string().nullable(), redactedFields: z.array(z.string()) })
  .openapi('ContactMethod');
export const createContactMethod = z.object({ kind: z.enum(CONTACT_KINDS), value: z.string().trim().min(3).max(254), isPrimary: z.boolean().default(false) }).openapi('CreateContactMethod');

export const emergencyContact = z
  .object({ id: idSchema, tenantProfileId: idSchema, name: z.string().nullable(), relationship: z.string(), phone: z.string().nullable(), redactedFields: z.array(z.string()) })
  .openapi('EmergencyContact');
export const createEmergencyContact = z.object({ name: z.string().trim().min(1).max(120), relationship: z.string().trim().min(1).max(60), phone: phoneSchema }).openapi('CreateEmergencyContact');

export const occupant = z
  .object({ id: idSchema, tenantProfileId: idSchema, name: z.string(), relationship: z.enum(OCCUPANT_RELATIONSHIPS), isMinor: z.boolean(), createdAt: z.string() })
  .openapi('Occupant');
export const createOccupant = z.object({ name: z.string().trim().min(1).max(120), relationship: z.enum(OCCUPANT_RELATIONSHIPS), isMinor: z.boolean().default(false) }).openapi('CreateOccupant');

export const tenantProfile = z
  .object({
    id: idSchema,
    userId: idSchema.nullable(),
    displayName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    dateOfBirth: z.string().nullable(),
    ssnLast4: z.string().nullable(),
    classification: z.string(),
    kind: z.enum(TENANT_PROFILE_KINDS),
    businessAccountId: idSchema.nullable(),
    status: z.enum(TENANT_PROFILE_STATUSES),
    notes: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    /** Fields nulled because the viewer has not cleared their classification. */
    redactedFields: z.array(z.string()),
    /** Highest classification the viewer cleared for this record. */
    clearedClassification: z.enum(['public', 'internal', 'confidential', 'restricted']),
  })
  .openapi('TenantProfile');
export const tenantProfilePage = pageOf(tenantProfile, 'TenantProfile');

export const tenantProfileDetail = tenantProfile
  .extend({ contacts: z.array(contactMethod), emergencyContacts: z.array(emergencyContact), occupants: z.array(occupant), activeLeaseCount: z.number().int() })
  .openapi('TenantProfileDetail');

/** Full sensitive view; only returned when the sensitive access gate passes. */
export const tenantProfileSensitive = z
  .object({ id: idSchema, email: z.string().nullable(), phone: z.string().nullable(), dateOfBirth: z.string().nullable(), ssnLast4: z.string().nullable(), emergencyContacts: z.array(emergencyContact), classification: z.string() })
  .openapi('TenantProfileSensitive');

export const createTenantProfile = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    dateOfBirth: isoDateSchema.optional(),
    ssnLast4: z.string().regex(/^\d{4}$/, 'Last four digits only').optional(),
    kind: z.enum(TENANT_PROFILE_KINDS).default('individual'),
    status: z.enum(TENANT_PROFILE_STATUSES).default('prospect'),
    businessAccountId: idSchema.optional(),
    userId: idSchema.optional(),
    notes: z.string().max(4000).optional(),
  })
  .openapi('CreateTenantProfile');

export const updateTenantProfile = createTenantProfile
  .omit({ kind: true, status: true })
  .partial()
  .extend({ kind: z.enum(TENANT_PROFILE_KINDS).optional(), status: z.enum(TENANT_PROFILE_STATUSES).optional(), email: emailSchema.nullable().optional(), phone: phoneSchema.nullable().optional(), dateOfBirth: isoDateSchema.nullable().optional(), ssnLast4: z.string().regex(/^\d{4}$/).nullable().optional(), notes: z.string().max(4000).nullable().optional() })
  .openapi('UpdateTenantProfile');

export const tenantProfileQuery = paginationQuery.extend({ status: z.enum(TENANT_PROFILE_STATUSES).optional(), kind: z.enum(TENANT_PROFILE_KINDS).optional(), q: z.string().trim().max(100).optional() });

export const subResourceParams = z.object({ id: idSchema, subId: idSchema });

export type TenantProfileDto = z.infer<typeof tenantProfile>;
export type TenantProfileDetailDto = z.infer<typeof tenantProfileDetail>;
export type TenantProfileSensitiveDto = z.infer<typeof tenantProfileSensitive>;
export type CreateTenantProfileDto = z.infer<typeof createTenantProfile>;
export type ContactMethodDto = z.infer<typeof contactMethod>;
export type EmergencyContactDto = z.infer<typeof emergencyContact>;
export type OccupantDto = z.infer<typeof occupant>;
