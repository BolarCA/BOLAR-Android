import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO } from '../helpers/auth';

/** Days 51 + 54: master admin control plane and the property manager operations cockpit. */
const RUN = Date.now();
const OVERDUE_WO = 'Bathroom exhaust fan not working';

/** The queue's live counter reads "Loading queue…" until every enabled source has resolved. */
async function queueReady(page: Page) {
  await expect(page.getByTestId('queue-count')).toHaveText(/^\d+ of \d+ items?$/, { timeout: 20_000 });
}

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.describe('property manager operations cockpit (Day 54) @smoke', () => {
  test('manager sees the unified queue with the overdue work order, the review lease and compliance hits', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
    await queueReady(page);

    // KPI strip
    const kpis = page.getByTestId('ops-kpis');
    await expect(kpis.getByTestId('kpi-overdue-work-orders')).toContainText(/Overdue work orders\s*[1-9]/);
    await expect(kpis.getByTestId('kpi-leases')).toContainText(/Leases awaiting action\s*[1-9]/);
    await expect(kpis.getByTestId('kpi-compliance')).toContainText(/Compliance hits\s*[1-9]/);
    await expect(kpis.getByTestId('kpi-notices')).toContainText(/Notices pending\s*[1-9]/);
    await expect(kpis.getByTestId('kpi-applications')).toContainText(/Applications in review\s*[1-9]/);
    await expect(kpis.getByTestId('kpi-vacant-units')).toContainText(/Vacant units\s*[1-9]/);

    // Queue rows across types
    const queue = page.getByTestId('ops-queue');
    const overdueRow = queue.getByTestId('queue-row').filter({ hasText: OVERDUE_WO });
    await expect(overdueRow).toHaveCount(1);
    await expect(overdueRow).toContainText(/Overdue by/);
    await expect(overdueRow).toContainText('Work order');
    const leaseRow = queue.getByTestId('queue-row').filter({ hasText: 'Awaiting approval' });
    await expect(leaseRow.first()).toContainText('Maple Court Apartments');
    await expect(leaseRow.first()).toContainText('Lease');
    expect(await queue.locator('[data-queue-type="compliance"]').count()).toBeGreaterThan(0);
    expect(await queue.locator('[data-queue-type="notice"]').count()).toBeGreaterThan(0);
    // Overdue items sort first.
    await expect(queue.getByTestId('queue-row').first()).toContainText(/Overdue by/);
  });

  test('filters: property narrows to that property, type chips and due window combine, clear restores everything', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    const queue = page.getByTestId('ops-queue');
    await queueReady(page);
    const total = await queue.getByTestId('queue-row').count();
    expect(total).toBeGreaterThan(2);

    await page.getByLabel('Property').selectOption({ label: 'Maple Court Apartments' });
    const rows = queue.getByTestId('queue-row');
    expect(await rows.count()).toBeGreaterThan(0);
    for (const text of await rows.allTextContents()) expect(text).toContain('Maple Court Apartments');
    // Compliance hits are portfolio-wide (no property) so a property filter excludes them.
    await expect(queue.locator('[data-queue-type="compliance"]')).toHaveCount(0);

    await page.getByTestId('type-chip-compliance').click();
    await expect(page.getByTestId('type-chip-compliance')).toHaveAttribute('aria-pressed', 'true');
    await expect(queue.locator('[data-state="empty"]')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(queue.getByTestId('queue-row')).toHaveCount(total);

    await page.getByLabel('Due date').selectOption('overdue');
    for (const text of await queue.getByTestId('queue-row').allTextContents()) expect(text).toMatch(/Overdue by/);
    await page.getByLabel('Priority').selectOption('critical');
    for (const text of await queue.getByTestId('queue-row').allTextContents()) expect(text).toContain('critical');
  });

  test('deep link from the queue opens the work order drawer on the maintenance board', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await queueReady(page);
    const row = page.getByTestId('ops-queue').getByTestId('queue-row').filter({ hasText: OVERDUE_WO });
    await row.getByRole('link', { name: `Open ${OVERDUE_WO}` }).click();
    await expect(page).toHaveURL(/\/manager\/maintenance\?workOrderId=/);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: OVERDUE_WO })).toBeVisible();
    // Vendor and tenant deep links exist on rows that have them.
    await page.goto('/manager');
    await queueReady(page);
    const leaseRow = page.getByTestId('ops-queue').getByTestId('queue-row').filter({ hasText: 'Awaiting approval' }).first();
    await leaseRow.getByRole('link', { name: 'Tenant' }).click();
    await expect(page).toHaveURL(/\/manager\/tenants\/[a-z0-9]+/);
  });
});

