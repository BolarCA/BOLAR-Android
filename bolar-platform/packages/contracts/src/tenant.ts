import { z } from './openapi-zod.js';
import { idSchema, pageOf } from './common.js';

export const tenantOrg = z
  .object({ id: idSchema, slug: z.string(), name: z.string(), plan: z.string(), status: z.string(), createdAt: z.string() })
  .openapi('TenantOrg');
export const tenantOrgPage = pageOf(tenantOrg, 'TenantOrg');
export const createTenantOrg = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
    name: z.string().min(2).max(120),
    plan: z.enum(['pilot', 'standard', 'enterprise']).default('pilot'),
    adminEmail: z.string().email(),
    adminName: z.string().min(1).max(120),
  })
  .openapi('CreateTenantOrg');
export const updateTenantOrg = z.object({ name: z.string().min(2).max(120).optional(), plan: z.enum(['pilot', 'standard', 'enterprise']).optional(), status: z.enum(['active', 'suspended']).optional() }).openapi('UpdateTenantOrg');

export const businessAccount = z.object({ id: idSchema, tenantOrgId: idSchema, name: z.string(), kind: z.string(), status: z.string(), createdAt: z.string() }).openapi('BusinessAccount');
export const createBusinessAccount = z.object({ name: z.string().min(1).max(120), kind: z.enum(['property_management', 'landlord', 'corporate_tenant']).default('property_management') }).openapi('CreateBusinessAccount');

export const subaccount = z.object({ id: idSchema, tenantOrgId: idSchema, businessAccountId: idSchema, name: z.string(), status: z.string(), createdAt: z.string() }).openapi('Subaccount');
export const subaccountPage = pageOf(subaccount, 'Subaccount');
export const createSubaccount = z.object({ businessAccountId: idSchema, name: z.string().min(1).max(120) }).openapi('CreateSubaccount');
export const updateSubaccount = z.object({ name: z.string().min(1).max(120).optional(), status: z.enum(['active', 'suspended', 'archived']).optional() }).openapi('UpdateSubaccount');
