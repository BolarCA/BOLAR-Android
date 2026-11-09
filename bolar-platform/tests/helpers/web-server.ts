// Starts the web app for Playwright from a production build (`next build` + `next start`).
// The suite used to run against `next dev`, which compiles each page on its first request; whichever test first
// visited a cold page paid that compile inside an expect timeout, and compile time grows with machine load
// (see docs/smoke-results.md, failure 6). A production build has every route compiled before the first test runs
// and is what ships. Set E2E_REUSE_WEB_BUILD=1 to skip the build when `pnpm build` has just produced one (CI).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const buildId = path.join(root, 'apps', 'web', '.next', 'BUILD_ID');
// NEXT_PUBLIC_* values are inlined at build time, so the build must see the same env as the server.
const env = { ...process.env, NODE_ENV: 'production' };

if (process.env.E2E_REUSE_WEB_BUILD === '1' && existsSync(buildId)) {
  console.info('[e2e] reusing existing web build');
} else {
  console.info('[e2e] building web app for e2e');
  const build = spawnSync('pnpm', ['--filter', '@bolar/web', 'build'], { cwd: root, stdio: 'inherit', env });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const server = spawn('pnpm', ['--filter', '@bolar/web', 'start'], { cwd: root, stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