test.describe('master admin control plane (Day 51) @smoke', () => {
  test('platform admin sees the health summary and creates a feature flag', async ({ page }) => {
    await login(page, DEMO.platform, /\/admin/);
    const health = page.getByTestId('health-summary');
    await expect(health).toContainText(/API health\s*ok/);
    await expect(health).toContainText(/db ok/);
    await expect(health).toContainText(/Organizations\s*[1-9]/);
    await expect(health).toContainText(/Queue\s*memory/);
    // Nav shows the admin-only items.
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'Feature flags' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Support sessions' })).toBeVisible();

    await nav.getByRole('link', { name: 'Feature flags' }).click();
    await expect(page.getByRole('heading', { name: 'Feature flags' })).toBeVisible();
    await page.getByRole('button', { name: 'New flag' }).click();
    const key = `e2e.flag.${RUN}`;
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Key').fill(key);
    await dialog.getByLabel('Rules (JSON)').fill('{"rollout": 25}');
    await dialog.getByRole('button', { name: 'Create flag' }).click();
    await expect(dialog.getByText(`Flag ${key} created`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
    const row = page.getByRole('row', { name: new RegExp(key) });
    await expect(row).toContainText('global');
    await expect(row).toContainText('disabled');
    await row.getByRole('button', { name: `Enable ${key}` }).click();
    await expect(row).toContainText('enabled');
    await expect(row.getByRole('button', { name: `Disable ${key}` })).toBeVisible();
  });

  test('platform admin starts a support session for demo-pm, acts as that org with the banner, then ends it', async ({ page }) => {
    await login(page, DEMO.platform, /\/admin/);
    await page.goto('/admin/orgs');
    await page.getByRole('row', { name: /demo-pm/ }).getByRole('link', { name: 'Demo Property Management' }).click();
    await expect(page.getByRole('heading', { name: 'Demo Property Management' })).toBeVisible();
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole('main')).toContainText('Subaccounts');
    await expect(page.getByRole('main')).toContainText('Recent audit activity');

    await page.getByRole('button', { name: 'Start support session' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason (ticket reference)').fill(`Ticket #E2E-${RUN}: verify lease approvals page`);
    await dialog.getByLabel('Duration').selectOption('15');
    await dialog.getByRole('button', { name: 'Start session' }).click();
    await expect(dialog.getByText('Support session started')).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Support session active' })).toBeDisabled();

    // Act as the org: every request now carries X-Tenant-Org and /me reports the support session.
    await page.getByRole('button', { name: 'Act as Demo Property Management' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const banner = page.getByTestId('support-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Support session active');
    await expect(banner).toContainText('Demo Property Management');
    await expect(page.getByRole('main')).toContainText('Support session');
    await banner.getByRole('button', { name: 'Stop acting as org' }).click();
    await expect(page.getByTestId('support-banner')).toHaveCount(0);

    // End the session from the sessions page.
    await page.goto('/admin/support-sessions');
    const row = page.getByRole('row', { name: new RegExp(`E2E-${RUN}`) });
    await expect(row).toContainText('active');
    await row.getByRole('button', { name: 'End support session for Demo Property Management' }).click();
    await expect(row).toHaveCount(0);
    await page.getByLabel('Show').selectOption('all');
    await expect(page.getByRole('row', { name: new RegExp(`E2E-${RUN}`) })).toContainText('ended');
  });

  test('tenant is denied on /admin and fetches no control-plane data', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    const requests: string[] = [];
    page.on('request', (r) => { if (r.url().includes(`:${process.env.API_PORT ?? '4000'}/`) && !/\/(me|auth)/.test(r.url())) requests.push(r.url()); });
    await page.goto('/admin');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
    await page.waitForTimeout(300);
    expect(requests.filter((u) => /\/(orgs|platform|feature-flags|support-sessions)/.test(u))).toEqual([]);
    for (const route of ['/admin/feature-flags', '/admin/support-sessions', '/admin/orgs']) {
      await page.goto(route);
      await expect(page.locator('[data-state="denied"]')).toBeVisible();
    }
  });
});

test.describe('accessibility @a11y', () => {
  test('operations cockpit has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
    await queueReady(page);
    await axeClean(page);
  });
  test('admin overview, feature flags and support sessions have no serious axe violations', async ({ page }) => {
    await login(page, DEMO.platform, /\/admin/);
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
    await axeClean(page);
    await page.goto('/admin/feature-flags');
    await expect(page.getByRole('heading', { name: 'Feature flags' })).toBeVisible();
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
    await axeClean(page);
    await page.goto('/admin/support-sessions');
    await expect(page.getByRole('heading', { name: 'Support sessions' })).toBeVisible();
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
    await axeClean(page);
  });
});
