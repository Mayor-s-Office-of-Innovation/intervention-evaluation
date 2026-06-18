import { defineConfig } from '@playwright/test';

// Standalone config for the root landing page (the intervention tracker). Served from the repo root
// so /index.html, ./js/*.js, and ./data/interventions.tsv resolve. Distinct port from the other suites.
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: { baseURL: 'http://localhost:8095' },
  webServer: {
    command: 'npx http-server .. -p 8095 -c-1 --silent',
    url: 'http://localhost:8095/index.html',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
