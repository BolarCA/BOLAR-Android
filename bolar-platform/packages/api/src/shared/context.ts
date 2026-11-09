import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ACCESS_PURPOSES, errors, isRole, permissionsForRoles, type AccessPurpose, type Permission, type RequestContext, type ScopedRole } from '@bolar/shared';
import { prisma } from './db.js';
import { verifyAccessToken } from './tokens.js';
import { audit } from './audit.js';
import { config } from '../config.js';
import { meCache, meCacheKey, meCacheStats } from './cache.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx: RequestContext;
    }
  }
}

export function requestIdFor(req: Request): string {
  const hdr = req.header('x-request-id');
  return hdr && /^[A-Za-z0-9._-]{8,128}$/.test(hdr) ? hdr : randomUUID();
}

/**
 * Builds RequestContext for every request (Day 7/8): requestId, actor from bearer token,
 * tenant from token (platform actors may target another org via X-Tenant-Org with a support
 * session or platform_admin role), roles + permissions, declared purpose.
 */
export async function buildContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  const requestId = requestIdFor(req);
  res.setHeader('X-Request-Id', requestId);
  const ctx: RequestContext = {
    requestId,
    actor: null,
    tenantOrgId: null,
    roles: [],
    permissions: new Set(),
    purpose: null,
    clearedClassification: 'public',
    supportSessionId: null,
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
  req.ctx = ctx;
  const purpose = req.header('x-access-purpose');
  if (purpose && (ACCESS_PURPOSES as readonly string[]).includes(purpose)) ctx.purpose = purpose as AccessPurpose;

  const auth = req.header('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return next();

  try {
    const claims = await verifyAccessToken(token);
    if (!claims) return next(); // anonymous; routes decide
    const session = await prisma.session.findUnique({ where: { id: claims.sid }, select: { id: true, revokedAt: true, expiresAt: true, mfaVerified: true, userId: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== claims.sub) return next();
    const user = await prisma.userProfile.findUnique({ where: { id: claims.sub } });
    if (!user || user.status !== 'active') return next();

    ctx.actor = { userId: user.id, email: user.email, name: user.name, isPlatform: user.isPlatform, mfaVerified: session.mfaVerified || !user.mfaEnabled };
    ctx.tenantOrgId = claims.org;

    // Platform actors may act on another org with X-Tenant-Org (slug or id); audited.
    const targetHdr = req.header('x-tenant-org');
    if (targetHdr && targetHdr !== claims.org) {
      const target = await prisma.tenantOrg.findFirst({ where: { OR: [{ id: targetHdr }, { slug: targetHdr }] }, select: { id: true } });
      if (!target) throw errors.forbidden();
      if (!user.isPlatform) throw errors.forbidden();
      const support = await prisma.supportSession.findFirst({ where: { tenantOrgId: target.id, agentUserId: user.id, endedAt: null, endsAt: { gt: new Date() } }, select: { id: true } });
      const platformRoles = await prisma.roleAssignment.findMany({ where: { userId: user.id, scopeType: 'platform', revokedAt: null } });
      const isPlatformAdmin = platformRoles.some((r) => r.role === 'platform_admin');
      if (!support && !isPlatformAdmin) throw errors.forbidden();
      ctx.tenantOrgId = target.id;
      ctx.supportSessionId = support?.id ?? null;
      await audit(ctx, { action: 'support.cross_tenant_access', resourceType: 'tenant_org', resourceId: target.id, metadata: { via: support ? 'support_session' : 'platform_admin', path: req.path } });
    }

    const resolved = await resolveRoles(user.id, ctx.tenantOrgId!, session.id);
    ctx.roles = resolved.roles;
    ctx.permissions = resolved.permissions;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Roles + permissions for (user, org, session), cached for CACHE_ME_TTL_SECONDS (ADR 0006). The key carries the
 * tenantOrgId, so an X-Tenant-Org switch resolves against a different entry and can never reuse another org's roles.
 * IAM/auth/platform mutations call `invalidateUserCache`/`invalidateSessionCache` so grants and revocations apply
 * immediately rather than at TTL expiry.
 */
export async function resolveRoles(userId: string, tenantOrgId: string, sessionId: string): Promise<{ roles: ScopedRole[]; permissions: Set<Permission>; cached: boolean }> {
  const key = meCacheKey(userId, tenantOrgId, sessionId);
  const hit = meCache.get(key);
  if (hit) {
    meCacheStats.hits++;
    return { roles: hit.roles as ScopedRole[], permissions: new Set(hit.permissions as Permission[]), cached: true };
  }
  meCacheStats.misses++;
  const assignments = await prisma.roleAssignment.findMany({
    where: { userId, revokedAt: null, OR: [{ tenantOrgId }, { scopeType: 'platform' }] },
    take: 200,
  });
  const roles = assignments.filter((a) => isRole(a.role)).map((a) => ({ role: a.role, scopeType: a.scopeType, scopeId: a.scopeId }) as ScopedRole);
  const permissions = permissionsForRoles(roles.map((r) => r.role));
  meCache.set(key, { roles, permissions: [...permissions] }, config().CACHE_ME_TTL_SECONDS * 1000);
  return { roles, permissions, cached: false };
}

export function requireAuth(ctx: RequestContext, level: 'session' | 'mfa' = 'session'): void {
  if (!ctx.actor) throw errors.unauthenticated();
  if (level === 'mfa' && !ctx.actor.mfaVerified) throw errors.forbidden('Multi-factor verification required');
}
