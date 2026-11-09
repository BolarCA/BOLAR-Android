import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO, DEMO_PASSWORD } from '../helpers/auth';

const API_URL = `http://localhost:${process.env.API_PORT ?? '4000'}`;

/** The shell sidebar takes over at the `lg` breakpoint (1024px); below it the resident portal shows the bottom bar. */
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024;

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
}

/** A property created by the manager with no owner relationship: the landlord must not be able to open it. */
async function createUnownedProperty(request: APIRequestContext) {
  const res = await request.post(`${API_URL}/auth/login`, { data: { email: DEMO.manager, password: DEMO_PASSWORD } });
  expect(res.ok()).toBeTruthy();
  const { accessToken } = (await res.json()) as { accessToken: string };
  const created = await request.post(`${API_URL}/properties`, { headers: { Authorization: `Bearer ${accessToken}` }, data: { name: `E2E Not Yours ${Date.now()}`, addressLine1: '1 Denied Way', city: 'Dallas', state: 'TX', postalCode: '75201', status: 'active' } });
  expect(created.status()).toBe(201);
  return (await created.json()) as { id: string; name: string };
}

test.describe('tenant mobile home (Day 52) @smoke', () => {
  test('home shows the property card, balance, pending maintenance, documents and the bottom nav @mobile', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant$/);
    await expect(page.getByRole('heading', { name: /^Hi, / })).toBeVisible();

    // property card from the party-scoped lease
    const property = page.getByTestId('property-card');
    await expect(property).toContainText('Maple Court Apartments');
    await expect(property).toContainText('Unit 101');

    // balance from open invoices: the seeded demo has one open invoice, so a positive amount with a pay CTA
    const balance = page.getByTestId('home-balance');
    await expect(balance).toBeVisible();
    expect(Number(await balance.getAttribute('data-cents'))).toBeGreaterThan(0);
    await expect(balance).toHaveAttribute('data-state', /due|overdue/);
    await expect(page.getByTestId('pay-cta')).toBeVisible();

    // pending maintenance count = open work orders requested by the tenant
    const pending = page.getByTestId('maintenance-pending-count');
    await expect(pending).toBeVisible();
    expect(Number(await pending.getAttribute('data-count'))).toBeGreaterThan(0);

    // documents section with the lease agreement; it is confidential, so the restricted (lock) state shows a request-access link
    const docs = page.getByTestId('home-documents');
    await expect(docs).toContainText('Residential Lease Agreement');
    await expect(docs.getByTestId('home-document').first()).toHaveAttribute('data-gated', 'true');
    await expect(docs.getByRole('link', { name: /Request access to Residential Lease Agreement/ })).toBeVisible();

    // notices and messages sections render (seed has in-app messages, no formal notices)
    await expect(page.getByTestId('home-notices')).toBeVisible();
    await expect(page.getByTestId('home-messages')).toContainText('INV-000001');

    const bottomNav = page.getByRole('navigation', { name: 'Resident' });
    if (isMobile(page)) {
      await expect(bottomNav).toBeVisible();
      await expect(bottomNav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
      for (const label of ['Home', 'Pay', 'Maintenance', 'Documents', 'Profile']) {
        const box = await bottomNav.getByRole('link', { name: label }).boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44); // large tap targets
      }
    } else {
      await expect(bottomNav).toBeHidden();
      await expect(page.getByRole('navigation', { name: 'Primary' })).toContainText('Pay rent');
    }
  });

  test('tenant navigates with the bottom nav to Pay rent and back home @mobile', async ({ page }) => {
    test.skip(!isMobile(page), 'the bottom navigation only renders below the lg breakpoint');
    await login(page, DEMO.tenant, /\/tenant$/);
    const bottomNav = page.getByRole('navigation', { name: 'Resident' });
    await bottomNav.getByRole('link', { name: 'Pay' }).click();
    await expect(page).toHaveURL(/\/tenant\/pay$/);
    await expect(page.getByRole('heading', { name: 'Pay rent' })).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: 'Pay' })).toHaveAttribute('aria-current', 'page');
    // Back home via the keyboard: it proves the tabs are focusable, and the Next.js dev-overlay button sits over the
    // bottom-left corner of the Pixel 7 viewport in dev mode, which would intercept a pointer tap on the Home tab.
    await bottomNav.getByRole('link', { name: 'Home' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/tenant$/);
    await expect(page.getByTestId('property-card')).toBeVisible();
    await expect(bottomNav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  test('tenant profile shows account, MFA status and own contact details', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant$/);
    await page.goto('/tenant/profile');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
    await expect(page.getByTestId('mfa-status')).toHaveAttribute('data-enabled', /true|false/);
    await expect(page.getByTestId('tenant-profile')).toContainText('tenant@demo.bolar.test');
    await expect(page.getByRole('heading', { name: 'Emergency contacts' })).toBeVisible();
  });
});

