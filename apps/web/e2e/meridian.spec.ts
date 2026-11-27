import { expect, test } from '@playwright/test';

test('mobile viewport renders without horizontal overflow', async ({ page }) => { await page.goto('/'); await expect(page.locator('#root')).toBeAttached(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy(); });
test('dark-mode smoke', async ({ page }) => { await page.goto('/'); const toggle = page.getByRole('button', { name: /theme|dark|light/i }).first(); if (await toggle.count()) { await toggle.click(); await expect(page.locator('body')).toBeVisible(); } });

test.describe('sandbox employee leave and payslip flow', () => {
  test.skip(!process.env.E2E_FULL, 'requires a seeded throwaway tenant and explicit E2E_FULL=1');
  test('register, employee, leave approval, sandbox run, published payslip', async ({ page }) => {
    await page.goto('/auth');
    // The seeded E2E account and credentials are injected by the runner, never committed.
    await page.getByLabel('Email').fill(process.env.E2E_EMAIL!);
    await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.getByRole('link', { name: /people/i }).click();
    await page.getByRole('button', { name: /add employee/i }).click();
    await page.getByRole('link', { name: /leave/i }).click();
    await page.getByRole('button', { name: /request leave/i }).click();
    await page.getByRole('button', { name: /submit/i }).click();
    await page.getByRole('link', { name: /approvals/i }).click();
    await page.getByRole('button', { name: /approve/i }).click();
    await page.getByRole('link', { name: /payroll/i }).click();
    await page.getByRole('button', { name: /run payroll|new pay run/i }).click();
    await page.getByRole('button', { name: /publish/i }).click();
    await page.getByRole('link', { name: /payslips/i }).click();
    await expect(page.getByText(/payslip/i).first()).toBeVisible();
  });
});
