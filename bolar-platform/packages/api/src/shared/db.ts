import { prisma, forTenant, type TenantPrisma } from '@bolar/db';
import { errors, type RequestContext } from '@bolar/shared';

export { prisma };

/** Tenant-scoped client for the request. Throws if no tenant context (defense in depth). */
export function tenantDb(ctx: RequestContext): TenantPrisma {
  if (!ctx.tenantOrgId) throw errors.forbidden('Tenant context required');
  return forTenant(prisma, ctx.tenantOrgId);
}
