import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO } from '../helpers/auth';

test.describe('authentication and portal gating @smoke', () => {
  test('anonymous users are redirected to login', async ({ page }) => {
    await page.goto('/manager');
    await expect(page).toHaveURL(/\/login/);
  });

  test('manager lands in the manager portal and sees its navigation', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await expect(page.getByRole('navigation', { name: 'Primary' })).toContainText('Property manager');
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('tenant cannot enter the manager portal (denied state, no data fetched)', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    const requests: string[] = [];
    page.on('request', (r) => { if (r.url().includes(':4000/') && !r.url().includes('/me')) requests.push(r.url()); });
    await page.goto('/manager');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
    expect(requests.filter((u) => /\/(properties|work-orders|leases)/.test(u))).toHaveLength(0);
  });

  test('wrong password shows one generic error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(DEMO.manager);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('#login-error')).toContainText(/Invalid email, password, or organization/);
  });

  test('sign out returns to login and protected pages redirect again', async ({ page }) => {
    await login(page, DEMO.owner, /\/owner/);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/owner');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('staff administration (Day 11) @smoke', () => {
  test('org admin invites a user, sees it pending, then revokes it', async ({ page }) => {
    await login(page, DEMO.orgAdmin, /\/subaccount/);
    await page.goto('/subaccount/users');
    await expect(page.getByRole('heading', { name: 'Staff and roles' })).toBeVisible();
    await page.getByRole('button', { name: 'Invite user' }).click();
    const email = `e2e.${Date.now()}@demo.bolar.test`;
    await page.getByRole('dialog').getByLabel('Email').fill(email);
    await page.getByRole('dialog').getByLabel('Role').selectOption('property_manager');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row).toContainText('pending');
    await row.getByRole('button', { name: `Revoke invitation for ${email}` }).click();
    await expect(row).toContainText('revoked');
  });

  test('tenant role is denied on the users page', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    await page.goto('/subaccount/users');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
  });
});

test.describe('accessibility @a11y', () => {
  test('login page has no serious axe violations', async ({ page }) => {
    await page.goto('/login');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
  test('users admin page has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.orgAdmin, /\/subaccount/);
    await page.goto('/subaccount/users');
    await expect(page.getByRole('heading', { name: 'Staff and roles' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
