import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { login, DEMO, DEMO_PASSWORD } from '../helpers/auth';
import { PORTALS } from '../../apps/web/lib/nav';

/**
 * Day 55 portal navigation and accessibility QA (blueprint p55). For every demo persona: landing portal matches the
 * API, every portal base route either renders content or the denied state with zero domain fetches, the sidebar lists
 * only permitted items, each allowed landing passes axe (wcag2a/aa, serious+critical), and keyboard flows work.
 */
const API_URL = `http://localhost:${process.env.API_PORT ?? '4000'}`;
const PORTAL_ROUTES = PORTALS.map((p) => p.base);

/** API paths that belong to each portal's domain; none may be requested when the portal is denied. */
const DOMAIN_ENDPOINTS: Record<string, RegExp> = {
  '/admin': /\/(orgs|platform\/|feature-flags|support-sessions|users|audit)/,
  '/subaccount': /\/(users|invitations|subaccounts|retention|privacy-requests|sensitive-access|audit)/,
  '/manager': /\/(properties|work-orders|leases|applications|notices|vendors|rules|tenant-profiles|templates|documents|sensitive-access)/,
  '/owner': /\/(properties|leases|portfolios|documents)/,
  '/finance': /\/(invoices|payments|ledger|journal|accounts|bank)/,
  '/compliance': /\/(rules|notices|applications)/,
  '/legal': /\/(cases|legal-holds|privacy-requests|agency-requests|sensitive-access)/,
  '/tenant': /\/(leases|work-orders|invoices|documents|payments|notifications)/,
  '/corporate-admin': /\/(tenant-profiles|leases|documents)/,
  '/occupant': /\/(leases|work-orders|documents)/,
  '/vendor': /\/(work-orders|vendors|media)/,
  '/gov': /\/(agency-requests|exports|packet)/,
};

const PERSONAS: { key: string; email: string }[] = [
  { key: 'platform', email: DEMO.platform }, { key: 'orgadmin', email: DEMO.orgAdmin }, { key: 'manager', email: DEMO.manager }, { key: 'owner', email: DEMO.owner },
  { key: 'tenant', email: DEMO.tenant }, { key: 'books', email: DEMO.bookkeeper }, { key: 'legal', email: DEMO.lawyer }, { key: 'vendor', email: DEMO.vendor },
  { key: 'compliance', email: DEMO.compliance }, { key: 'gov', email: DEMO.gov }, { key: 'corp', email: DEMO.corp }, { key: 'occupant', email: DEMO.occupant },
];

interface Me { portals: string[]; permissions: string[]; roles: { role: string }[] }

