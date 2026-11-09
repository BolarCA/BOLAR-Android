// Shared helpers for the k6 scenarios (docs/slo.md, load/README.md). Plain ES modules; k6 bundles them.
import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
export const PASSWORD = __ENV.PASSWORD || 'Bolar!Demo2026';
export const ORG_SLUG = __ENV.ORG_SLUG || 'demo-pm';
export const MANAGER_EMAIL = __ENV.MANAGER_EMAIL || 'manager@demo.bolar.test';
export const TENANT_EMAIL = __ENV.TENANT_EMAIL || 'tenant@demo.bolar.test';

/** P95 targets per route class, in ms (docs/slo.md). k6 thresholds below reference them. */
export const SLO_P95 = { auth: 400, lists: 300, detail: 200, mutations: 500, webhooks: 300, reports: 2000 };

export function jsonHeaders(token, extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Login once per VU; returns the access token or null. Login traffic is tagged class=auth. */
export function login(email, orgSlug = ORG_SLUG) {
  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({ email, password: PASSWORD, orgSlug }), { headers: jsonHeaders(), tags: { class: 'auth' } });
  const ok = check(res, { 'login 200': (r) => r.status === 200 });
  return ok ? res.json('accessToken') : null;
}

export function get(path, token, cls, extra = {}) {
  return http.get(`${BASE_URL}${path}`, { headers: jsonHeaders(token, extra), tags: { class: cls } });
}

export function post(path, body, token, cls, extra = {}) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), { headers: jsonHeaders(token, extra), tags: { class: cls } });
}

/** 2xx/4xx are "handled" (counted for latency); only 5xx and transport errors count as failures. */
export function handled(res) {
  return res.status > 0 && res.status < 500;
}

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
