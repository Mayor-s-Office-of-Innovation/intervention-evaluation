import { defineConfig } from '@playwright/test';

// Standalone config for the DRUG dashboard (served from the repo root so /drug/ and the shared
// ../../shared/ paths resolve). Distinct port from the other suites.
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: { baseURL: 'http://localhost:8094' },
  webServer: {
    command: 'npx http-server .. -p 8094 -c-1 --silent',
    url: 'http://localhost:8094/drug/index.html',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
