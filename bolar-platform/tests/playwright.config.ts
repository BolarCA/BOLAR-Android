import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config (blueprint p36 tests). Starts the API and web app against the local database.
 * Run `pnpm db:migrate && pnpm db:seed && pnpm db:seed:demo` first (globalSetup does it in CI).
 */
const API_PORT = process.env.API_PORT ?? '4000';
const WEB_PORT = process.env.WEB_PORT ?? '3000';
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = process.env.WEB_BASE_URL ?? `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './helpers/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  // Dev-server route compilation can push a first navigation past Playwright's 5s default; routes are also warmed in
  // global setup, this is the second line of defence.
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB_URL,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    { command: 'pnpm --filter @bolar/api dev', url: `${API_URL}/health`, reuseExistingServer: !process.env.CI, timeout: 120_000, env: { QUEUE_DRIVER: 'memory', LOG_LEVEL: 'warn', API_PORT, API_BASE_URL: API_URL, WEB_BASE_URL: WEB_URL, CORS_ORIGINS: WEB_URL } },
    { command: 'pnpm --filter @bolar/web dev', url: `${WEB_URL}/login`, reuseExistingServer: !process.env.CI, timeout: 180_000, env: { WEB_PORT, NEXT_PUBLIC_API_BASE_URL: API_URL } },
  ],
});
