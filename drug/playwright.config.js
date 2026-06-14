import { defineConfig } from '@playwright/test';

// Standalone config for the unhoused dashboard (served from the repo root so
// /unhoused/ paths resolve). Separate from the districts + root app suites.
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: { baseURL: 'http://localhost:8093' },
  webServer: {
    command: 'npx http-server .. -p 8093 -c-1 --silent',
    url: 'http://localhost:8093/unhoused/index.html',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
