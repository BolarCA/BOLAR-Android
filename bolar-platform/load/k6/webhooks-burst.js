// Scenario: provider webhook burst. Unsigned payloads exercise the verification + rate-limit path (400/429 are
// "handled"); set WEBHOOK_SIGNATURE_HEADER/WEBHOOK_SIGNATURE to replay a signed sandbox event for the processed path.
// Webhooks are public, so this is also the public-intake limiter test: 60/min per IP per provider outside trusted IPs.
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import http from 'k6/http';
import { BASE_URL, SLO_P95, handled, uuid } from './lib.js';

const rateLimited = new Rate('rate_limited');
const PROVIDER = __ENV.PROVIDER || 'stripe';

export const options = {
  scenarios: {
    burst: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: '30s', preAllocatedVUs: 20, maxVUs: 100 },
  },
  thresholds: {
    'http_req_duration{class:webhooks}': [`p(95)<${SLO_P95.webhooks}`],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export default function () {
  const headers = { 'Content-Type': 'application/json' };
  if (__ENV.WEBHOOK_SIGNATURE_HEADER && __ENV.WEBHOOK_SIGNATURE) headers[__ENV.WEBHOOK_SIGNATURE_HEADER] = __ENV.WEBHOOK_SIGNATURE;
  const payload = __ENV.WEBHOOK_BODY || JSON.stringify({ id: `evt_${uuid()}`, type: 'payment_intent.succeeded', data: { object: { id: `pi_${uuid()}` } } });
  const res = http.post(`${BASE_URL}/webhooks/${PROVIDER}`, payload, { headers, tags: { class: 'webhooks' } });
  rateLimited.add(res.status === 429);
  check(res, {
    'handled (no 5xx)': (r) => handled(r),
    'outcome or rejection': (r) => r.status === 429 || r.status === 400 || (r.status === 200 && ['processed', 'duplicate', 'ignored'].includes(r.json('outcome'))),
  });
}
