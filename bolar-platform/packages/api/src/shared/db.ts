import { prisma, forTenant, type TenantPrisma } from '@bolar/db';
import { errors, type RequestContext } from '@bolar/shared';
import { config } from '../config.js';

export { prisma };

/**
 * Tenant-scoped client for the request. Throws if no tenant context (defense in depth).
 * With DB_RLS_ENFORCE=1 (ADR 0005) reads additionally run under PostgreSQL row-level security.
 */
export function tenantDb(ctx: RequestContext): TenantPrisma {
  if (!ctx.tenantOrgId) throw errors.forbidden('Tenant context required');
  return forTenant(prisma, ctx.tenantOrgId, { rls: config().DB_RLS_ENFORCE === '1' });
}
