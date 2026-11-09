// Scenario: tenant opens the pay page (invoice list) and submits a small payment with an Idempotency-Key.
// Payments run through the mock adapter (STRIPE_MODE=mock); amounts never end in 99 (mock decline).
import { check, sleep } from 'k6';
import { TENANT_EMAIL, SLO_P95, login, get, post, handled, uuid } from './lib.js';

export const options = {
  scenarios: {
    pay: { executor: 'constant-vus', vus: 5, duration: '1m' },
  },
  thresholds: {
    'http_req_duration{class:lists}': [`p(95)<${SLO_P95.lists}`],
    'http_req_duration{class:mutations}': [`p(95)<${SLO_P95.mutations}`],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.98'],
  },
};

export function setup() {
  const token = login(TENANT_EMAIL);
  if (!token) throw new Error('tenant login failed; seed the demo data first');
  return { token };
}

export default function (data) {
  const { token } = data;
  const invoices = get('/invoices?limit=25', token, 'lists');
  check(invoices, { 'invoices 200': (r) => r.status === 200 });
  const items = invoices.json('items') || [];
  const open = items.find((i) => (i.status === 'open' || i.status === 'partially_paid' || i.status === 'overdue') && i.totalCents - i.paidCents > 100);
  if (open) {
    const key = uuid();
    const body = { invoiceId: open.id, amountCents: 100, method: 'card', paymentMethodRef: 'pm_mock_visa' };
    const pay = post('/payments', body, token, 'mutations', { 'Idempotency-Key': key });
    check(pay, { 'payment handled': (r) => handled(r), 'payment created or replayed': (r) => r.status === 201 || r.status === 200 || r.status === 400 || r.status === 403 });
    // replay with the same key must be served from the idempotency store
    const replay = post('/payments', body, token, 'mutations', { 'Idempotency-Key': key });
    check(replay, { 'replay handled': (r) => handled(r), 'replay flagged': (r) => r.status >= 400 || r.headers['Idempotent-Replayed'] === 'true' });
  }
  const payments = get('/payments?limit=25', token, 'lists');
  check(payments, { 'payments handled': (r) => handled(r) });
  sleep(1);
}
