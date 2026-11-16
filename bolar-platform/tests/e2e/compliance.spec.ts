import { test, expect, type Locator, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO, DEMO_PASSWORD } from '../helpers/auth';

const API_URL = `http://localhost:${process.env.API_PORT ?? '4000'}`;

/** Select the <option> whose text contains `text` once the lookups have loaded. */
async function selectByText(select: Locator, text: string) {
  const option = select.locator('option', { hasText: text });
  await expect(option).toBeAttached();
  await select.selectOption((await option.getAttribute('value'))!);
}

/** Raise a source-of-income guard hit through the API so the officer queue always has an unresolved item. */
async function raiseGuardHit(request: APIRequestContext) {
  const login = await request.post(`${API_URL}/auth/login`, { data: { email: DEMO.manager, password: DEMO_PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const { accessToken } = (await login.json()) as { accessToken: string };
  const res = await request.post(`${API_URL}/compliance/screen-text`, { headers: { Authorization: `Bearer ${accessToken}` }, data: { text: 'Bright loft, no vouchers accepted.', resourceType: 'listing', resourceId: `e2e-listing-${Date.now()}` } });
  expect(res.status()).toBe(201);
}

/**
 * Compliance slice (Days 41-45, 58): consent-gated screening with a human decision and adverse action, the compliance
 * review queue, the fair-housing/SOI guard on notices, a denied role and an axe pass on the queue.
 */

test.describe('screening journey (manager) @smoke', () => {
  test('consent gate blocks ordering, mock screening runs, report is review-required, denial opens adverse action', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/applications');
    await expect(page.getByRole('heading', { name: 'Applications and screening' })).toBeVisible();
    await page.getByRole('button', { name: 'New application' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Property').selectOption({ index: 1 });
    await selectByText(dialog.getByLabel('Applicant'), 'Theo Tenant');
    await dialog.getByRole('button', { name: 'Create application' }).click();
    const detail = page.getByTestId('application-detail');
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: 'Submit application' }).click();
    await expect(detail).toContainText('submitted');
    // Ordering before consent is blocked by the FCRA rule (409 with the rule key in the message)
    await detail.getByRole('button', { name: 'Order screening' }).click();
    await expect(detail.getByRole('alert')).toContainText('us.fcra.consent_before_screening');
    await detail.getByRole('button', { name: 'Record applicant consent' }).click();
    await expect(detail).toContainText(/consent \d/);
    await detail.getByRole('button', { name: 'Order screening' }).click();
    await expect(detail).toContainText('ordered');
    await detail.getByRole('button', { name: 'Run screening (mock provider)' }).click();
    await expect(detail).toContainText('completed');
    await expect(detail).toContainText('review');
    // Raw report is restricted: the manager sees the review-required state, never the summary
    await detail.getByRole('button', { name: 'View report (restricted)' }).click();
    await expect(page.locator('[data-state="review-required"]')).toBeVisible();
    await expect(detail).not.toContainText('Recommendation');
    // Human decision -> adverse action created with reason codes and a waiting period
    await detail.getByRole('button', { name: 'Record decision' }).click();
    const modal = page.getByRole('dialog', { name: 'Record decision' });
    await modal.getByLabel('Decision').selectOption('denied');
    await modal.getByLabel('credit history').check();
    await modal.getByRole('button', { name: 'Confirm decision' }).click();
    await expect(page.getByTestId('adverse-action')).toContainText('pre adverse');
    await expect(page.getByTestId('adverse-action')).toContainText('Waiting period ends');
    await expect(page.getByTestId('adverse-action')).toContainText('credit history');
  });

  test('manager drafts a notice with source-of-income language and sees the guard hit', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/notices');
    await expect(page.getByRole('heading', { name: 'Notices' })).toBeVisible();
    await page.getByRole('button', { name: 'Draft notice' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Template').selectOption('notice.general');
    await selectByText(dialog.getByLabel('Recipient'), 'Theo Tenant');
    await dialog.getByLabel('Body').fill('Reminder for all residents: no section 8 vouchers are accepted in this building.');
    await dialog.getByRole('button', { name: 'Save draft' }).click();
    const hits = page.getByTestId('guard-hits');
    await expect(hits).toContainText('no section 8');
    await expect(hits).toContainText('us.soi.voucher_refusal');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('row', { name: /Theo Tenant/ }).first()).toContainText(/hit/);
  });
});

test.describe('compliance officer queue @smoke', () => {
  test('sees rule hits with severity and evidence, resolves one, exports the manifest', async ({ page, request }) => {
    await raiseGuardHit(request);
    await login(page, DEMO.compliance, /\/compliance/);
    await expect(page.getByRole('heading', { name: 'Compliance review queue' })).toBeVisible();
    const row = page.getByRole('row', { name: /us\.fcra\.consent_before_screening|us\.soi\.voucher_refusal/ }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /^Evidence for/ }).click();
    const drawer = page.getByTestId('evidence-drawer');
    await expect(drawer).toContainText('Conditions matched');
    await expect(drawer.getByRole('link')).toHaveAttribute('href', /https:\/\//);
    await page.getByRole('button', { name: 'Close panel' }).click();
    const key = (await row.locator('code').first().textContent())!;
    await row.getByRole('button', { name: /^Accept/ }).click();
    await page.getByTestId('resolve-note').fill('Reviewed with the manager; consent form now on file.');
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-manifest').click();
    expect((await download).suggestedFilename()).toMatch(/compliance-manifest-.*\.json/);
    expect(key).toMatch(/^us/);
  });

  test('rules catalog lists versions grouped by jurisdiction', async ({ page }) => {
    await login(page, DEMO.compliance, /\/compliance/);
    await page.goto('/compliance/rules');
    await expect(page.getByRole('heading', { name: 'Compliance rules' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'US-CA' })).toBeVisible();
    await expect(page.getByText('us-ca.deposit.max_one_month')).toBeVisible();
  });
});

test.describe('denied @smoke', () => {
  test('vendor cannot enter the compliance portal', async ({ page }) => {
    await login(page, DEMO.vendor, /\/vendor/);
    await page.goto('/compliance');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
  });
});

test.describe('accessibility @a11y', () => {
  test('compliance review queue has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.compliance, /\/compliance/);
    await expect(page.getByRole('heading', { name: 'Compliance review queue' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
