import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Standalone Playwright config for the hypothesis tool (lives in hypothesis/).
// It reuses the @playwright/test dependency installed at the repo root but has
// its own testDir + dev server on :8090, serving this directory at /.
// Run with:  npx playwright test -c hypothesis/playwright.config.js
// (or `npm test` from the repo root, which points here).
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,            // serial — these tests hit the live Socrata API
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:8090',
    headless: true,
  },
  webServer: {
    command: 'npx http-server -p 8090 -c-1',
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    url: 'http://localhost:8090',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