async function meFor(request: APIRequestContext, email: string): Promise<Me> {
  const res = await request.post(`${API_URL}/auth/login`, { data: { email, password: DEMO_PASSWORD } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  const { accessToken } = (await res.json()) as { accessToken: string };
  const me = await request.get(`${API_URL}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  expect(me.ok()).toBeTruthy();
  return (await me.json()) as Me;
}

async function settled(page: Page) {
  // Skeletons carry aria-busy; wait until every loader in main has resolved before asserting or running axe.
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(serious.map((v) => `${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.describe('portal route matrix @smoke', () => {
  for (const persona of PERSONAS) {
    test(`${persona.key}: lands on the API's first portal, sees only permitted navigation, denied portals fetch nothing`, async ({ page, request }) => {
      test.setTimeout(240_000);
      const me = await meFor(request, persona.email);
      expect(me.portals.length, 'persona has at least one portal').toBeGreaterThan(0);
      const landing = me.portals[0]!;
      await login(page, persona.email, new RegExp(`^http://[^/]+${landing}(/|$|\\?)`));
      await settled(page);

      // Each API request is attributed to the page (frame URL) that issued it, so a late fetch from the previous
      // route is never counted against the route being tested.
      const domainRequests: { path: string; from: string }[] = [];
      page.on('request', (r) => {
        const url = r.url();
        if (!url.startsWith(API_URL)) return;
        const path = url.slice(API_URL.length);
        if (/^\/(me|auth\/|health$)/.test(path)) return;
        domainRequests.push({ path, from: new URL(r.frame().url()).pathname });
      });

      for (const route of PORTAL_ROUTES) {
        const portal = PORTALS.find((p) => p.base === route)!;
        domainRequests.length = 0;
        await page.goto(route);
        await expect(page).toHaveURL(new RegExp(`${route}(/|$|\\?)`));
        if (me.portals.includes(route)) {
          await expect(page.getByRole('main')).toBeVisible();
          await settled(page);
          await expect(page.getByRole('main').locator('[data-state="denied"]'), `${persona.key} should not be denied on ${route}`).toHaveCount(0);
          // Sidebar shows the portal section with exactly the items the permissions allow.
          const nav = page.getByRole('navigation', { name: 'Primary' });
          await expect(nav).toContainText(portal.title);
          const expected = portal.nav.filter((n) => !n.permission || me.permissions.includes(n.permission)).map((n) => n.label);
          await expect(nav.locator('ul').first().getByRole('link')).toHaveText(expected);
          // The portal switcher lists only portals this persona may enter.
          if (me.portals.length > 1) {
            const switcher = nav.locator('ul').nth(1).getByRole('link');
            await expect(switcher).toHaveText(me.portals.map((p) => PORTALS.find((x) => x.base === p)!.title));
          } else {
            await expect(nav.locator('ul')).toHaveCount(1);
          }
          await axeClean(page, `${persona.key} ${route}`);
        } else {
          await expect(page.locator('[data-state="denied"]'), `${persona.key} should be denied on ${route}`).toBeVisible();
          // No portal navigation section is rendered for a denied portal.
          await expect(page.getByRole('navigation', { name: 'Primary' })).not.toContainText(portal.title);
          await page.waitForTimeout(400);
          const leaked = domainRequests.filter((r) => r.from === route && DOMAIN_ENDPOINTS[route]!.test(r.path)).map((r) => r.path);
          expect(leaked, `${persona.key} on denied ${route} must not fetch domain data`).toEqual([]);
        }
      }
    });
  }
});

test.describe('keyboard navigation and focus management @a11y', () => {
  test('Tab from the skip link reaches the first navigation link; main is the skip target', async ({ page }) => {
    await login(page, DEMO.orgAdmin, /\/subaccount/);
    await page.goto('/subaccount/users');
    await expect(page.getByRole('heading', { name: 'Staff and roles' })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveText('Skip to content');
    await expect(page.locator(':focus')).toHaveAttribute('href', '#main');
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toHaveText('Overview');
    await expect(page.locator(':focus')).toHaveAttribute('href', '/subaccount');
    // Activating the skip link moves focus into main.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
    const focusedInMain = await page.evaluate(() => { const a = document.activeElement; return a?.id === 'main' || Boolean(a?.closest('#main')); });
    expect(focusedInMain).toBe(true);
  });

  test('Drawer: focus moves inside, Tab is trapped, Escape closes and focus returns to the trigger', async ({ page }) => {
    await login(page, DEMO.orgAdmin, /\/subaccount/);
    await page.goto('/subaccount/users');
    const trigger = page.getByRole('button', { name: 'Invite user' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Email')).toBeFocused();
    // Tab cycles within the dialog (12 presses is more than the number of focusable controls in the invite form).
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), `Tab press ${i + 1} stayed in dialog`).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('Drawer close button also returns focus to the trigger', async ({ page }) => {
    await login(page, DEMO.orgAdmin, /\/subaccount/);
    await page.goto('/subaccount/users');
    const trigger = page.getByRole('button', { name: 'Invite user' });
    await trigger.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('corporate admin and occupant landings render dashboards with empty states rather than placeholders', async ({ page }) => {
    await login(page, DEMO.corp, /\/corporate-admin/);
    await expect(page.getByRole('heading', { name: 'Corporate housing overview' })).toBeVisible();
    await settled(page);
    await expect(page.getByRole('main')).not.toContainText('Nothing to show yet');
    await expect(page.getByRole('main').getByText('Occupants', { exact: true }).first()).toBeVisible();
    await axeClean(page, 'corp landing');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await login(page, DEMO.occupant, /\/occupant/);
    await expect(page.getByRole('heading', { name: /^Welcome, / })).toBeVisible();
    await settled(page);
    await expect(page.getByRole('main')).not.toContainText('Nothing to show yet');
    await expect(page.getByRole('main')).toContainText('My housing');
    await expect(page.getByRole('main')).toContainText('My requests');
    await axeClean(page, 'occupant landing');
  });
});
