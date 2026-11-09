import { Router } from 'express';
import { z, loginRequest, loginResponse, refreshRequest, tokenPair, logoutRequest, okSchema, mfaVerifyRequest, mfaSetupResponse, meResponse } from '@bolar/contracts';
import { errors } from '@bolar/shared';
import { defineRoute, mount } from '../../shared/route.js';
import { prisma } from '../../shared/db.js';
import { verifyAccessToken } from '../../shared/tokens.js';
import * as svc from './service.js';
import { portalsFor } from './portals.js';

export const authRoutes = [
  defineRoute({ method: 'post', path: '/auth/login', operationId: 'login', summary: 'Sign in with email and password', tags: ['auth'], auth: 'public',
    request: { body: loginRequest }, responses: { 200: loginResponse },
    handler: async ({ body, ctx }) => ({ status: 200, body: await svc.login(ctx, body) }) }),
  defineRoute({ method: 'post', path: '/auth/refresh', operationId: 'refreshSession', summary: 'Rotate refresh token and issue a new access token', tags: ['auth'], auth: 'public',
    request: { body: refreshRequest }, responses: { 200: tokenPair },
    handler: async ({ body, ctx }) => ({ status: 200, body: await svc.refresh(ctx, body.refreshToken) }) }),
  defineRoute({ method: 'post', path: '/auth/logout', operationId: 'logout', summary: 'Revoke the current session', tags: ['auth'], auth: 'public',
    request: { body: logoutRequest.optional() }, responses: { 200: okSchema },
    handler: async ({ body, ctx }) => { await svc.logout(ctx, body?.refreshToken); return { status: 200, body: { ok: true } }; } }),
  defineRoute({ method: 'post', path: '/auth/mfa/setup', operationId: 'mfaSetup', summary: 'Start TOTP enrollment', tags: ['auth'], auth: 'session',
    responses: { 200: mfaSetupResponse }, handler: async ({ ctx }) => ({ status: 200, body: await svc.mfaSetup(ctx) }) }),
  defineRoute({ method: 'post', path: '/auth/mfa/verify', operationId: 'mfaVerify', summary: 'Verify TOTP code for the current session', tags: ['auth'], auth: 'session',
    request: { body: mfaVerifyRequest }, responses: { 200: tokenPair },
    handler: async ({ body, ctx, req }) => {
      const claims = await verifyAccessToken(req.header('authorization')!.slice(7));
      if (!claims) throw errors.unauthenticated();
      return { status: 200, body: await svc.mfaVerify(ctx, claims.sid, body.code) };
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
