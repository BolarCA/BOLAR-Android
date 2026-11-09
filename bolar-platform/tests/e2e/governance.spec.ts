import { test, expect, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execSync } from 'node:child_process';
import { login, DEMO, DEMO_PASSWORD } from '../helpers/auth';

/**
 * Governance slice (Days 46-50): legal case workspace, legal holds, agency request review gate,
 * evidence packet export with manifest, privacy intake, restricted-portal gating and axe.
 */
const API = `http://localhost:${process.env.API_PORT ?? '4000'}`;
const SEEDED_CASE = 'Maple Court 101 - non-payment (demo)';

async function apiLogin(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/login`, { data: { email, password: DEMO_PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  const body = (await res.json()) as { accessToken: string };
  return { Authorization: `Bearer ${body.accessToken}` };
}

test.beforeAll(() => {
  // Idempotent governance demo data (seeded case with represents edge, hold, agency request, retention, privacy request).
  execSync('pnpm --filter @bolar/db exec dotenv -e ../../.env -- tsx seed/modules/governance.ts', { cwd: process.cwd(), stdio: 'inherit' });
});

test.describe('legal case workspace and legal holds @smoke', () => {
  test('lawyer opens a case linked to the seeded lease and places a legal hold on it', async ({ page, request }) => {
    const headers = await apiLogin(request, DEMO.lawyer);
    const cases = await (await request.get(`${API}/cases`, { headers })).json() as { items: { id: string; title: string; leaseId: string | null }[] };
    const seeded = cases.items.find((c) => c.title === SEEDED_CASE);
    expect(seeded?.leaseId, 'seeded case is linked to the demo lease').toBeTruthy();
    const leaseId = seeded!.leaseId!;

    await login(page, DEMO.lawyer, /\/legal/);
    await expect(page.getByRole('heading', { name: 'Legal case workspace' })).toBeVisible();
    await expect(page.getByRole('link', { name: SEEDED_CASE })).toBeVisible();
    await page.getByRole('button', { name: 'New case' }).click();
    const title = `E2E dispute ${Date.now()}`;
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Kind').selectOption('dispute');
    await dialog.getByLabel('Lease id').fill(leaseId);
    await dialog.getByRole('button', { name: 'Open case' }).click();
    await expect(page.getByText(`Case "${title}" opened`)).toBeVisible();
    await dialog.getByRole('link', { name: 'Open the case' }).click();
    await expect(page).toHaveURL(/\/legal\/cases\//);
    await expect(page.getByText('Privileged and confidential')).toBeVisible();
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    await page.getByRole('button', { name: 'Place legal hold' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Reason').fill('Anticipated litigation; preserve the lease file and communications.');
    await modal.getByLabel('Counsel approval note').fill('Scope approved by lead counsel.');
    await modal.getByRole('button', { name: 'Create hold' }).click();
    await expect(page.getByText('legal hold active')).toBeVisible();

    const check = await (await request.get(`${API}/legal-holds/check?resourceType=lease&resourceId=${leaseId}`, { headers })).json() as { held: boolean };
    expect(check.held).toBe(true);
    await page.goto('/legal/legal-holds');
    await expect(page.getByRole('heading', { name: 'Legal holds' })).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(`Hold: ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).toBeVisible();
  });
});

test.describe('agency request review gate @smoke', () => {
  test('government user submits a records request; counsel runs legal review and approves it', async ({ page }) => {
    await login(page, DEMO.gov, /\/gov/);
    await expect(page.getByRole('heading', { name: 'Agency requests' })).toBeVisible();
    await expect(page.getByText('Stored-data gate')).toBeVisible();
    const agency = `E2E Housing Board ${Date.now()}`;
    await page.getByLabel('Agency name').fill(agency);
    await page.getByLabel('Kind').selectOption('records');
    await page.getByLabel('Legal basis').fill('Municipal code 12.4 annual inspection records review.');
    await page.getByLabel('Scope description').fill('Inspection history for the current year only.');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await expect(page.getByText('Request submitted for legal review')).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(agency) })).toContainText('received');
    await page.getByRole('button', { name: 'Sign out' }).click();

    await login(page, DEMO.lawyer, /\/legal/);
    const row = page.getByRole('row', { name: new RegExp(agency) });
    await expect(row).toBeVisible();
    await row.getByLabel('Minimization notes').fill('Inspection records only; exclude tenant identities and payment history.');
    await row.getByRole('button', { name: `Legal review for ${agency}` }).click();
    await expect(row).toContainText('legal review');
    await row.getByLabel('Decision note').fill('Approved with minimization applied.');
    await row.getByRole('button', { name: `Approve ${agency}` }).click();
    await expect(row).toContainText('approved');
  });
});

