import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 300_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
});
