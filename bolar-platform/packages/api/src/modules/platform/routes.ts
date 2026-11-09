import { Router } from 'express';
import {
  z, idParams, healthSummary, featureFlag, featureFlagPage, createFeatureFlag, updateFeatureFlag, featureFlagQuery,
  supportSession, supportSessionPage, createSupportSession, supportSessionQuery, platformAuditQuery, auditPage,
} from '@bolar/contracts';
import { errors, toPage, decodeCursor, type RequestContext } from '@bolar/shared';
import { defineRoute, mount, toDto } from '../../shared/route.js';
import { prisma } from '../../shared/db.js';
import { audit } from '../../shared/audit.js';
import { publish } from '../../shared/events.js';
import { config } from '../../config.js';

/**
 * Platform control plane (blueprint p37, Day 51). Cross-tenant by design, so it uses the root prisma client and
 * every read/write is gated by platform permissions and audited. Tenant actors never reach these routes except
 * for org-scoped feature flags, which are restricted to their own org.
 */

const isPlatformAdmin = (ctx: RequestContext) => ctx.permissions.has('platform:admin');

async function resolveOrg(idOrSlug: string): Promise<{ id: string; slug: string; name: string } | null> {
  return prisma.tenantOrg.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] }, select: { id: true, slug: true, name: true } });
}

/** Support sessions are a platform-staff tool: the request context only honours them for `isPlatform` users. */
async function requirePlatformActor(ctx: RequestContext, action: string): Promise<void> {
  if (ctx.actor?.isPlatform) return;
  await audit(ctx, { action: 'access.denied', resourceType: 'support_session', outcome: 'deny', metadata: { permission: 'support_session:start', reason: `${action} requires a platform staff account` } });
  throw errors.forbidden('Support sessions are available to platform staff only');
}

/** Non-platform actors may only touch flags of their own org (never global ones). */
function flagOrgScope(ctx: RequestContext, requested: string | null | undefined): string | null {
  if (isPlatformAdmin(ctx)) return requested ?? null;
  if (requested && requested !== ctx.tenantOrgId) throw errors.forbidden('Feature flags of another organization are not accessible');
  return ctx.tenantOrgId;
}

async function withOrgSlugs<T extends { tenantOrgId: string | null }>(rows: T[]): Promise<(T & { orgSlug: string | null })[]> {
  const ids = [...new Set(rows.map((r) => r.tenantOrgId).filter((v): v is string => Boolean(v)))];
  const orgs = ids.length ? await prisma.tenantOrg.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true } }) : [];
  const slugs = new Map(orgs.map((o) => [o.id, o.slug]));
  return rows.map((r) => ({ ...r, orgSlug: r.tenantOrgId ? (slugs.get(r.tenantOrgId) ?? null) : null }));
}

async function serializeSupportSessions(rows: { id: string; tenantOrgId: string; agentUserId: string; reason: string; approvedBy: string | null; startedAt: Date; endsAt: Date; endedAt: Date | null }[]) {
  const now = Date.now();
  const orgIds = [...new Set(rows.map((r) => r.tenantOrgId))];
  const agentIds = [...new Set(rows.map((r) => r.agentUserId))];
  const [orgs, agents] = await Promise.all([
    orgIds.length ? prisma.tenantOrg.findMany({ where: { id: { in: orgIds } }, select: { id: true, slug: true, name: true } }) : [],
    agentIds.length ? prisma.userProfile.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, email: true } }) : [],
  ]);
  const orgMap = new Map(orgs.map((o) => [o.id, o]));
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  return rows.map((r) => ({ ...toDto(r), active: !r.endedAt && r.endsAt.getTime() > now, org: orgMap.get(r.tenantOrgId) ?? null, agent: agentMap.get(r.agentUserId) ?? null }));
}

