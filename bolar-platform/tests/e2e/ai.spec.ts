import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO } from '../helpers/auth';

/**
 * AI assistant slice (Days 61-74): the manager opens the assistant from a lease page and gets a cited summary; asks for a
 * late-rent notice draft and lands in the notices queue where the draft waits for approval; the vendor has no assistant
 * button; the compliance officer reviews the manager's commands on the AI audit page; axe runs on the drawer and the
 * audit page. Runs against the mock provider (ANTHROPIC_MODE=mock), so answers are deterministic.
 */
async function noSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
}

async function openLeasePage(page: Page): Promise<string> {
  await page.goto('/manager/leases');
  await expect(page.getByRole('heading', { name: 'Leases' })).toBeVisible();
  await page.getByRole('link', { name: /Maple Court Apartments · 101/ }).first().click();
  await expect(page).toHaveURL(/\/manager\/leases\/[a-z0-9]+/);
  return page.url().split('/manager/leases/')[1]!.split(/[?#]/)[0]!;
}

async function ask(page: Page, command: string) {
  const dialog = page.getByRole('dialog', { name: 'Assistant' });
  await dialog.getByLabel('Ask the assistant').fill(command);
  await dialog.getByRole('button', { name: 'Send' }).click();
  return dialog;
}

test.describe.configure({ mode: 'serial' });

test.describe('AI assistant @smoke', () => {
  test('manager opens the assistant from a lease page and gets a cited summary', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    const leaseId = await openLeasePage(page);
    await page.getByRole('button', { name: 'Open assistant' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assistant' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Context: lease/)).toBeVisible();
    await expect(dialog.getByTestId('ai-budget')).toBeVisible();
    await ask(page, 'Summarize this lease');
    const answer = dialog.locator('[data-role="assistant"]').last();
    await expect(answer).toContainText('Lease summary', { timeout: 20_000 });
    await expect(answer).toContainText('monthly rent');
    await expect(answer.getByText('summarize_lease · ok')).toBeVisible();
    const source = answer.getByRole('list', { name: 'Sources' }).getByRole('link').first();
    await expect(source).toHaveAttribute('href', new RegExp(`/manager/leases/${leaseId}`));
    // No send/approve controls exist in the assistant.
    await expect(dialog.getByRole('button', { name: /approve|send notice/i })).toHaveCount(0);
  });

  test('manager asks for a late-rent notice draft; it awaits approval in the notices queue', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await openLeasePage(page);
    await page.getByRole('button', { name: 'Open assistant' }).click();
    const dialog = await ask(page, 'Draft a late rent notice for this lease');
    const card = dialog.getByTestId('ai-draft-card').last();
    await expect(card).toContainText('Draft created, awaiting approval', { timeout: 20_000 });
    await expect(dialog.locator('[data-role="assistant"]').last().getByText('draft_notice · ok')).toBeVisible();
    const review = card.getByRole('link', { name: 'Review draft in notices' });
    const href = (await review.getAttribute('href'))!;
    expect(href).toMatch(/^\/manager\/notices\?focus=/);
    await review.click();
    await expect(page).toHaveURL(/\/manager\/notices\?focus=/);
    // The draft is a normal notice in the queue: status draft, submit for approval is the only forward action.
    const noticeDialog = page.getByRole('dialog', { name: /late rent notice/i });
    await expect(noticeDialog).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('dialog', { name: 'Assistant' })).toHaveCount(0); // the assistant closed on navigation
    await expect(noticeDialog).toContainText(/draft/i);
    await expect(noticeDialog).toContainText('Theo Tenant');
    await noticeDialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('row', { name: /Theo Tenant/ }).filter({ hasText: 'late rent' }).first()).toContainText('draft');
  });

  test('vendor has no assistant entry point', async ({ page }) => {
    await login(page, DEMO.vendor, /\/vendor/);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open assistant' })).toHaveCount(0);
  });

  test('compliance officer sees the manager\'s commands on the AI audit page', async ({ page }) => {
    await login(page, DEMO.compliance, /\/compliance/);
    await page.goto('/compliance/ai-audit');
    await expect(page.getByRole('heading', { name: 'AI audit' })).toBeVisible();
    const table = page.getByRole('region', { name: 'AI audit events' });
    await expect(table).toContainText('ai.command');
    await expect(table).toContainText('summarize_lease · ok');
    await expect(table).toContainText('draft_notice · ok');
    await expect(table).toContainText('claude-fable-5-1');
    await page.getByLabel('Tool').selectOption('draft_notice');
    await expect(table).toContainText('draft_notice · ok');
    await expect(table.getByText('summarize_lease · ok')).toHaveCount(0);
  });

  test('tenant is denied on the AI audit page', async ({ page }) => {
    await login(page, DEMO.tenant, /\/tenant/);
    await page.goto('/compliance/ai-audit');
    await expect(page.locator('[data-state="denied"]')).toBeVisible();
  });
});

test.describe('AI assistant accessibility @a11y', () => {
  test('assistant drawer has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.manager, /\/manager/);
    await openLeasePage(page);
    await page.getByRole('button', { name: 'Open assistant' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assistant' });
    await expect(dialog).toBeVisible();
    await noSeriousViolations(page);
    await ask(page, 'What should I do next with this lease?');
    await expect(dialog.locator('[data-role="assistant"]').last()).toContainText('Recommended next steps', { timeout: 20_000 });
    await noSeriousViolations(page);
  });

  test('AI audit page has no serious axe violations', async ({ page }) => {
    await login(page, DEMO.compliance, /\/compliance/);
    await page.goto('/compliance/ai-audit');
    await expect(page.getByRole('heading', { name: 'AI audit' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'AI audit events' })).toBeVisible();
    await noSeriousViolations(page);
  });
});
