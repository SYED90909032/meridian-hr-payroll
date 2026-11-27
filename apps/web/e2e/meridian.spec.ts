import { expect, test } from '@playwright/test';

const routes = [
  { path: '/', heading: /good morning|good afternoon|good evening/i },
  { path: '/people', heading: /directory/i },
  { path: '/payroll', heading: /payroll/i },
  { path: '/audit', heading: /audit log/i },
] as const;

test('mobile viewport renders without horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('dark-mode smoke', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: /theme|dark|light/i }).first();
  if (await toggle.count()) {
    await toggle.click();
    await expect(page.locator('body')).toBeVisible();
  }
});

test('registers a fresh tenant, authenticates in the UI, visits core pages, and logs out', async ({ page, request }) => {
  const apiOrigin = process.env.E2E_API_URL;
  if (!apiOrigin) throw new Error('E2E_API_URL is required for the hermetic authenticated test');
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-${id}@example.test`;
  const password = 'E2E test passphrase with enough length 42';
  const registered = await request.post(`${apiOrigin}/api/v1/auth/register`, {
    data: { companyName: `E2E ${id}`, slug: `e2e-${id}`.slice(0, 40), country: 'AE', currency: 'AED', displayName: 'E2E Owner', email, password },
  });
  expect(registered.status(), await registered.text()).toBe(201);

  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('response', (response) => { if (response.status() === 401) consoleErrors.push(`401 ${response.url()}`); });

  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { name: route.heading }).first()).toBeVisible();
      await page.waitForTimeout(350);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${route.path} overflows at ${width}px`).toBeTruthy();
    }
  }
  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);

  await page.goto('/');
  await page.getByRole('button', { name: 'Open profile menu' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
});
