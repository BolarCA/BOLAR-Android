// Scenario: login storm. Verifies auth P95 and that the per-IP/per-e-mail limiter answers 429 (not 5xx) under abuse.
// Run from a trusted IP (RATE_LIMIT_TRUSTED_IPS) for pure latency, or from an untrusted IP to exercise the limiter.
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import http from 'k6/http';
import { BASE_URL, MANAGER_EMAIL, PASSWORD, ORG_SLUG, SLO_P95, jsonHeaders, handled } from './lib.js';

const rateLimited = new Rate('rate_limited');

export const options = {
  scenarios: {
    steady: { executor: 'constant-arrival-rate', rate: 5, timeUnit: '1s', duration: '1m', preAllocatedVUs: 10, maxVUs: 50 },
  },
  thresholds: {
    'http_req_duration{class:auth}': [`p(95)<${SLO_P95.auth}`],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const n = __ITER % 5;
  // 4 of 5 attempts use the real password; 1 of 5 a wrong one so the generic error path is measured too.
  const body = JSON.stringify({ email: MANAGER_EMAIL, password: n === 4 ? 'definitely-wrong' : PASSWORD, orgSlug: ORG_SLUG });
  const res = http.post(`${BASE_URL}/auth/login`, body, { headers: jsonHeaders(), tags: { class: 'auth' } });
  rateLimited.add(res.status === 429);
  check(res, {
    'handled (no 5xx)': (r) => handled(r),
    'generic error on bad password': (r) => n !== 4 || r.status === 429 || (r.status === 401 && r.json('message') === 'Invalid email, password, or organization'),
    'retry-after on 429': (r) => r.status !== 429 || !!r.headers['Retry-After'],
  });
  sleep(0.1);
}
