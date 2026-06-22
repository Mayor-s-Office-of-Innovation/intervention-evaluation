// Gate the deploy on the landing page actually rendering its dashboard links. The OKR cards (links to
// /drug/, /unhoused/, /theft/) are injected by js/app.js ONLY after it fetches data/interventions.tsv,
// so a missing or broken script / data file — exactly what 404'd in production — yields zero links and
// fails this test. The hypothesis tool is linked statically from index.html.
import { test, expect } from '@playwright/test';

const DASHBOARDS = ['drug', 'unhoused', 'theft'];

const errors = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
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
