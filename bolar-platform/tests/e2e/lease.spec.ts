import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO } from '../helpers/auth';

/**
 * Lease lifecycle journey (Days 21-25, 57): manager creates a tenant profile and a draft lease on a vacant unit and
 * submits it for review; the landlord approves from the approvals queue; the manager sends it for e-signature
 * (mock DocuSign envelope); the tenant is denied on the staff lease screens; axe runs on the lease workspace.
 * Re-runnable: dates are far in the future and the lease is canceled at the end so the unit is released.
 */
const run = Date.now().toString(36);
const tenantName = `E2E Tenant ${run}`;
const year = 2040 + Math.floor(Math.random() * 40);
const start = `${year}-02-01`;
const end = `${year + 1}-01-31`;
let leaseUrl = '';

async function noSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test.describe('lease lifecycle @smoke', () => {
  test('manager creates a tenant profile with redacted fields', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/tenants');
    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
    await page.getByRole('button', { name: 'New tenant profile' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Display name').fill(tenantName);
    await dialog.getByLabel('Email').fill(`e2e.${run}@demo.bolar.test`);
    await dialog.getByLabel('Phone').fill('+15125550177');
    await dialog.getByLabel('SSN last 4').fill('7777');
    await dialog.getByRole('button', { name: 'Create profile' }).click();
    await expect(page).toHaveURL(/\/manager\/tenants\/[a-z0-9]+/);
    await expect(page.getByRole('heading', { name: tenantName })).toBeVisible();
    // confidential fields are redacted for the manager; restricted section shows the request-access flow
    await expect(page.getByText('redacted').first()).toBeVisible();
    await page.getByRole('button', { name: 'Reveal sensitive fields' }).click();
    await expect(page.locator('[data-state="review-required"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request access' })).toBeVisible();
  });

  test('manager drafts a lease on a vacant unit and submits it for review', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/leases');
    await expect(page.getByRole('heading', { name: 'Leases' })).toBeVisible();
    await page.getByRole('button', { name: 'New lease' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: /^Property/ }).selectOption({ label: 'Maple Court Apartments' });
    const unitSelect = dialog.getByRole('combobox', { name: /^Unit/ });
    const vacant = await unitSelect.locator('option', { hasText: /vacant/ }).first().getAttribute('value');
    expect(vacant).toBeTruthy();
    await unitSelect.selectOption(vacant!);
    await dialog.getByLabel('Find tenant', { exact: true }).fill(tenantName);
    const tenantSelect = dialog.getByRole('combobox', { name: /^Primary tenant/ });
    await expect(tenantSelect.locator('option', { hasText: tenantName })).toHaveCount(1);
    await tenantSelect.selectOption({ label: `${tenantName} · applicant` });
    await dialog.getByLabel('Start date').fill(start);
    await dialog.getByLabel('End date').fill(end);
    await dialog.getByLabel('Monthly rent (USD)').fill('1575');
    await dialog.getByLabel('Security deposit (USD)').fill('1575');
    await dialog.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/manager\/leases\/[a-z0-9]+/);
    leaseUrl = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { name: /Maple Court Apartments · Unit/ })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Lease lifecycle' })).toContainText('draft');
    await expect(page.getByRole('table', { name: 'Lease parties' })).toContainText(tenantName);
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText('review');
    await expect(page.getByText('Awaiting a second person')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Audit timeline' })).toContainText('draft → review');
  });

  test('landlord approves the lease from the approvals queue', async ({ page }) => {
    await login(page, DEMO.owner, /\/owner/);
    await page.goto('/owner/approvals');
    await expect(page.getByRole('heading', { name: 'Lease approvals' })).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(tenantName) });
    await expect(row).toContainText('review');
    await row.getByRole('button', { name: /^Approve lease/ }).click();
    await expect(row).toHaveCount(0);
  });

  test('manager sends the approved lease for e-signature (mock envelope) and the workspace is accessible', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto(leaseUrl);
    await expect(page.locator('[aria-current="step"]')).toContainText('approved');
    await page.getByRole('button', { name: 'Send for e-signature' }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText('sent');
    await expect(page.getByText(/1 recipient/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Audit timeline' })).toContainText('approved → sent');
    await noSeriousViolations(page);
    // release the unit so the journey is repeatable
    await page.getByRole('button', { name: 'Cancel lease' }).click();
    await expect(page.locator('[aria-current="step"]')).toContainText('canceled');
  });

  test('tenant is denied on the staff lease screens', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    await page.goto('/manager/leases');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
    await page.goto(leaseUrl);
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
    await page.goto('/owner/approvals');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
  });
});

test.describe('lease screens accessibility @a11y', () => {
  test('leases list and tenants list have no serious axe violations', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/leases');
    await expect(page.getByRole('heading', { name: 'Leases' })).toBeVisible();
    await noSeriousViolations(page);
    await page.goto('/manager/tenants');
    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
    await noSeriousViolations(page);
  });
  test('approvals queue has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.owner, /\/owner/);
    await page.goto('/owner/approvals');
    await expect(page.getByRole('heading', { name: 'Lease approvals' })).toBeVisible();
    await noSeriousViolations(page);
  });
});
