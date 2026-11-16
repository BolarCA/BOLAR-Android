import { test, expect, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO, DEMO_PASSWORD } from '../helpers/auth';

const API_URL = `http://localhost:${process.env.API_PORT ?? '4000'}`;

/** Creates a property through the API as the manager so owner-visibility checks do not depend on the UI journey. */
async function createPropertyViaApi(request: APIRequestContext, name: string) {
  const login = await request.post(`${API_URL}/auth/login`, { data: { email: DEMO.manager, password: DEMO_PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = (await login.json()) as { accessToken: string };
  const res = await request.post(`${API_URL}/properties`, { headers: { Authorization: `Bearer ${accessToken}` }, data: { name, addressLine1: '77 Harbor Way', city: 'Galveston', state: 'TX', postalCode: '77550', status: 'active' } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

test.describe('property module: manager journey (Days 16-18) @smoke', () => {
  test('manager creates a property, adds a unit and changes its status with a reason', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/properties');
    await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();
    // seeded demo data is visible in the table view
    await expect(page.getByRole('link', { name: 'Maple Court Apartments' })).toBeVisible();
    // table/card toggle
    await page.getByRole('button', { name: 'Cards' }).click();
    await expect(page.getByRole('list', { name: 'Properties' })).toBeVisible();
    await page.getByRole('button', { name: 'Table' }).click();

    const name = `E2E Harbor Point ${Date.now()}`;
    await page.getByRole('button', { name: 'Add property' }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Property name').fill(name);
    await drawer.getByLabel('Address line 1').fill('12 Pier St');
    await drawer.getByLabel('City', { exact: true }).fill('Galveston');
    await drawer.getByLabel('State', { exact: true }).fill('TX');
    await drawer.getByLabel('Postal code').fill('77550');
    await drawer.getByLabel('Initial status').selectOption('active');
    await drawer.getByRole('button', { name: 'Create property' }).click();
    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await expect(row).toContainText('active');

    // detail
    await row.getByRole('link', { name }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.locator('[data-state="empty"]')).toContainText('No units yet');

    // unit create
    await page.getByRole('button', { name: 'Add unit' }).first().click();
    const unitDrawer = page.getByRole('dialog');
    await unitDrawer.getByLabel('Unit number').fill('PH1');
    await unitDrawer.getByLabel('Bedrooms').fill('2');
    await unitDrawer.getByLabel('Bathrooms').fill('1.5');
    await unitDrawer.getByLabel('Target rent (USD / month)').fill('2450');
    await unitDrawer.getByRole('button', { name: 'Create unit' }).click();
    const unitRow = page.getByRole('row', { name: /PH1/ });
    await expect(unitRow).toBeVisible();
    await expect(unitRow).toContainText('vacant');
    await expect(unitRow).toContainText('$2,450');

    // status change requires a reason and only offers legal transitions
    await unitRow.getByRole('button', { name: 'Change status of unit PH1' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('heading', { name: 'Change status of unit PH1' })).toBeVisible();
    const options = await modal.getByLabel('New status').locator('option').allTextContents();
    expect(options.sort()).toEqual(['down', 'make ready', 'occupied', 'reserved']);
    await expect(modal.getByRole('button', { name: 'Confirm change' })).toBeDisabled();
    await modal.getByLabel('New status').selectOption('reserved');
    await modal.getByLabel('Reason (required)').fill('Application approved, holding for move-in');
    await modal.getByRole('button', { name: 'Confirm change' }).click();
    await expect(page.getByRole('row', { name: /PH1/ })).toContainText('reserved');

    // hierarchy view shows the new unit
    await page.getByRole('button', { name: 'Hierarchy' }).click();
    await expect(page.getByText('Unit PH1')).toBeVisible();
  });
});

test.describe('property module: access control (Day 20) @smoke', () => {
  test('owner sees only owned properties and is denied on an unowned detail', async ({ page, request }) => {
    const other = await createPropertyViaApi(request, `E2E Unowned ${Date.now()}`);
    await login(page, DEMO.owner, /\/owner/);
    await page.goto('/owner/properties');
    await expect(page.getByRole('heading', { name: 'My properties' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Maple Court Apartments' })).toBeVisible();
    await expect(page.getByRole('link', { name: other.name })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add property' })).toHaveCount(0);
    // search still cannot surface it
    await page.getByLabel('Search').fill('Unowned');
    await expect(page.locator('[data-state="empty"]')).toBeVisible();
    // owned detail is read-only
    await page.getByLabel('Search').fill('');
    await page.getByRole('link', { name: 'Maple Court Apartments' }).click();
    await expect(page.getByRole('heading', { name: 'Maple Court Apartments' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add unit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Change status of unit/ })).toHaveCount(0);
    // unowned detail renders the denied state (API answers 404, never leaking existence)
    await page.goto(`/owner/properties/${other.id}`);
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
  });

  test('tenant is denied on the manager properties page without data being fetched', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    const requests: string[] = [];
    page.on('request', (r) => { if (r.url().startsWith(API_URL) && /\/(properties|portfolios|units)/.test(r.url())) requests.push(r.url()); });
    await page.goto('/manager/properties');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
    expect(requests).toHaveLength(0);
  });
});

test.describe('property module: accessibility @a11y', () => {
  test('manager properties list has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/properties');
    await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Maple Court Apartments' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });

  test('property detail has no serious axe violations @mobile', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/properties');
    await page.getByRole('link', { name: 'Maple Court Apartments' }).click();
    await expect(page.getByRole('heading', { name: 'Maple Court Apartments' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Units' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
