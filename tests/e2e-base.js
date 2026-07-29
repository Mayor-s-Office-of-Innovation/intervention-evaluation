// Shared Playwright base for every e2e suite in the repo. Import { test, expect } FROM HERE instead
// of directly from '@playwright/test', so the production-write guard below is installed on every page.
//
// Why: the interventions client defaults its base URL to the DEPLOYED Worker
// (js/interventions-client.js — PROD_API = interventions-api.safestreetssf.workers.dev). Tests stub
// writes with page.route, but that safety is by convention — a future test that triggers an
// un-stubbed POST/PATCH/DELETE would silently mutate PRODUCTION data.
//
// This fixture fails closed: any write to the prod Worker host that isn't intercepted by a more
// specific route is ABORTED (never reaches the network) and logged, turning a silent prod mutation
// into a loud, local failure. Reads pass through untouched.
//
// Route precedence: this guard is registered during page-fixture setup, i.e. BEFORE any
// test.beforeEach / test-body page.route calls. Playwright runs the most-recently-registered matching
// handler first, so a spec's own stub (registered later) always wins — stubbed writes are fulfilled by
// the stub and never reach this guard. Only genuinely un-stubbed prod writes fall through to it.
import { test as base, expect } from '@playwright/test';

const PROD_API = /interventions-api\.safestreetssf\.workers\.dev/;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(PROD_API, route => {
      const req = route.request();
      if (WRITE_METHODS.has(req.method())) {
        // eslint-disable-next-line no-console
        console.error(`[e2e-guard] BLOCKED un-stubbed ${req.method()} to prod: ${req.url()} — stub this write with page.route.`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    await use(page);
  },
});

export { expect };