test.describe('evidence packet export @smoke', () => {
  test('lawyer requests an export for the seeded case, a different approver releases it, and the manifest is shown', async ({ page, request }) => {
    await login(page, DEMO.lawyer, /\/legal/);
    await page.getByRole('link', { name: SEEDED_CASE }).click();
    await expect(page.getByText('Privileged and confidential')).toBeVisible();
    await page.getByRole('button', { name: 'Request export' }).click();
    await expect(page.getByText('Awaiting a different approver')).toBeVisible();

    const caseId = page.url().split('/').pop()!;
    const admin = await apiLogin(request, DEMO.orgAdmin);
    const jobs = await (await request.get(`${API}/exports?sourceType=case&sourceId=${caseId}&status=requested`, { headers: admin })).json() as { items: { id: string }[] };
    expect(jobs.items.length).toBeGreaterThan(0);
    const approve = await request.post(`${API}/exports/${jobs.items[0]!.id}/approve`, { headers: admin, data: { note: 'Reviewed for the hearing; approved by org admin.' } });
    expect(approve.ok()).toBeTruthy();

    await page.reload();
    const manifest = page.getByTestId('export-manifest').first();
    await expect(manifest).toBeVisible();
    await expect(manifest).toContainText('sha256');
    await expect(manifest.getByRole('link', { name: 'Download manifest' })).toBeVisible();
  });
});

test.describe('privacy intake @smoke', () => {
  test('a public deletion request reaches the legal privacy queue with its SLA', async ({ page, request }) => {
    const email = `subject.${Date.now()}@demo.bolar.test`;
    const intake = await request.post(`${API}/privacy-requests/intake`, { data: { orgSlug: 'demo-pm', kind: 'deletion', email } });
    expect(intake.status()).toBe(201);
    const body = (await intake.json()) as { status: string; verificationUrl: string | null };
    expect(body.status).toBe('identity_verification');
    expect(body.verificationUrl).toContain('mock.id.me');

    await login(page, DEMO.lawyer, /\/legal/);
    await page.goto('/legal/privacy-requests');
    await expect(page.getByRole('heading', { name: 'Privacy requests' })).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row).toContainText('deletion');
    await expect(row).toContainText('identity verification');
    await expect(row).toContainText(/\d+d left/);
    await row.getByRole('button', { name: `Open deletion request from ${email}` }).click();
    await expect(page.getByRole('dialog')).toContainText('Discovery unlocks once the subject completes identity verification');
  });
});

test.describe('restricted portal gating @smoke', () => {
  test('tenant is denied on /legal and /gov without fetching governance data', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    const requests: string[] = [];
    page.on('request', (r) => { if (r.url().includes(`:${process.env.API_PORT ?? '4000'}/`) && !r.url().includes('/me')) requests.push(r.url()); });
    await page.goto('/legal');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
    await page.goto('/gov');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
    expect(requests.filter((u) => /\/(cases|legal-holds|agency-requests|exports|privacy-requests)/.test(u))).toHaveLength(0);
  });
  test('government user cannot open the legal workspace', async ({ page }) => {
    await login(page, DEMO.gov, /\/gov/);
    await page.goto('/legal');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
  });
});

test.describe('accessibility @a11y', () => {
  test('legal case workspace has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.lawyer, /\/legal/);
    await expect(page.getByRole('heading', { name: 'Legal case workspace' })).toBeVisible();
    await expect(page.getByRole('link', { name: SEEDED_CASE })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
  test('government restricted portal has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.gov, /\/gov/);
    await expect(page.getByRole('heading', { name: 'Agency requests' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
