// Scenario: property manager browsing the work-order board, property list and detail pages.
// Thresholds mirror docs/slo.md for the lists and detail classes.
import { check, sleep } from 'k6';
import { MANAGER_EMAIL, SLO_P95, login, get, handled } from './lib.js';

export const options = {
  scenarios: {
    browse: { executor: 'ramping-vus', startVUs: 1, stages: [{ duration: '30s', target: 10 }, { duration: '1m', target: 10 }, { duration: '15s', target: 0 }] },
  },
  thresholds: {
    'http_req_duration{class:lists}': [`p(95)<${SLO_P95.lists}`],
    'http_req_duration{class:detail}': [`p(95)<${SLO_P95.detail}`],
    'http_req_duration{class:auth}': [`p(95)<${SLO_P95.auth}`],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  const token = login(MANAGER_EMAIL);
  if (!token) throw new Error('manager login failed; seed the demo data first');
  const props = get('/properties?limit=25', token, 'lists').json('items') || [];
  return { token, propertyIds: props.map((p) => p.id) };
}

export default function (data) {
  const { token, propertyIds } = data;
  const me = get('/me', token, 'auth');
  check(me, { 'me 200': (r) => r.status === 200 });
  const board = get('/work-orders?limit=25', token, 'lists');
  check(board, { 'board 200': (r) => r.status === 200, 'board bounded': (r) => (r.json('items') || []).length <= 25 });
  const overdue = get('/work-orders?overdue=true&limit=25', token, 'lists');
  check(overdue, { 'overdue handled': (r) => handled(r) });
  const list = get('/properties?status=active&limit=25', token, 'lists');
  check(list, { 'properties 200': (r) => r.status === 200 });
  if (propertyIds.length) {
    const id = propertyIds[__ITER % propertyIds.length];
    const detail = get(`/properties/${id}`, token, 'detail');
    check(detail, { 'property detail 200': (r) => r.status === 200 });
    const units = get(`/properties/${id}/units?limit=25`, token, 'lists');
    check(units, { 'units handled': (r) => handled(r) });
  }
  sleep(1);
}
