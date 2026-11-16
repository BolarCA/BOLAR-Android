import { SignJWT, jwtVerify } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

export interface AccessClaims {
  sub: string; // userId
  org: string; // tenantOrgId
  sid: string; // sessionId
  mfa: boolean;
  plat: boolean;
}

const secret = () => new TextEncoder().encode(config().AUTH_JWT_SECRET);

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ org: claims.org, sid: claims.sid, mfa: claims.mfa, plat: claims.plat })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('bolar')
    .setAudience('bolar-api')
    .setExpirationTime(`${config().AUTH_ACCESS_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'bolar', audience: 'bolar-api' });
    if (!payload.sub || typeof payload.org !== 'string' || typeof payload.sid !== 'string') return null;
    return { sub: payload.sub, org: payload.org, sid: payload.sid, mfa: Boolean(payload.mfa), plat: Boolean(payload.plat) };
  } catch {
    return null;
  }
}

export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
