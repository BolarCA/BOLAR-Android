import { test, expect, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO, DEMO_PASSWORD } from '../helpers/auth';

const API_URL = `http://localhost:${process.env.API_PORT ?? '4000'}`;

async function apiToken(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API_URL}/auth/login`, { data: { email, password: DEMO_PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).accessToken as string;
}

test.describe('documents (Days 26/30) @smoke', () => {
  test('manager uploads a document through the UI, downloads it via a signed link; tampered and expired links are 404', async ({ page, request }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/documents');
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
    await page.getByRole('button', { name: 'Upload document' }).click();
    const dialog = page.getByRole('dialog');
    const title = `E2E move-in checklist ${Date.now()}`;
    await dialog.getByLabel('Title', { exact: true }).fill(title);
    await dialog.getByLabel('Linked to').selectOption('org');
    await dialog.getByLabel('Category').selectOption('general');
    await dialog.locator('#upload-file').setInputFiles({ name: 'checklist.txt', mimeType: 'text/plain', buffer: Buffer.from('Move-in checklist: keys, smoke detector, meter reading.\n') });
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(dialog.getByText(`Uploaded "${title}"`)).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText('clean')).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    const row = page.getByRole('row', { name: new RegExp(title) });
    await expect(row).toContainText('ready');
    await row.getByRole('button', { name: `Download ${title}` }).click();
    const link = row.getByRole('link', { name: 'Open signed link' });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href'))!;
    expect(href).toContain('/storage/object?');

    const ok = await request.get(href);
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toContain('Move-in checklist');
    const tampered = new URL(href); tampered.searchParams.set('sig', 'f'.repeat(64));
    expect((await request.get(tampered.toString())).status()).toBe(404);
    const expired = new URL(href); expired.searchParams.set('exp', String(Math.floor(Date.now() / 1000) - 120));
    expect((await request.get(expired.toString())).status()).toBe(404);
  });

  test('tenant sees the lease document in their documents page with messages inbox', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    await page.goto('/tenant/documents');
    await expect(page.getByRole('heading', { name: 'My documents' })).toBeVisible();
    const row = page.getByRole('row', { name: /Residential Lease Agreement/ });
    await expect(row).toBeVisible();
    await expect(row).toContainText('confidential');
    await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible();
  });

  test('vendor is denied on the manager documents page', async ({ page }) => {
    await login(page, DEMO.vendor, /\/vendor/);
    await page.goto('/manager/documents');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
  });
});

test.describe('templates (Day 29) @smoke', () => {
  test('manager drafts and submits a high-risk template; legal approves; manager sees it approved and renders it', async ({ page, request }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/templates');
    await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible();
    await expect(page.getByRole('row', { name: /invite\.staff/ })).toBeVisible();

    const key = `notice.e2e_${Date.now()}`;
    await page.getByRole('button', { name: 'New template' }).click();
    const create = page.getByRole('dialog');
    await create.locator('#new-template-key').fill(key);
    await create.locator('#new-template-name').fill('E2E late rent notice');
    await create.getByLabel('Channel').selectOption('notice');
    await create.getByLabel('Risk level').selectOption('high');
    await create.locator('#new-template-subject').fill('Notice of late rent');
    await create.locator('#new-template-body').fill('Dear {{tenantName}}, rent of {{amount}} is late.');
    await create.getByRole('button', { name: 'Create draft' }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('heading', { name: 'E2E late rent notice' })).toBeVisible();
    await expect(drawer.getByTestId('version-body')).toContainText('Dear {{tenantName}}');
    await drawer.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(drawer.getByText('Awaiting approval')).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Approve' })).toHaveCount(0);

    // Legal approves through the API (second person with template:approve).
    const lawyer = await apiToken(request, DEMO.lawyer);
    const list = await request.get(`${API_URL}/templates?q=${key}`, { headers: { Authorization: `Bearer ${lawyer}` } });
    const tpl = (await list.json()).items[0];
    const detail = await (await request.get(`${API_URL}/templates/${tpl.id}`, { headers: { Authorization: `Bearer ${lawyer}` } })).json();
    const pending = detail.versions.find((v: { status: string }) => v.status === 'pending_approval');
    const approved = await request.post(`${API_URL}/templates/${tpl.id}/versions/${pending.id}/approve`, { headers: { Authorization: `Bearer ${lawyer}` }, data: { note: 'e2e approval' } });
    expect(approved.status()).toBe(200);

    await page.reload();
    const row = page.getByRole('row', { name: new RegExp(key) });
    await expect(row).toContainText('approved');
    await row.getByRole('button', { name: 'Open E2E late rent notice' }).click();
    const opened = page.getByRole('dialog');
    await opened.getByLabel('tenantName').fill('Theo');
    await opened.getByLabel('amount').fill('$1,450');
    await opened.getByRole('button', { name: 'Render' }).click();
    await expect(opened.getByTestId('render-output')).toContainText('Dear Theo, rent of $1,450 is late.');
  });
});

test.describe('accessibility @a11y', () => {
  test('manager documents page has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/documents');
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
