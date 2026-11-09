import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO } from '../helpers/auth';

/** `YYYY-MM` for the first of the month `offset` months from now (UTC). */
function period(offset: number): string {
  const d = new Date();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function generateFor(page: Page, p: string): Promise<{ created: number; skipped: number }> {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Period (YYYY-MM)').fill(p);
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes('/invoices/generate') && r.request().method() === 'POST'), dialog.getByRole('button', { name: 'Generate' }).click()]);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { created: number; skipped: number };
  await expect(dialog.getByTestId('generate-result')).toHaveAttribute('data-created', String(body.created));
  return body;
}

test.describe('finance: bookkeeper and resident journeys (Days 36-40) @smoke', () => {
  test('bookkeeper generates rent invoices for an upcoming period and sees the created count; re-running skips', async ({ page }) => {
    await login(page, DEMO.bookkeeper, /\/finance/);
    await page.goto('/finance/invoices');
    await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
    await page.getByRole('button', { name: 'Generate invoices' }).click();
    // The demo lease runs six months ahead; pick the first upcoming period that has no invoice yet.
    let created = 0;
    let chosen = period(2);
    for (const offset of [2, 3, 4, 5]) {
      chosen = period(offset);
      const r = await generateFor(page, chosen);
      created = r.created;
      if (created > 0) break;
    }
    expect(created).toBeGreaterThan(0);
    await expect(page.getByRole('dialog').getByText(`Created ${created} invoice`)).toBeVisible();
    // idempotent per lease + period
    const again = await generateFor(page, chosen);
    expect(again.created).toBe(0);
    expect(again.skipped).toBeGreaterThanOrEqual(1);
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('table', { name: 'Invoices' })).toContainText('INV-');
    await expect(page.getByRole('table', { name: 'Invoices' })).toContainText('Theo Tenant');
  });

  test('tenant pays an open invoice from Pay rent and sees it paid', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    await page.goto('/tenant/pay');
    await expect(page.getByRole('heading', { name: 'Pay rent' })).toBeVisible();
    const balance = page.getByTestId('tenant-balance');
    await expect(balance).toBeVisible();
    const before = Number(await balance.getAttribute('data-cents'));
    expect(before).toBeGreaterThan(0); // the bookkeeper test above issued an invoice for this lease
    const firstPay = page.getByRole('button', { name: /^Pay invoice INV-/ }).first();
    const invoiceNumber = (await firstPay.getAttribute('aria-label'))!.replace('Pay invoice ', '');
    await firstPay.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: `Pay ${invoiceNumber}` })).toBeVisible();
    await expect(dialog.getByLabel('Card number')).toHaveValue('4242 4242 4242 4242');
    await dialog.getByRole('button', { name: /^Pay \$/ }).click();
    await expect(dialog.locator('[data-state="payment-success"]')).toBeVisible();
    await expect(dialog.getByText('Payment received')).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect.poll(async () => Number(await page.getByTestId('tenant-balance').getAttribute('data-cents'))).toBeLessThan(before);
    const history = page.getByRole('table', { name: 'Payment history' });
    await expect(history).toContainText(invoiceNumber);
    await expect(history.getByRole('row', { name: new RegExp(invoiceNumber) }).first()).toContainText('succeeded');
  });

  test('bookkeeper sees a balanced trial balance and a green double-entry proof', async ({ page }) => {
    await login(page, DEMO.bookkeeper, /\/finance/);
    await expect(page.getByRole('heading', { name: 'Ledger dashboard' })).toBeVisible();
    const proof = page.getByTestId('ledger-proof');
    await expect(proof).toBeVisible();
    await expect(proof).toHaveAttribute('data-state', 'balanced');
    await expect(proof).toContainText('Ledger balances');
    await expect(page.getByTestId('finance-kpis')).toContainText('Balanced');
    await page.goto('/finance/ledger');
    await expect(page.getByRole('heading', { name: 'Ledger' })).toBeVisible();
    await expect(page.getByTestId('trial-balance-status')).toHaveText('Balanced');
    await expect(page.getByRole('table', { name: 'Trial balance' })).toContainText('Accounts Receivable');
    await expect(page.getByRole('table', { name: 'Journal entries' })).toContainText('payment');
  });

  test('vendor is denied on the finance portal', async ({ page }) => {
    await login(page, DEMO.vendor, /\/vendor/);
    const requests: string[] = [];
    page.on('request', (r) => { if (/\/(finance\/summary|ledger|invoices|payments)/.test(r.url())) requests.push(r.url()); });
    await page.goto('/finance');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
    expect(requests).toHaveLength(0);
  });
});

test.describe('finance accessibility @a11y', () => {
  test('ledger dashboard has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.bookkeeper, /\/finance/);
    await expect(page.getByRole('heading', { name: 'Ledger dashboard' })).toBeVisible();
    await expect(page.getByTestId('ledger-proof')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
  test('resident pay rent screen has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    await page.goto('/tenant/pay');
    await expect(page.getByTestId('tenant-balance')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
