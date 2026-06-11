import { defineConfig } from '@playwright/test';

// Standalone config for the district dashboard (served from the repo root so
// /districts/ paths resolve). Separate from the root app's suite.
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: { baseURL: 'http://localhost:8091' },
  webServer: {
    command: 'npx http-server .. -p 8091 -c-1 --silent',
    url: 'http://localhost:8091/districts/index.html',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
