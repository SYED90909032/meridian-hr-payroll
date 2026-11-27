import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: '.', timeout: 30_000, use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:49081', trace: 'retain-on-failure', screenshot: 'only-on-failure' }, projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['iPhone 13'] } }] });
