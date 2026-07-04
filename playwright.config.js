// @ts-check
const { defineConfig } = require('@playwright/test');

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  webServer: undefined, // assume dev server is already running
});
