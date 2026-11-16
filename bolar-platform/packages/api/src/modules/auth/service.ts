import { errors, type RequestContext } from '@bolar/shared';
import { verifyPassword, hashPassword } from '@bolar/db';
import { prisma } from '../../shared/db.js';
import { signAccessToken, newOpaqueToken, hashToken } from '../../shared/tokens.js';
import { config } from '../../config.js';
import { audit } from '../../shared/audit.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../shared/totp.js';
import { logger } from '../../logger.js';
import { invalidateSessionCache, invalidateUserCache } from '../../shared/cache.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const GENERIC = 'Invalid email, password, or organization';

export function isLocked(user: { lockedUntil: Date | null }, now = new Date()): boolean {
  return !!user.lockedUntil && user.lockedUntil > now;
}

/**
 * Count a failed password or MFA attempt. Attempts made while the account is already locked are ignored, so a
 * stream of bad attempts cannot keep extending the lock and deny the real user indefinitely.
 */
async function recordFailedAttempt(user: { id: string; failedLogins: number; lockedUntil: Date | null }): Promise<void> {
  if (isLocked(user)) return;
  const failed = user.failedLogins + 1;
  await prisma.userProfile.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
}

export interface IssuedTokens { accessToken: string; refreshToken: string; expiresIn: number; tokenType: 'Bearer'; mfaRequired: boolean }

async function issueTokens(user: { id: string; tenantOrgId: string; isPlatform: boolean; mfaEnabled: boolean }, ctx: RequestContext, mfaVerified: boolean, existingSessionId?: string): Promise<{ tokens: IssuedTokens; sessionId: string }> {
  const cfg = config();
  const refresh = newOpaqueToken();
  const expiresAt = new Date(Date.now() + cfg.AUTH_REFRESH_TTL_SECONDS * 1000);
  const session = existingSessionId
    ? await prisma.session.update({ where: { id: existingSessionId }, data: { refreshTokenHash: hashToken(refresh), expiresAt, lastUsedAt: new Date(), mfaVerified } })
    : await prisma.session.create({ data: { tenantOrgId: user.tenantOrgId, userId: user.id, refreshTokenHash: hashToken(refresh), expiresAt, ip: ctx.ip, userAgent: ctx.userAgent, mfaVerified } });
  const accessToken = await signAccessToken({ sub: user.id, org: user.tenantOrgId, sid: session.id, mfa: mfaVerified, plat: user.isPlatform });
  return { tokens: { accessToken, refreshToken: refresh, expiresIn: cfg.AUTH_ACCESS_TTL_SECONDS, tokenType: 'Bearer', mfaRequired: user.mfaEnabled && !mfaVerified }, sessionId: session.id };
}

/**
 * Login (Day 9). Safe errors: the same message for unknown email, wrong password, wrong org, or
 * locked account, so email existence is never leaked. Failed attempts are audited without the email.
 */
export async function login(ctx: RequestContext, input: { email: string; password: string; orgSlug?: string }) {
  const candidates = await prisma.userProfile.findMany({
    where: { email: input.email, status: 'active', ...(input.orgSlug ? { tenantOrg: { slug: input.orgSlug } } : {}) },
    include: { tenantOrg: { select: { id: true, slug: true, name: true, status: true } } },
    take: 10, // ambiguity check only needs "more than one"
  });
  if (candidates.length > 1) {
    // Ambiguous without org; do not reveal which orgs. Client should prompt for org slug.
    throw errors.validation([{ path: 'body.orgSlug', message: 'orgSlug is required for this account' }], GENERIC);
  }
  const user = candidates[0];
  const fail = async (reason: string) => {
    if (user) await recordFailedAttempt(user);
    await audit(ctx, { action: 'auth.login_failed', resourceType: 'session', outcome: 'deny', tenantOrgId: user?.tenantOrgId ?? null, metadata: { reason, userId: user?.id ?? null } });
    logger.info({ requestId: ctx.requestId, reason }, 'login failed');
    throw errors.unauthenticated(GENERIC);
  };
  if (!user || user.tenantOrg.status !== 'active') return fail(user ? 'org_inactive' : 'unknown_user');
  if (isLocked(user)) return fail('locked');
  if (!(await verifyPassword(input.password, user.passwordHash))) return fail('bad_password');

  await prisma.userProfile.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const { tokens, sessionId } = await issueTokens(user, { ...ctx, tenantOrgId: user.tenantOrgId }, !user.mfaEnabled);
  await audit({ ...ctx, actor: { userId: user.id, email: user.email, name: user.name, isPlatform: user.isPlatform, mfaVerified: !user.mfaEnabled }, tenantOrgId: user.tenantOrgId }, { action: 'auth.login', resourceType: 'session', resourceId: sessionId, metadata: { mfaRequired: tokens.mfaRequired } });
  return { ...tokens, user: { id: user.id, email: user.email, name: user.name }, org: { id: user.tenantOrg.id, slug: user.tenantOrg.slug, name: user.tenantOrg.name } };
}

