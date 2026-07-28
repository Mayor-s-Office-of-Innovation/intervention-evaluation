import { defineConfig } from '@playwright/test';

// Single root config for every e2e suite in the repo. One http-server serves the WHOLE repo root on
// one port, so every dashboard's absolute paths (/drug/index.html, /index.html, …) AND the shared
// ../../shared/* module imports resolve — the way they do on GitHub Pages. Each dashboard is a
// `project` pointing at its own tests/ dir. Run everything with `npm test` (browsers + validation)
// or `npx playwright test`; target one suite with `--project=<name>` (e.g. --project=drug).
//
// Serial (workers:1, fullyParallel:false): the suites share one server and hypothesis hits the live
// Socrata API, so running them one at a time removes the port/API contention that made the old
// per-config chained run flaky. See plan-test-harness-consolidation.md.
const BASE = 'http://localhost:8090';

export default defineConfig({
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,              // hypothesis hits live Socrata; baked suites just get headroom
  expect: { timeout: 15_000 },
  use: { baseURL: BASE, headless: true },
  webServer: {
    command: 'npx http-server . -p 8090 -c-1 --silent',
    url: `${BASE}/index.html`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
  // Cheap/baked suites first, live-Socrata hypothesis last.
  projects: [
    { name: 'homepage',   testDir: './homepage/tests' },
    { name: 'districts',  testDir: './districts/tests' },
    { name: 'theft',      testDir: './theft/tests' },
    { name: 'drug',       testDir: './drug/tests' },
    { name: 'unhoused',   testDir: './unhoused/tests' },
    // hypothesis serves at /hypothesis/ and uses goto('./') + query-relative links,
    // so it needs the subpath baseURL; everything else uses absolute /<dash>/… paths.
    { name: 'hypothesis', testDir: './hypothesis/tests', use: { baseURL: `${BASE}/hypothesis/` } },
  ],
});