test.describe('landlord portfolio dashboard (Day 53) @smoke', () => {
  test('owner sees KPI cards for 3 properties and the approvals inbox with the seeded review lease', async ({ page }) => {
    await login(page, DEMO.owner, /\/owner$/);
    await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
    await expect(page.getByTestId('kpi-properties')).toHaveAttribute('data-value', '3');
    expect(Number(await page.getByTestId('kpi-units').getAttribute('data-value'))).toBeGreaterThan(0);
    await expect(page.getByTestId('kpi-occupancy')).toContainText('%');
    expect(Number(await page.getByTestId('kpi-approvals').getAttribute('data-value'))).toBeGreaterThanOrEqual(1);
    // finance KPIs render because the landlord holds finance:read (figures are computed from relationship-scoped invoices/payments)
    await expect(page.getByTestId('kpi-collected')).toContainText('$');
    await expect(page.getByTestId('kpi-overdue')).toContainText('$');
    await expect(page.getByTestId('kpi-maintenance')).toContainText('$');

    // property cards with occupancy bars
    const list = page.getByTestId('portfolio-properties');
    for (const name of ['Maple Court Apartments', 'Riverside Lofts', 'Sunset Bungalows']) await expect(list.getByRole('link', { name })).toBeVisible();
    expect(await list.getByRole('progressbar').count()).toBe(3);
    await expect(page.getByTestId('map-placeholder')).toContainText('reporting phase');

    // approvals inbox: the seeded "Ava Applicant" lease on Maple Court 102
    const inbox = page.getByTestId('approvals-inbox');
    await expect(inbox).toContainText('Ava Applicant');
    await expect(inbox).toContainText('Maple Court Apartments · Unit 102');
    await expect(page.getByRole('link', { name: 'Review and approve' })).toHaveAttribute('href', '/owner/approvals');
  });

  test('owner opening a property they do not own sees the denied state', async ({ page, request }) => {
    const other = await createUnownedProperty(request);
    await login(page, DEMO.owner, /\/owner$/);
    // not in the portfolio list
    await expect(page.getByTestId('kpi-properties')).toHaveAttribute('data-value', '3');
    await expect(page.getByTestId('portfolio-properties')).not.toContainText(other.name);
    // direct navigation answers with the denied state (API returns 404 so existence is not leaked)
    await page.goto(`/owner/properties/${other.id}`);
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: other.name })).toHaveCount(0);
  });
});

test.describe('portal home accessibility @a11y', () => {
  test('tenant home has no serious axe violations @mobile', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant$/);
    await expect(page.getByTestId('home-balance')).toBeVisible();
    await expect(page.getByTestId('home-documents')).toContainText('Residential Lease Agreement');
    await axeClean(page);
  });

  test('owner dashboard has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.owner, /\/owner$/);
    await expect(page.getByTestId('kpi-properties')).toHaveAttribute('data-value', '3');
    await expect(page.getByTestId('approvals-inbox')).toContainText('Ava Applicant');
    await axeClean(page);
  });
});
