import { defineConfig } from '@playwright/test';

// Standalone config for the theft dashboard (served from the repo root so
// /theft/ paths resolve). Separate from the root app's suite.
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: { baseURL: 'http://localhost:8092' },
  webServer: {
    command: 'npx http-server .. -p 8092 -c-1 --silent',
    url: 'http://localhost:8092/theft/index.html',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
