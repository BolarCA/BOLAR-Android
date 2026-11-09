import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO } from '../helpers/auth';

/**
 * Reporting (blueprint Days 75-90): governed KPI views, scheduled CSV exports, landlord scoping, denial and a11y.
 * Runs against the demo seed: one active lease (Maple Court 101, $1,450.00), one open invoice INV-000001 ($1,450.00),
 * three properties owned by the demo landlord.
 */
async function refreshViews(page: Page) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/reports/refresh') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Refresh data' }).click(),
  ]);
  expect(res.status()).toBe(200);
}

test.describe('reporting: bookkeeper, owner and denied journeys @smoke', () => {
  test('bookkeeper sees KPIs that match the seeded invoices and the rent roll lists the active lease', async ({ page }) => {
    await login(page, DEMO.bookkeeper, /\/finance/);
    await page.goto('/finance/reports');
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
    await refreshViews(page);
    const kpis = page.getByTestId('report-kpis');
    await expect(kpis).toBeVisible();
    // Monthly rent roll == active lease rent; open receivables == seeded open invoice total (both $1,450.00 in the demo seed).
    await expect(kpis).toContainText('Monthly rent roll');
    await expect(kpis.getByText('$1,450.00').first()).toBeVisible();
    await expect(kpis).toContainText('Open receivables');
    await expect(page.getByTestId('reports-freshness')).toContainText('Data as of');
    const rentRoll = page.getByRole('table', { name: 'Rent roll' });
    await expect(rentRoll).toContainText('Maple Court Apartments');
    await expect(rentRoll).toContainText('Unit 101');
    await expect(rentRoll).toContainText('Theo Tenant');
    await expect(rentRoll).toContainText('$1,450.00');
    // AR aging tab reconciles to the invoice list total.
    await page.getByRole('tab', { name: 'AR aging' }).click();
    await expect(page.getByRole('table', { name: 'Receivables aging' })).toContainText('INV-');
    await expect(page.getByTestId('report-totals')).toContainText('Total');
    // Collections chart renders as an accessible image with the hidden data table.
    await page.getByRole('tab', { name: 'Collections' }).click();
    await expect(page.getByTestId('collections-chart').getByRole('img')).toBeVisible();
  });

  test('bookkeeper creates a scheduled CSV rent-roll report, runs it and gets a download link', async ({ page }) => {
    await login(page, DEMO.bookkeeper, /\/finance/);
    await page.goto('/finance/reports');
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
    const name = `E2E rent roll ${Date.now()}`;
    await page.getByRole('button', { name: 'New scheduled report' }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Name').fill(name);
    await drawer.getByLabel('Report kind').selectOption('rent_roll');
    await drawer.getByLabel('Format').selectOption('csv');
    await drawer.getByLabel('Schedule (cron)').fill('0 6 1 * *');
    await drawer.getByLabel('Recipients').fill('books@demo.bolar.test');
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/reports/definitions') && r.request().method() === 'POST'),
      drawer.getByRole('button', { name: 'Create report' }).click(),
    ]);
    expect(created.status()).toBe(201);
    const row = page.getByRole('table', { name: 'Report definitions' }).getByRole('row', { name: new RegExp(name) });
    await expect(row).toContainText('0 6 1 * *');
    await expect(row).toContainText('CSV');
    const [run] = await Promise.all([
      page.waitForResponse((r) => /\/reports\/definitions\/[^/]+\/run$/.test(r.url()) && r.request().method() === 'POST'),
      row.getByRole('button', { name: `Run ${name} now` }).click(),
    ]);
    expect(run.status()).toBe(201);
    const body = (await run.json()) as { status: string; rowCount: number };
    expect(body.status).toBe('complete');
    expect(body.rowCount).toBeGreaterThanOrEqual(1);
    const runRow = page.getByRole('table', { name: 'Report runs' }).getByRole('row', { name: new RegExp(name) }).first();
    await expect(runRow).toContainText('complete');
    await runRow.getByRole('button', { name: `Download ${name} run` }).click();
    const link = runRow.getByTestId('report-download-link');
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toContain('/storage/object?key=');
  });

  test('owner sees occupancy for exactly the 3 owned properties', async ({ page }) => {
    await login(page, DEMO.owner, /\/owner/);
    await page.goto('/owner/reports');
    await expect(page.getByRole('heading', { name: 'Portfolio reports' })).toBeVisible();
    await expect(page.getByTestId('report-kpis')).toContainText('Occupancy');
    // Landlords cannot refresh; the badge still shows freshness.
    await expect(page.getByRole('button', { name: 'Refresh data' })).toHaveCount(0);
    const table = page.getByRole('table', { name: 'Occupancy by property' });
    await expect(table).toContainText('Maple Court Apartments');
    await expect(table).toContainText('Riverside Lofts');
    await expect(table).toContainText('Sunset Bungalows');
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(page.getByRole('table', { name: 'Rent roll' })).toContainText('Theo Tenant');
  });

  test('tenant is denied on /finance/reports without fetching report data', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    const requests: string[] = [];
    page.on('request', (r) => { if (/\/reports\/(kpis|rent-roll|ar-aging|occupancy|maintenance-sla|collections|compliance-hits|definitions|runs|refresh)/.test(r.url())) requests.push(r.url()); });
    await page.goto('/finance/reports');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
    expect(requests).toHaveLength(0);
  });
});

test.describe('reporting accessibility @a11y', () => {
  test('finance reports page has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.bookkeeper, /\/finance/);
    await page.goto('/finance/reports');
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Rent roll' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
  test('owner reports page has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.owner, /\/owner/);
    await page.goto('/owner/reports');
    await expect(page.getByRole('heading', { name: 'Portfolio reports' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Occupancy by property' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
