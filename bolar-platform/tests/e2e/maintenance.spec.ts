import { test, expect, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO, DEMO_PASSWORD } from '../helpers/auth';

const API_URL = `http://localhost:${process.env.API_PORT ?? '4000'}`;
const RUN = Date.now();
const TITLE = `E2E burst pipe under sink ${RUN}`;
const VENDOR_NAME = 'Vera Vendor Plumbing LLC';

async function apiToken(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API_URL}/auth/login`, { data: { email, password: DEMO_PASSWORD } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { accessToken: string }).accessToken;
}

test.describe.configure({ mode: 'serial' });

test.describe('maintenance: request -> triage -> assign -> schedule -> vendor starts (Days 31-35) @smoke', () => {
  let workOrderId = '';

  test('tenant submits an emergency request and sees the confirmation with a request number', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    await page.goto('/tenant/maintenance');
    await expect(page.getByRole('heading', { name: 'Maintenance' })).toBeVisible();
    await page.getByLabel('Title').fill(TITLE);
    await page.getByLabel('Category').selectOption('plumbing');
    await page.getByLabel('Priority').selectOption('emergency');
    await expect(page.locator('#priority-guidance')).toContainText(/24 hours/);
    await page.getByLabel('Description').fill('Pipe under the kitchen sink burst, water spreading across the floor into the hallway.');
    await page.getByLabel('Entry permission').selectOption('granted');
    await page.getByRole('button', { name: 'Submit request' }).click();
    const confirmation = page.locator('[data-state="confirmation"]');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(/Request WO-[A-Z0-9]{6} received/);
    await expect(confirmation).toContainText(/Target response: within/);
    await expect(confirmation).toContainText(/call 911/);
    // the new request shows in "My requests" with its status
    const row = page.getByRole('row', { name: new RegExp(TITLE) });
    await expect(row).toContainText('new');
  });

  test('manager triages, assigns the demo vendor from the eligible list and schedules the visit', async ({ page, request }) => {
    const token = await apiToken(request, DEMO.manager);
    const list = await request.get(`${API_URL}/work-orders?q=${encodeURIComponent(String(RUN))}&limit=10`, { headers: { Authorization: `Bearer ${token}` } });
    const items = ((await list.json()) as { items: { id: string; title: string }[] }).items;
    workOrderId = items.find((w) => w.title === TITLE)!.id;

    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/maintenance');
    await expect(page.getByRole('heading', { name: 'Maintenance board' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'New lane' })).toBeVisible();
    const card = page.getByRole('button', { name: new RegExp(`^${TITLE}, emergency priority, new$`) });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Due in|Overdue/);
    await card.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: TITLE })).toBeVisible();
    await dialog.getByRole('button', { name: 'Triage' }).click();
    await expect(dialog.getByRole('heading', { name: 'Assign vendor' })).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Vendor', exact: true }).selectOption({ label: VENDOR_NAME });
    await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(dialog.getByText(VENDOR_NAME).first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Schedule' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Schedule' }).click();
    const when = new Date(Date.now() + 20 * 3_600_000);
    const local = new Date(when.getTime() - when.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await dialog.getByLabel('Scheduled for').fill(local);
    await dialog.getByRole('button', { name: /Confirm schedule/ }).click();
    await expect(dialog.getByRole('button', { name: 'Start work' })).toBeVisible();
    await expect(dialog.getByText(/Status assigned → scheduled/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('region', { name: 'Scheduled lane' })).toContainText(TITLE);
  });

  test('vendor sees the job in /vendor and moves it to in progress', async ({ page }) => {
    await login(page, DEMO.vendor, /\/vendor/);
    await expect(page.getByRole('heading', { name: 'My jobs' })).toBeVisible();
    const row = page.getByRole('row', { name: new RegExp(TITLE) });
    await expect(row).toContainText('scheduled');
    await row.getByRole('link', { name: TITLE, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/vendor/jobs/${workOrderId}`));
    await page.getByRole('button', { name: 'Start work' }).click();
    await expect(page.getByRole('button', { name: 'Mark blocked' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit for review' })).toBeVisible();
    await expect(page.getByText(/Status scheduled → in_progress/)).toBeVisible();
    // vendors never get manager-only actions
    await expect(page.getByRole('button', { name: 'Mark complete' })).toHaveCount(0);
  });

  test('vendor cannot open a work order that is not assigned to them (denied state)', async ({ page, request }) => {
    const token = await apiToken(request, DEMO.manager);
    const list = await request.get(`${API_URL}/work-orders?status=new,triaged&limit=50`, { headers: { Authorization: `Bearer ${token}` } });
    const unassigned = ((await list.json()) as { items: { id: string; assignedVendorId: string | null }[] }).items.find((w) => !w.assignedVendorId);
    expect(unassigned).toBeTruthy();
    await login(page, DEMO.vendor, /\/vendor/);
    await page.goto(`/vendor/jobs/${unassigned!.id}`);
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start work' })).toHaveCount(0);
  });

  test('tenant cannot enter the manager maintenance board', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    await page.goto('/manager/maintenance');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
  });
});

test.describe('maintenance accessibility @a11y', () => {
  test('maintenance board has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await page.goto('/manager/maintenance');
    await expect(page.getByRole('heading', { name: 'Maintenance board' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'New lane' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });

  test('tenant intake form has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    await page.goto('/tenant/maintenance');
    await expect(page.getByRole('heading', { name: 'New request' })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
