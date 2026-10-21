import { defineConfig } from '@playwright/test';

/* The suite launches its own persistent context with the extension loaded
   (see e2e/harness.ts), so no browser project is configured here.
   `pretest:e2e` builds and makes dist/chrome-granted first. */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  timeout: 90_000,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: { trace: 'on-first-retry' },
});
