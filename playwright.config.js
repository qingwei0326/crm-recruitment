// @ts-check
const { defineConfig } = require('@playwright/test');

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL || 'http://localhost:5173';
const isCI = Boolean(process.env.CI);

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  forbidOnly: isCI,
  reporter: isCI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  // Start the Vite dev server unless a server is supplied via PLAYWRIGHT_BASE_URL.
  webServer: externalBaseURL
    ? undefined
    : {
        command: 'npm run dev -- --port 5173 --strictPort',
        cwd: './frontend',
        url: `${baseURL}/login`,
        reuseExistingServer: !isCI,
        timeout: 60_000,
      },
});
