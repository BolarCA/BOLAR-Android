import type { Request, Response } from 'express';
import { config } from '../config.js';

/**
 * Refresh-token transport for browsers (review finding 24). A client that sends `X-Auth-Transport: cookie` receives the
 * refresh token only as an httpOnly cookie scoped to /auth, never in the JSON body, so page scripts (and any XSS) cannot
 * read it. API clients that omit the header keep the body token. Cookie attributes come from AUTH_COOKIE_* (SameSite
 * defaults to lax: web and API share a registrable domain; `none` requires Secure).
 */
export const REFRESH_COOKIE = 'bolar_rt';

export function wantsCookieTransport(req: Request): boolean {
  return (req.header('x-auth-transport') ?? '').toLowerCase() === 'cookie';
}

function attributes(maxAgeSeconds: number): string {
  const cfg = config();
  const sameSite = cfg.AUTH_COOKIE_SAMESITE;
  const secure = cfg.AUTH_COOKIE_SECURE === '1' || cfg.NODE_ENV === 'production' || sameSite === 'none';
  const parts = ['Path=/auth', 'HttpOnly', `SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`, `Max-Age=${maxAgeSeconds}`];
  if (secure) parts.push('Secure');
  if (cfg.AUTH_COOKIE_DOMAIN) parts.push(`Domain=${cfg.AUTH_COOKIE_DOMAIN}`);
  return parts.join('; ');
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.append('Set-Cookie', `${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}; ${attributes(config().AUTH_REFRESH_TTL_SECONDS)}`);
}

export function clearRefreshCookie(res: Response): void {
  res.append('Set-Cookie', `${REFRESH_COOKIE}=; ${attributes(0)}`);
}

/** The refresh token from the cookie, if the browser sent one. */
export function readRefreshCookie(req: Request): string | null {
  const header = req.header('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== REFRESH_COOKIE) continue;
    try { return decodeURIComponent(part.slice(eq + 1).trim()) || null; } catch { return null; }
  }
  return null;
}
