import { expect, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'Bolar!Demo2026';
export const DEMO = {
  platform: 'platform@bolar.test',
  orgAdmin: 'orgadmin@demo.bolar.test',
  manager: 'manager@demo.bolar.test',
  owner: 'owner@demo.bolar.test',
  tenant: 'tenant@demo.bolar.test',
  bookkeeper: 'books@demo.bolar.test',
  lawyer: 'legal@demo.bolar.test',
  vendor: 'vendor@demo.bolar.test',
  compliance: 'compliance@demo.bolar.test',
  gov: 'gov@demo.bolar.test',
  corp: 'corp@demo.bolar.test',
  occupant: 'occupant@demo.bolar.test',
} as const;

export async function login(page: Page, email: string, expectedPath: RegExp) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(expectedPath, { timeout: 20_000 });
}
