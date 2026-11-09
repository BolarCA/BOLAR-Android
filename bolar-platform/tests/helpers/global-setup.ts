import { execSync } from 'node:child_process';
import type { FullConfig } from '@playwright/test';

/**
 * Dynamic routes the suite navigates to. The web server under test is the Next.js dev server, which compiles a
 * route on its first request; without a warm-up that first compile can exceed the expect timeout and make the first
 * client-side redirect into a detail page flaky (e.g. tenant profile creation in lease.spec.ts). A placeholder id is
 * enough: compilation is per route file, not per record, and these pages fetch their data client-side after mount.
 */
const DYNAMIC_ROUTES = [
  '/manager/tenants/warmup',
  '/manager/leases/warmup',
  '/manager/properties/warmup',
  '/manager/vendors/warmup',
  '/owner/properties/warmup',
  '/vendor/jobs/warmup',
  '/legal/cases/warmup',
  '/admin/orgs/warmup',
];

async function warmRoutes(baseURL: string) {
  const started = Date.now();
  for (const path of DYNAMIC_ROUTES) {
    try {
      const res = await fetch(`${baseURL}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(60_000) });
      await res.arrayBuffer();
    } catch (err) {
      // A warm-up miss only costs the flake protection for that route; never fail the run over it.
      console.warn(`[e2e] route warm-up failed for ${path}: ${(err as Error).message}`);
    }
  }
  console.info(`[e2e] warmed ${DYNAMIC_ROUTES.length} dynamic routes in ${Date.now() - started}ms`);
}

export default async function globalSetup(config: FullConfig) {
  const root = process.cwd();
  const env = { ...process.env };
  execSync('pnpm db:migrate', { cwd: root, stdio: 'inherit', env });
  execSync('pnpm db:seed', { cwd: root, stdio: 'inherit', env });
  execSync('pnpm db:seed:demo', { cwd: root, stdio: 'inherit', env });

  // webServer entries are already up when globalSetup runs, so the dev server can compile routes now.
  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL) await warmRoutes(baseURL);
}
