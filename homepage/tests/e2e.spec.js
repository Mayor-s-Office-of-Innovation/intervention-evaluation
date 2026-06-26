// Gate the deploy on the landing page actually rendering its dashboard links. The OKR cards (links to
// /drug/, /unhoused/, /theft/) are injected by js/app.js ONLY after it fetches data/interventions.tsv,
// so a missing or broken script / data file — exactly what 404'd in production — yields zero links and
// fails this test. The hypothesis tool is linked statically from index.html.
import { test, expect } from '@playwright/test';

const DASHBOARDS = ['drug', 'unhoused', 'theft'];

// Stubbed saved-interventions payload (the Worker isn't running in CI). Two items in different
// districts so the per-district filter (Phase 1) is exercised hermetically.
const SAVED = [
  { id: 'a', url: '/hypothesis/?dp=drug&date=2026-05-11&what=alpha+report', what: 'alpha report', dp: 'drug', date: '2026-05-11', district: 'Northern', created: '2026-05-12T00:00:00Z' },
  { id: 'b', url: '/hypothesis/?dp=drug&date=2026-04-01&what=beta+report', what: 'beta report', dp: 'drug', date: '2026-04-01', district: 'Central', created: '2026-04-02T00:00:00Z' },
];

const errors = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  // Serve the saved list from a stub (+ CORS header for the cross-origin GET) — hermetic, no Worker.
  await page.route('**/interventions', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ items: SAVED }),
  }));
});

test('landing page renders links to every dashboard without errors', async ({ page }) => {
  await page.goto('/index.html');

  // app.js fetched the TSV and rendered the four district tabs (proves script + data loaded)
  await expect(page.locator('.district-tab')).toHaveCount(4);

  // each OKR dashboard is linked from the page (cards are rendered in the tab content)
  for (const slug of DASHBOARDS) {
    // hrefs now carry the selected-district hash (e.g. ./drug/#northern), so match by prefix.
    const links = page.locator(`a.okr-card[href^="./${slug}/"]`);
    expect(await links.count(), `expected a link to ./${slug}/`).toBeGreaterThan(0);
    await expect(links.first()).toBeVisible();
  }

  // the self-serve hypothesis tool is linked statically
  await expect(page.locator('a[href="./hypothesis/"]').first()).toBeVisible();

  // a broken app.js load or failed TSV fetch would surface as a console/page error
  expect(errors).toEqual([]);
});

test('saved evaluations filter by the selected district', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.district-tab')).toHaveCount(4);

  // default district is Northern → only its saved item shows
  await expect(page.locator('.saved-eval__name')).toHaveText('Alpha report');

  // switch to Central → its item replaces Northern's
  await page.locator('.district-tab[data-district="Central"]').click();
  await expect(page.locator('.saved-eval__name')).toHaveText('Beta report');

  // a district with no saved items shows the per-district empty state
  await page.locator('.district-tab[data-district="Mission"]').click();
  await expect(page.locator('.saved-evals__empty')).toContainText('Mission');
});