/** Refresh rotates the refresh token (reuse of an old token revokes the session). */
export async function refresh(ctx: RequestContext, refreshToken: string) {
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hashToken(refreshToken) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.status !== 'active') {
    await audit(ctx, { action: 'auth.refresh_failed', resourceType: 'session', outcome: 'deny' });
    throw errors.unauthenticated('Session expired; please sign in again');
  }
  const { tokens } = await issueTokens(session.user, ctx, session.mfaVerified, session.id);
  return tokens;
}

export async function logout(ctx: RequestContext, refreshToken?: string) {
  if (refreshToken) {
    const target = await prisma.session.findUnique({ where: { refreshTokenHash: hashToken(refreshToken) }, select: { id: true } });
    await prisma.session.updateMany({ where: { refreshTokenHash: hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    if (target) invalidateSessionCache(target.id);
  } else if (ctx.actor) {
    await prisma.session.updateMany({ where: { userId: ctx.actor.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    invalidateUserCache(ctx.actor.userId);
  }
  if (ctx.actor) await audit(ctx, { action: 'auth.logout', resourceType: 'session' });
}

/**
 * Start (or restart) TOTP enrollment. Re-enrolling an account that already has MFA enabled replaces the authenticator,
 * so it is only allowed from a session that has itself passed MFA; a stolen pre-MFA token cannot swap the secret.
 */
export async function mfaSetup(ctx: RequestContext) {
  if (!ctx.actor) throw errors.unauthenticated();
  const user = await prisma.userProfile.findUniqueOrThrow({ where: { id: ctx.actor.userId }, select: { mfaEnabled: true } });
  if (user.mfaEnabled && !ctx.actor.mfaVerified) {
    await audit(ctx, { action: 'auth.mfa_setup_denied', resourceType: 'user', resourceId: ctx.actor.userId, outcome: 'deny', metadata: { reason: 'step_up_required' } });
    throw errors.forbidden('Multi-factor verification required before changing the authenticator');
  }
  const secret = generateTotpSecret();
  await prisma.userProfile.update({ where: { id: ctx.actor.userId }, data: { mfaSecret: secret } });
  await audit(ctx, { action: 'auth.mfa_setup', resourceType: 'user', resourceId: ctx.actor.userId, metadata: { reEnroll: user.mfaEnabled } });
  return { secret, otpauthUrl: otpauthUrl(secret, ctx.actor.email) };
}

/** Verifies a TOTP code; enables MFA on first success and marks the current session verified. */
export async function mfaVerify(ctx: RequestContext, sessionId: string, code: string) {
  if (!ctx.actor) throw errors.unauthenticated();
  const user = await prisma.userProfile.findUniqueOrThrow({ where: { id: ctx.actor.userId } });
  // Wrong codes count against the same lockout as passwords (MAX_FAILED, LOCK_MINUTES); a locked account answers with
  // the same message so the caller learns nothing beyond "not verified".
  if (isLocked(user)) {
    await audit(ctx, { action: 'auth.mfa_failed', resourceType: 'session', resourceId: sessionId, outcome: 'deny', metadata: { reason: 'locked' } });
    throw errors.forbidden('Invalid verification code');
  }
  if (!user.mfaSecret || !verifyTotp(user.mfaSecret, code)) {
    await recordFailedAttempt(user);
    await audit(ctx, { action: 'auth.mfa_failed', resourceType: 'session', resourceId: sessionId, outcome: 'deny', metadata: { reason: 'bad_code' } });
    throw errors.forbidden('Invalid verification code');
  }
  await prisma.userProfile.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, ...(user.mfaEnabled ? {} : { mfaEnabled: true }) } });
  await prisma.session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
  const { tokens } = await issueTokens({ ...user, mfaEnabled: true }, ctx, true, sessionId);
  await audit(ctx, { action: 'auth.mfa_verified', resourceType: 'session', resourceId: sessionId });
  return tokens;
}

export async function setPassword(userId: string, password: string) {
  await prisma.userProfile.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
}
