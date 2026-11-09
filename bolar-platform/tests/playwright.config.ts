import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config (blueprint p36 tests). Starts the API and web app against the local database.
 * Run `pnpm db:migrate && pnpm db:seed && pnpm db:seed:demo` first (globalSetup does it in CI).
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './helpers/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    { command: 'pnpm --filter @bolar/api dev', url: 'http://localhost:4000/health', reuseExistingServer: !process.env.CI, timeout: 120_000, env: { QUEUE_DRIVER: 'memory', LOG_LEVEL: 'warn' } },
    { command: 'pnpm --filter @bolar/web dev', url: 'http://localhost:3000/login', reuseExistingServer: !process.env.CI, timeout: 180_000 },
  ],
});
