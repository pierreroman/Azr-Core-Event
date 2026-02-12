// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright configuration for Community Online Event site.
 * 
 * By default, tests run against http://localhost:4280 (Azure SWA CLI).
 * Override with the BASE_URL environment variable for staging/production.
 * 
 * Usage:
 *   npx playwright test                     # run all tests
 *   npx playwright test --ui                # interactive UI mode
 *   npx playwright test --project=chromium  # single browser
 *   npx playwright test tests/homepage.spec.js  # single file
 */
module.exports = defineConfig({
  testDir: './tests',
  
  /* Maximum time one test can run */
  timeout: 30_000,
  
  /* Expect timeout */
  expect: { timeout: 5_000 },

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Limit parallel workers on CI */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter - use HTML report for rich output */
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],

  /* Shared settings for all projects */
  use: {
    /* Base URL - Azure SWA CLI default */
    baseURL: process.env.BASE_URL || 'http://localhost:4280',

    /* Collect trace on first retry */
    trace: 'on-first-retry',

    /* Screenshots on failure */
    screenshot: 'only-on-failure',
  },

  /* Configure browser projects */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    /* Mobile viewports */
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  // Uncomment if you have SWA CLI installed:
  // webServer: {
  //   command: 'swa start',
  //   url: 'http://localhost:4280',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 60_000,
  // },
});
