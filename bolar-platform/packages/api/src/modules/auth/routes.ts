import { Router } from 'express';
import { z, loginRequest, loginResponse, refreshRequest, tokenPair, logoutRequest, okSchema, mfaVerifyRequest, mfaSetupResponse, meResponse } from '@bolar/contracts';
import { errors } from '@bolar/shared';
import { defineRoute, mount } from '../../shared/route.js';
import { prisma } from '../../shared/db.js';
import { verifyAccessToken } from '../../shared/tokens.js';
import * as svc from './service.js';
import { portalsFor } from './portals.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie, wantsCookieTransport } from '../../shared/cookies.js';
import type { Request, Response } from 'express';

/** Body for token-issuing routes: with cookie transport the refresh token travels only in the httpOnly cookie. */
function deliverTokens<T extends { refreshToken: string }>(req: Request, res: Response, tokens: T): Omit<T, 'refreshToken'> & { refreshToken?: string } {
  if (!wantsCookieTransport(req)) return tokens;
  setRefreshCookie(res, tokens.refreshToken);
  const { refreshToken: _omitted, ...rest } = tokens;
  return rest;
}

export const authRoutes = [
  defineRoute({ method: 'post', path: '/auth/login', operationId: 'login', summary: 'Sign in with email and password', tags: ['auth'], auth: 'public',
    request: { body: loginRequest }, responses: { 200: loginResponse },
    handler: async ({ body, ctx, req, res }) => ({ status: 200, body: deliverTokens(req, res, await svc.login(ctx, body)) }) }),
  defineRoute({ method: 'post', path: '/auth/refresh', operationId: 'refreshSession', summary: 'Rotate refresh token and issue a new access token (token from the body, or from the httpOnly cookie for browser clients)', tags: ['auth'], auth: 'public',
    request: { body: refreshRequest.optional() }, responses: { 200: tokenPair },
    handler: async ({ body, ctx, req, res }) => {
      const token = body?.refreshToken ?? readRefreshCookie(req);
      if (!token) throw errors.unauthenticated('Session expired; please sign in again');
      return { status: 200, body: deliverTokens(req, res, await svc.refresh(ctx, token)) };
    } }),
  defineRoute({ method: 'post', path: '/auth/logout', operationId: 'logout', summary: 'Revoke the current session', tags: ['auth'], auth: 'public',
    request: { body: logoutRequest.optional() }, responses: { 200: okSchema },
    handler: async ({ body, ctx, req, res }) => {
      await svc.logout(ctx, body?.refreshToken ?? readRefreshCookie(req) ?? undefined);
      if (wantsCookieTransport(req) || readRefreshCookie(req)) clearRefreshCookie(res);
      return { status: 200, body: { ok: true } };
    } }),
  defineRoute({ method: 'post', path: '/auth/mfa/setup', operationId: 'mfaSetup', summary: 'Start TOTP enrollment', tags: ['auth'], auth: 'session',
    responses: { 200: mfaSetupResponse }, handler: async ({ ctx }) => ({ status: 200, body: await svc.mfaSetup(ctx) }) }),
  defineRoute({ method: 'post', path: '/auth/mfa/verify', operationId: 'mfaVerify', summary: 'Verify TOTP code for the current session', tags: ['auth'], auth: 'session',
    request: { body: mfaVerifyRequest }, responses: { 200: tokenPair },
    handler: async ({ body, ctx, req, res }) => {
      const claims = await verifyAccessToken(req.header('authorization')!.slice(7));
      if (!claims) throw errors.unauthenticated();
      return { status: 200, body: deliverTokens(req, res, await svc.mfaVerify(ctx, claims.sid, body.code)) };
    } }),
  defineRoute({ method: 'get', path: '/me', operationId: 'getMe', summary: 'Current actor, tenant, roles, permissions and portals', tags: ['auth'], auth: 'session',
    responses: { 200: meResponse },
    handler: async ({ ctx }) => {
      const org = await prisma.tenantOrg.findUniqueOrThrow({ where: { id: ctx.tenantOrgId! }, select: { id: true, slug: true, name: true } });
      const user = await prisma.userProfile.findUniqueOrThrow({ where: { id: ctx.actor!.userId }, select: { mfaEnabled: true } });
      return { status: 200, body: {
        requestId: ctx.requestId,
        actor: { id: ctx.actor!.userId, email: ctx.actor!.email, name: ctx.actor!.name, isPlatform: ctx.actor!.isPlatform, mfaVerified: ctx.actor!.mfaVerified, mfaEnabled: user.mfaEnabled },
        org, roles: ctx.roles, permissions: [...ctx.permissions].sort(), portals: portalsFor(ctx.roles.map((r) => r.role)), supportSessionId: ctx.supportSessionId,
      } };
    } }),
];
export const authRouter: Router = Router();
mount(authRouter, authRoutes);
export { z };
