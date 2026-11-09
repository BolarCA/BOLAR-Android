/**
 * Local P95 loop with Node's built-in fetch (undici): the fallback when k6 is not installable (load/README.md).
 *
 *   API_PORT=4123 pnpm --filter @bolar/api dev &            # API against the volume-seeded database
 *   BASE_URL=http://localhost:4123 pnpm exec tsx load/local-p95.ts
 *
 * Runs each scenario with CONCURRENCY parallel workers for REQUESTS total requests and prints a markdown table
 * with p50/p95/p99/max (client-observed, ms), the 5xx count and a pass/fail against docs/slo.md P95 targets.
 * The server-side numbers are in the API's request logs (durationMs per routeClass).
 */
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4000';
const PASSWORD = process.env.LOAD_PASSWORD ?? 'Bolar!Demo2026';
const ORG_SLUG = process.env.LOAD_ORG_SLUG ?? 'load-pm';
const ADMIN_EMAIL = process.env.LOAD_ADMIN_EMAIL ?? 'admin@load.bolar.test';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const REQUESTS = Number(process.env.REQUESTS ?? 200);
// Keep in sync with docs/slo.md.
const SLO_P95: Record<string, number> = { auth: 400, lists: 300, detail: 200, mutations: 500, webhooks: 300, reports: 2000, health: 50 };

interface Scenario { name: string; cls: keyof typeof SLO_P95; run: (i: number) => Promise<Response> }

async function login(email: string): Promise<string> {
  const r = await fetch(`${BASE_URL}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, orgSlug: ORG_SLUG }) });
  if (r.status !== 200) throw new Error(`login ${email} failed: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { accessToken: string }).accessToken;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]!;
}

async function runScenario(s: Scenario): Promise<{ name: string; cls: string; count: number; p50: number; p95: number; p99: number; max: number; errors: number; non2xx: number }> {
  const durations: number[] = [];
  let errors = 0;
  let non2xx = 0;
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= REQUESTS) return;
      const t0 = performance.now();
      try {
        const r = await s.run(i);
        await r.arrayBuffer();
        if (r.status >= 500) errors++;
        else if (r.status >= 300) non2xx++;
      } catch { errors++; }
      durations.push(performance.now() - t0);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  durations.sort((a, b) => a - b);
  return { name: s.name, cls: s.cls, count: durations.length, p50: percentile(durations, 0.5), p95: percentile(durations, 0.95), p99: percentile(durations, 0.99), max: durations[durations.length - 1] ?? 0, errors, non2xx };
}

async function main() {
  const health = await fetch(`${BASE_URL}/health`);
  if (!health.ok) throw new Error(`API not healthy at ${BASE_URL}: ${health.status}`);
  const token = await login(ADMIN_EMAIL);
  const auth = { authorization: `Bearer ${token}` };
  const props = (await (await fetch(`${BASE_URL}/properties?limit=25`, { headers: auth })).json()) as { items: { id: string }[] };
  const propertyId = props.items[0]?.id;
  if (!propertyId) throw new Error('no properties in the load org; run load/seed-volume.ts');
  const get = (path: string) => fetch(`${BASE_URL}${path}`, { headers: auth });

  const scenarios: Scenario[] = [
    { name: 'GET /health', cls: 'health', run: () => fetch(`${BASE_URL}/health`) },
    { name: 'POST /auth/login', cls: 'auth', run: () => fetch(`${BASE_URL}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ADMIN_EMAIL, password: PASSWORD, orgSlug: ORG_SLUG }) }) },
    { name: 'GET /me', cls: 'auth', run: () => get('/me') },
    { name: 'GET /work-orders?limit=25', cls: 'lists', run: () => get('/work-orders?limit=25') },
    { name: 'GET /work-orders?overdue=true&limit=25', cls: 'lists', run: () => get('/work-orders?overdue=true&limit=25') },
    { name: 'GET /properties?status=active&limit=25', cls: 'lists', run: () => get('/properties?status=active&limit=25') },
    { name: 'GET /properties/:id', cls: 'detail', run: () => get(`/properties/${propertyId}`) },
    { name: 'GET /invoices?limit=25', cls: 'lists', run: () => get('/invoices?limit=25') },
    { name: 'GET /audit?limit=25', cls: 'lists', run: () => get('/audit?limit=25') },
    { name: 'GET /documents?ownerType=property&ownerId=:id&limit=25', cls: 'lists', run: () => get(`/documents?ownerType=property&ownerId=${propertyId}&limit=25`) },
    { name: 'GET /rules/evaluations?result=block&reviewed=false&limit=25', cls: 'lists', run: () => get('/rules/evaluations?result=block&reviewed=false&limit=25') },
    { name: 'GET /tenant-profiles?q=Resident 12&limit=25', cls: 'lists', run: () => get('/tenant-profiles?q=Resident%2012&limit=25') },
  ];
  const rows = [];
  for (const s of scenarios) rows.push(await runScenario(s));
  const lines = [
    `Base URL ${BASE_URL}, ${REQUESTS} requests x ${CONCURRENCY} concurrent per scenario, client-observed ms (Node fetch).`,
    '',
    '| Scenario | Class | p50 | p95 | p99 | max | 5xx | non-2xx | SLO p95 | Result |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) => `| ${r.name} | ${r.cls} | ${r.p50.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.p99.toFixed(1)} | ${r.max.toFixed(1)} | ${r.errors} | ${r.non2xx} | ${SLO_P95[r.cls]} | ${r.errors === 0 && r.p95 <= SLO_P95[r.cls]! ? 'pass' : 'FAIL'} |`),
  ];
  console.info(lines.join('\n'));
  if (rows.some((r) => r.errors > 0 || r.p95 > SLO_P95[r.cls]!)) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
