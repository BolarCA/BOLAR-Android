import { z } from './openapi-zod.js';
import { emailSchema, idSchema } from './common.js';
import { ROLES, PERMISSIONS, SCOPE_TYPES } from '@bolar/shared';

export const loginRequest = z
  .object({
    email: emailSchema,
    password: z.string().min(8).max(256),
    orgSlug: z.string().min(1).max(64).optional(),
  })
  .openapi('LoginRequest');

export const orgSummary = z.object({ id: idSchema, slug: z.string(), name: z.string() }).openapi('OrgSummary');

export const tokenPair = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresIn: z.number().int(),
    tokenType: z.literal('Bearer'),
    mfaRequired: z.boolean(),
  })
  .openapi('TokenPair');

export const loginResponse = tokenPair
  .extend({
    user: z.object({ id: idSchema, email: z.string(), name: z.string() }),
    org: orgSummary,
  })
  .openapi('LoginResponse');

export const refreshRequest = z.object({ refreshToken: z.string().min(16) }).openapi('RefreshRequest');
export const logoutRequest = z.object({ refreshToken: z.string().min(16).optional() }).openapi('LogoutRequest');
export const mfaVerifyRequest = z.object({ code: z.string().regex(/^\d{6}$/) }).openapi('MfaVerifyRequest');
export const mfaSetupResponse = z.object({ secret: z.string(), otpauthUrl: z.string() }).openapi('MfaSetupResponse');

export const scopedRoleSchema = z.object({ role: z.enum(ROLES), scopeType: z.enum(SCOPE_TYPES), scopeId: idSchema.nullable() }).openapi('ScopedRole');

export const meResponse = z
  .object({
    requestId: z.string(),
    actor: z.object({ id: idSchema, email: z.string(), name: z.string(), isPlatform: z.boolean(), mfaVerified: z.boolean(), mfaEnabled: z.boolean() }),
    org: orgSummary,
    roles: z.array(scopedRoleSchema),
    permissions: z.array(z.enum(PERMISSIONS)),
    portals: z.array(z.string()),
    supportSessionId: z.string().nullable(),
  })
  .openapi('MeResponse');
export type MeResponseDto = z.infer<typeof meResponse>;
export type LoginResponseDto = z.infer<typeof loginResponse>;