export const platformRoutes = [
  // ---- Health summary (platform admin): dependency checks plus control-plane counts ----
  defineRoute({ method: 'get', path: '/platform/health-summary', operationId: 'getPlatformHealthSummary', summary: 'Dependency health plus org, user, session and support-session counts', tags: ['platform'], auth: 'session', permission: 'platform:admin',
    responses: { 200: healthSummary },
    handler: async ({ ctx }) => {
      const checks: Record<string, 'ok' | 'fail'> = {};
      try { await prisma.$queryRaw`SELECT 1`; checks.database = 'ok'; } catch { checks.database = 'fail'; }
      const now = new Date();
      const [orgs, activeOrgs, users, activeSessions, activeSupportSessions] = await Promise.all([
        prisma.tenantOrg.count(),
        prisma.tenantOrg.count({ where: { status: 'active' } }),
        prisma.userProfile.count({ where: { status: 'active' } }),
        prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
        prisma.supportSession.count({ where: { endedAt: null, endsAt: { gt: now } } }),
      ]);
      const status = Object.values(checks).every((c) => c === 'ok') ? 'ok' : 'degraded';
      return { body: { status, checks, counts: { orgs, activeOrgs, users, activeSessions, activeSupportSessions }, queueDriver: config().QUEUE_DRIVER, version: process.env.npm_package_version ?? '0.1.0', generatedAt: now.toISOString(), requestId: ctx.requestId } };
    } }),

  // ---- Feature flags (feature_flag:write). Global when tenantOrgId is null. ----
  defineRoute({ method: 'get', path: '/feature-flags', operationId: 'listFeatureFlags', summary: 'List feature flags (global and per-org)', tags: ['platform'], auth: 'session', permission: 'feature_flag:write',
    request: { query: featureFlagQuery }, responses: { 200: featureFlagPage },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      const where: Record<string, unknown> = {};
      if (!isPlatformAdmin(ctx)) where.tenantOrgId = ctx.tenantOrgId;
      else if (query.tenantOrgId) where.tenantOrgId = query.tenantOrgId;
      else if (query.scope === 'global') where.tenantOrgId = null;
      else if (query.scope === 'org') where.tenantOrgId = { not: null };
      if (query.key) where.key = { contains: query.key, mode: 'insensitive' };
      const rows = await prisma.featureFlag.findMany({ where, take: query.limit + 1, orderBy: { id: 'asc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}) });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: toDto(await withOrgSlugs(page.items)) } };
    } }),
  defineRoute({ method: 'post', path: '/feature-flags', operationId: 'createFeatureFlag', summary: 'Create a global or org-scoped feature flag', tags: ['platform'], auth: 'mfa', permission: 'feature_flag:write',
    request: { body: createFeatureFlag }, responses: { 201: featureFlag },
    handler: async ({ body, ctx }) => {
      const tenantOrgId = flagOrgScope(ctx, body.tenantOrgId);
      if (tenantOrgId && !(await prisma.tenantOrg.findUnique({ where: { id: tenantOrgId }, select: { id: true } }))) throw errors.validation([{ path: 'body.tenantOrgId', message: 'Unknown organization' }]);
      // Postgres treats NULLs as distinct in the unique index, so the global case needs an explicit check.
      const dup = await prisma.featureFlag.findFirst({ where: { tenantOrgId, key: body.key }, select: { id: true } });
      if (dup) throw errors.conflict(`Flag ${body.key} already exists in this scope`);
      const row = await prisma.featureFlag.create({ data: { tenantOrgId, key: body.key, enabled: body.enabled, rules: body.rules as never, updatedBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'feature_flag.create', resourceType: 'feature_flag', resourceId: row.id, tenantOrgId, after: toDto(row) });
      await publish(ctx, 'feature_flag.changed', { flagId: row.id, key: row.key, tenantOrgId, enabled: row.enabled });
      return { status: 201, body: toDto((await withOrgSlugs([row]))[0]) };
    } }),
  defineRoute({ method: 'patch', path: '/feature-flags/:id', operationId: 'updateFeatureFlag', summary: 'Toggle or re-rule a feature flag', tags: ['platform'], auth: 'mfa', permission: 'feature_flag:write',
    request: { params: idParams, body: updateFeatureFlag }, responses: { 200: featureFlag },
    handler: async ({ params, body, ctx }) => {
      const before = await prisma.featureFlag.findUnique({ where: { id: params.id } });
      if (!before || (!isPlatformAdmin(ctx) && before.tenantOrgId !== ctx.tenantOrgId)) {
        await audit(ctx, { action: 'access.denied', resourceType: 'feature_flag', resourceId: params.id, outcome: 'deny', metadata: { permission: 'feature_flag:write', reason: before ? 'flag belongs to another org' : 'unknown flag' } });
        throw errors.notFound();
      }
      const row = await prisma.featureFlag.update({ where: { id: params.id }, data: { ...(body.enabled === undefined ? {} : { enabled: body.enabled }), ...(body.rules === undefined ? {} : { rules: body.rules as never }), updatedBy: ctx.actor!.userId } });
      await audit(ctx, { action: 'feature_flag.update', resourceType: 'feature_flag', resourceId: row.id, tenantOrgId: row.tenantOrgId, before: toDto(before), after: toDto(row) });
      await publish(ctx, 'feature_flag.changed', { flagId: row.id, key: row.key, tenantOrgId: row.tenantOrgId, enabled: row.enabled });
      return { body: toDto((await withOrgSlugs([row]))[0]) };
    } }),

  // ---- Support sessions (support_session:start): time-boxed, audited cross-tenant access ----
  defineRoute({ method: 'get', path: '/support-sessions', operationId: 'listSupportSessions', summary: 'List support sessions (platform admins see all, agents see their own)', tags: ['platform'], auth: 'session', permission: 'support_session:start',
    request: { query: supportSessionQuery }, responses: { 200: supportSessionPage },
    handler: async ({ query, ctx }) => {
      await requirePlatformActor(ctx, 'listing support sessions');
      const c = decodeCursor<{ id: string }>(query.cursor);
      const now = new Date();
      const rows = await prisma.supportSession.findMany({
        where: {
          ...(isPlatformAdmin(ctx) ? {} : { agentUserId: ctx.actor!.userId }),
          ...(query.tenantOrgId ? { tenantOrgId: query.tenantOrgId } : {}),
          ...(query.active === 'true' ? { endedAt: null, endsAt: { gt: now } } : query.active === 'false' ? { OR: [{ endedAt: { not: null } }, { endsAt: { lte: now } }] } : {}),
        },
        take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const page = toPage(rows, query.limit);
      return { body: { ...page, items: await serializeSupportSessions(page.items) } };
    } }),
  defineRoute({ method: 'post', path: '/support-sessions', operationId: 'startSupportSession', summary: 'Start a time-boxed support session for a target org (reason required, audited in both orgs)', tags: ['platform'], auth: 'mfa', permission: 'support_session:start',
    request: { body: createSupportSession }, responses: { 201: supportSession },
    handler: async ({ body, ctx }) => {
      await requirePlatformActor(ctx, 'starting a support session');
      const org = await resolveOrg(body.tenantOrgId);
      if (!org) throw errors.validation([{ path: 'body.tenantOrgId', message: 'Unknown organization' }]);
      const now = new Date();
      const existing = await prisma.supportSession.findFirst({ where: { tenantOrgId: org.id, agentUserId: ctx.actor!.userId, endedAt: null, endsAt: { gt: now } }, select: { id: true } });
      if (existing) throw errors.conflict('You already have an active support session for this organization');
      const row = await prisma.supportSession.create({ data: { tenantOrgId: org.id, agentUserId: ctx.actor!.userId, reason: body.reason, approvedBy: isPlatformAdmin(ctx) ? ctx.actor!.userId : null, startedAt: now, endsAt: new Date(now.getTime() + body.durationMinutes * 60_000) } });
      const meta = { reason: body.reason, durationMinutes: body.durationMinutes, targetOrgId: org.id, targetOrgSlug: org.slug, agentUserId: ctx.actor!.userId };
      // Visible in the supported org's audit log and in the platform log.
      await audit(ctx, { action: 'support.session_started', resourceType: 'support_session', resourceId: row.id, tenantOrgId: org.id, metadata: meta });
      if (ctx.tenantOrgId !== org.id) await audit(ctx, { action: 'support.session_started', resourceType: 'support_session', resourceId: row.id, metadata: meta });
      await publish({ ...ctx, tenantOrgId: org.id }, 'support.session_started', { supportSessionId: row.id, ...meta, endsAt: row.endsAt.toISOString() });
      return { status: 201, body: (await serializeSupportSessions([row]))[0] };
    } }),
  defineRoute({ method: 'post', path: '/support-sessions/:id/end', operationId: 'endSupportSession', summary: 'End a support session early (the agent or a platform admin)', tags: ['platform'], auth: 'mfa', permission: 'support_session:start',
    request: { params: idParams }, responses: { 200: supportSession },
    handler: async ({ params, ctx }) => {
      await requirePlatformActor(ctx, 'ending a support session');
      const row = await prisma.supportSession.findUnique({ where: { id: params.id } });
      if (!row || (!isPlatformAdmin(ctx) && row.agentUserId !== ctx.actor!.userId)) {
        await audit(ctx, { action: 'access.denied', resourceType: 'support_session', resourceId: params.id, outcome: 'deny', metadata: { permission: 'support_session:start', reason: row ? 'not the session agent' : 'unknown session' } });
        throw errors.notFound();
      }
      if (row.endedAt) throw errors.invalidTransition('ended', 'ended');
      const ended = await prisma.supportSession.update({ where: { id: row.id }, data: { endedAt: new Date() } });
      const meta = { targetOrgId: row.tenantOrgId, agentUserId: row.agentUserId, endedBy: ctx.actor!.userId, early: ended.endedAt!.getTime() < row.endsAt.getTime() };
      await audit(ctx, { action: 'support.session_ended', resourceType: 'support_session', resourceId: row.id, tenantOrgId: row.tenantOrgId, metadata: meta });
      if (ctx.tenantOrgId !== row.tenantOrgId) await audit(ctx, { action: 'support.session_ended', resourceType: 'support_session', resourceId: row.id, metadata: meta });
      await publish({ ...ctx, tenantOrgId: row.tenantOrgId }, 'support.session_ended', { supportSessionId: row.id, ...meta });
      return { status: 200, body: (await serializeSupportSessions([ended]))[0] };
    } }),

  // ---- Platform-wide audit query (platform:admin + MFA) ----
  defineRoute({ method: 'get', path: '/platform/audit', operationId: 'listPlatformAuditLogs', summary: 'Query the audit log across all organizations, optionally filtered to one org', tags: ['platform'], auth: 'mfa', permission: 'platform:admin',
    request: { query: platformAuditQuery }, responses: { 200: auditPage.extend({ items: z.array(auditPage.shape.items.element.extend({ tenantOrgId: z.string().nullable() })) }) },
    handler: async ({ query, ctx }) => {
      const c = decodeCursor<{ id: string }>(query.cursor);
      let orgFilter: Record<string, unknown> = {};
      if (query.tenantOrgId) {
        const org = await resolveOrg(query.tenantOrgId);
        if (!org) throw errors.validation([{ path: 'query.tenantOrgId', message: 'Unknown organization' }]);
        orgFilter = { tenantOrgId: org.id };
      }
      const rows = await prisma.auditLog.findMany({
        where: {
          ...orgFilter,
          ...(query.actorId ? { actorId: query.actorId } : {}),
          ...(query.action ? { action: { startsWith: query.action } } : {}),
          ...(query.resourceType ? { resourceType: query.resourceType } : {}),
          ...(query.resourceId ? { resourceId: query.resourceId } : {}),
          ...(query.outcome ? { outcome: query.outcome } : {}),
          ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
        },
        take: query.limit + 1, orderBy: { id: 'desc' }, ...(c ? { cursor: { id: c.id }, skip: 1 } : {}),
      });
      const full = ctx.permissions.has('audit:read_sensitive');
      const page = toPage(rows, query.limit);
      await audit(ctx, { action: 'audit.platform_query', resourceType: 'audit_log', metadata: { filters: { ...query, cursor: undefined }, full } });
      return { body: { ...page, items: page.items.map((r) => toDto(full ? r : { ...r, before: null, after: null, ip: null })) } };
    } }),
];

export const platformRouter: Router = Router();
mount(platformRouter, platformRoutes);
