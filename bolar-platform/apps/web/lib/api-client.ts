'use client';
import type { ErrorBodyDto, LoginResponseDto, MeResponseDto } from '@bolar/contracts';

/** Typed REST client (blueprint p10 lib/api-client.ts). Tokens: access in memory, refresh in localStorage. */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const REFRESH_KEY = 'bolar.refreshToken';
const ORG_KEY = 'bolar.orgSlug';

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: ErrorBodyDto) {
    super(body.message);
    this.name = 'ApiError';
  }
  get code() { return this.body.code; }
  get isDenied() { return this.status === 403 && this.body.code === 'forbidden'; }
  get isReviewRequired() { return this.status === 403 && this.body.code === 'review_required'; }
  get isUnauthenticated() { return this.status === 401; }
  get isNotFound() { return this.status === 404; }
}

export function setTokens(t: { accessToken: string; refreshToken: string } | null, orgSlug?: string) {
  accessToken = t?.accessToken ?? null;
  try {
    if (t) { localStorage.setItem(REFRESH_KEY, t.refreshToken); if (orgSlug) localStorage.setItem(ORG_KEY, orgSlug); }
    else { localStorage.removeItem(REFRESH_KEY); localStorage.removeItem(ORG_KEY); }
  } catch { /* storage unavailable (private mode); session stays in memory */ }
}
export function hasRefreshToken(): boolean {
  try { return Boolean(localStorage.getItem(REFRESH_KEY)); } catch { return false; }
}
export function getAccessToken() { return accessToken; }

async function refresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    let token: string | null = null;
    try { token = localStorage.getItem(REFRESH_KEY); } catch { token = null; }
    if (!token) return false;
    const res = await fetch(`${API_BASE}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: token }) });
    if (!res.ok) { setTokens(null); return false; }
    const body = (await res.json()) as { accessToken: string; refreshToken: string };
    setTokens(body);
    return true;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

export interface RequestOptions { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown; headers?: Record<string, string>; idempotencyKey?: string; purpose?: string; signal?: AbortSignal }

export async function api<T>(path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
  if (!accessToken && hasRefreshToken()) await refresh();
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers ?? {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.purpose) headers['X-Access-Purpose'] = opts.purpose;
  const res = await fetch(`${API_BASE}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    if (res.status === 401 && retry && (await refresh())) return api<T>(path, opts, false);
    const body = (json as ErrorBodyDto | null) ?? { code: 'internal_error', message: res.statusText, requestId: res.headers.get('x-request-id') ?? 'unknown' };
    throw new ApiError(res.status, body);
  }
  return json as T;
}

export const authApi = {
  login: (input: { email: string; password: string; orgSlug?: string }) => api<LoginResponseDto>('/auth/login', { method: 'POST', body: input }),
  me: () => api<MeResponseDto>('/me'),
  logout: async () => {
    let token: string | null = null;
    try { token = localStorage.getItem(REFRESH_KEY); } catch { token = null; }
    try { await api('/auth/logout', { method: 'POST', body: token ? { refreshToken: token } : {} }); } finally { setTokens(null); }
  },
  acceptInvite: (input: { token: string; name: string; password: string }) => api<{ ok: true; orgSlug: string; email: string }>('/invitations/accept', { method: 'POST', body: input }),
};

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
