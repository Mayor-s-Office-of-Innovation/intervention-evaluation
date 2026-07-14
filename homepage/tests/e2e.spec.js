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

  // the self-serve hypothesis tool is linked; its href now carries the selected
  // district (e.g. ./hypothesis/?district=Northern) to pre-fill the form, so match by prefix.
  await expect(page.locator('a[href^="./hypothesis/"]').first()).toBeVisible();

  // a broken app.js load or failed TSV fetch would surface as a console/page error
  expect(errors).toEqual([]);
});

test('the Interventions table lists saved interventions per district', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('.district-tab')).toHaveCount(4);
  // The OKRs and Interventions sections now render together (no tabs).

  // default district Northern → its saved item, with the Target KR derived from dp=drug
  const table = page.locator('.intervention-table');
  await expect(table).toContainText('Alpha report');
  await expect(table).toContainText('Drug-related complaints');

  // switch to Central → Beta replaces Alpha
  await page.locator('.district-tab[data-district="Central"]').click();
  await expect(page.locator('.intervention-table')).toContainText('Beta report');
  await expect(page.locator('.intervention-table')).not.toContainText('Alpha report');

  // a district with no saved items → per-district empty state
  await page.locator('.district-tab[data-district="Mission"]').click();
  await expect(page.locator('.intervention-empty')).toBeVisible();
});

test('closing a saved intervention moves it behind the "view closed" toggle', async ({ page }) => {
  // The close endpoint returns the updated (closed) item; the row then leaves the open view.
  await page.route('**/interventions/*/close', route => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ item: { ...SAVED[0], status: 'closed_completed' } }),
  }));
  page.on('dialog', d => d.accept());   // accept the confirm()

  await page.goto('/index.html');
  await expect(page.locator('.intervention-table')).toContainText('Alpha report');  // Northern, open

  await page.locator('.action-close').first().click();

  // closed → hidden from the default (open) view, revealed via the toggle
  await expect(page.locator('.view-closed-toggle')).toBeVisible();
  await expect(page.locator('.intervention-table')).not.toContainText('Alpha report');

  await page.locator('.view-closed-toggle').click();
  await expect(page.locator('.intervention-table')).toContainText('Alpha report');
});
