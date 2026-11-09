import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO, DEMO_PASSWORD } from '../helpers/auth';

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

test.describe('login-time MFA step-up @smoke', () => {
  test('a user with MFA enabled is asked for a code after password and lands in their portal', async ({ page, request }) => {
    // Set up a dedicated staff user through the API so other specs are unaffected.
    const api = 'http://localhost:' + (process.env.API_PORT ?? '4000');
    const adminLogin = await request.post(`${api}/auth/login`, { data: { email: DEMO.orgAdmin, password: DEMO_PASSWORD } });
    const adminToken = (await adminLogin.json()).accessToken as string;
    const email = `mfa.${Date.now()}@demo.bolar.test`;
    const invite = await request.post(`${api}/invitations`, { headers: { Authorization: `Bearer ${adminToken}` }, data: { email, role: 'bookkeeper' } });
    const token = new URL((await invite.json()).acceptUrl).searchParams.get('token')!;
    await request.post(`${api}/invitations/accept`, { data: { token, name: 'Mia Mfa', password: 'LongEnoughPassword1!' } });
    const login = await request.post(`${api}/auth/login`, { data: { email, password: 'LongEnoughPassword1!' } });
    const userToken = (await login.json()).accessToken as string;
    const setup = await request.post(`${api}/auth/mfa/setup`, { headers: { Authorization: `Bearer ${userToken}` } });
    const secret = (await setup.json()).secret as string;
    await request.post(`${api}/auth/mfa/verify`, { headers: { Authorization: `Bearer ${userToken}` }, data: { code: totp(secret) } });

    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('LongEnoughPassword1!');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByLabel('Verification code')).toBeVisible();
    await page.getByLabel('Verification code').fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(page).toHaveURL(/\/finance/, { timeout: 20_000 });
  });
});

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) mirroring packages/api/src/shared/totp.ts. */
function totp(secretB32: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const bytes: number[] = [];
  for (const c of secretB32.toUpperCase()) { const i = alphabet.indexOf(c); if (i < 0) continue; value = (value << 5) | i; bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const counter = Math.floor(Date.now() / 30_000);
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const code = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}
