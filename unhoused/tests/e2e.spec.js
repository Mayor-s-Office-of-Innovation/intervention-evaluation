import { test, expect } from '../../tests/e2e-base.js';

const DISTRICTS = ['northern', 'mission', 'tenderloin', 'central'];
const url = (d) => `/unhoused/index.html#${d}`;

function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  return errors;
}

test('four district pages: two success cards, one chart, HSOC response block, map (no console errors)', async ({ page }) => {
  const errors = trackErrors(page);
  for (const d of DISTRICTS) {
    await page.goto(url(d), { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await expect(page.locator('.scard')).toHaveCount(2);                 // Encampments + 911
    await expect(page.locator('.scard__num').first()).not.toBeEmpty();
    await expect(page.locator('#chart > svg')).toBeVisible();            // single focused chart (legend swatches are nested)
    await expect(page.locator('#chart .chart-legend .cl-item').first()).toBeVisible();  // overlay-line legend
    await expect(page.locator('#chart-selector .seg')).toHaveCount(3);   // Aggregate · Encampment · 911
    await expect(page.locator('#hsoc-block .rb__num')).not.toBeEmpty();  // response signal below
    await expect(page.locator('.legend-item')).toHaveCount(3);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('chart selector switches focus; clicking a success card focuses it', async ({ page }) => {
  trackErrors(page);
  await page.goto(url('northern'), { waitUntil: 'networkidle' });
  // default focus = aggregate (assert on the stable data-f hook, not the display label)
  await expect(page.locator('#chart-selector .seg.is-active')).toHaveAttribute('data-f', 'aggregate');
  // click the Encampments card → focuses encampment + reveals the dedicated-only toggle
  await page.locator('.scard[data-focus="encampment"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('#chart-selector .seg.is-active')).toHaveAttribute('data-f', 'encampment');
  await expect(page.locator('#enc-only-wrap')).toBeVisible();
  // selector → 911 hides the encampment-only toggle
  await page.locator('#chart-selector .seg[data-f="cfs_presence"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('#enc-only-wrap')).toBeHidden();
});

test('encampment-only toggle re-renders the focused chart', async ({ page }) => {
  trackErrors(page);
  await page.goto(url('northern'), { waitUntil: 'networkidle' });
  await page.locator('#chart-selector .seg[data-f="encampment"]').click();
  await page.waitForTimeout(150);
  const before = await page.locator('#chart-note').textContent();
  await page.locator('#enc-only-toggle').click();
  await page.waitForTimeout(250);
  await expect(page.locator('#chart-note')).not.toHaveText(before);
});

test('transition map signal toggle (encampment / 911) works', async ({ page }) => {
  trackErrors(page);
  await page.goto(url('mission'), { waitUntil: 'networkidle' });
  await page.locator('#map-controls .seg[data-s="cfs_presence"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#map-controls .seg.is-active')).toHaveText('911 unhoused calls');
  await expect(page.locator('#map path.leaflet-interactive').first()).toBeVisible();
});

test('map time-of-day filter: chips reclassify the map (granular buckets), multi-select, and reset', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(url('northern'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // All + the 4 granular buckets render; "All" is active by default.
  await expect(page.locator('#map-tod-filter .map-tod-chip')).toHaveCount(5);
  await expect(page.locator('#map-tod-filter .map-tod-chip.is-active')).toHaveText('All');

  const counts = async () => (await page.locator('#map-legend .legend-count').allTextContents()).join('/');
  const all = await counts();

  // A single bucket re-classifies off the baked monthly_tod arrays → different legend counts.
  await page.locator('.map-tod-chip[data-tod="morning"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#map-tod-filter .map-tod-chip.is-active')).toHaveText('Morning');
  expect(await counts()).not.toBe(all);

  // Multi-select: adding a second bucket keeps both active (no error, still classifies).
  await page.locator('.map-tod-chip[data-tod="night"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#map-tod-filter .map-tod-chip.is-active')).toHaveCount(2);

  // "All" clears the filter and restores the unfiltered classification.
  await page.locator('.map-tod-chip[data-tod-all]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#map-tod-filter .map-tod-chip.is-active')).toHaveText('All');
  expect(await counts()).toBe(all);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('block popup shows a sparkline + "See details" breakdown; cells persist when zoomed in (no marker swap)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(url('mission'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  // click a classified block cell → sparkline popup + a "See details" button
  await page.locator('#map path.leaflet-interactive[fill]:not([fill="none"])').first().click({ force: true });
  await page.waitForTimeout(300);
  await expect(page.locator('.leaflet-popup-content .spark')).toBeVisible();
  // grab this cell's coords (so we can zoom onto it and confirm cells aren't culled/swapped)
  const cellBtn = page.locator('.cell-details-btn');
  const lat = parseFloat(await cellBtn.getAttribute('data-lat'));
  const lng = parseFloat(await cellBtn.getAttribute('data-lng'));
  // "See details" lazy-loads the per-report markers dataset and renders the incident-type breakdown
  await cellBtn.click();
  await expect(page.locator('.cell-details__header')).toBeVisible();
  await expect(page.locator('.cell-details .breakdown-row, .cell-details__empty').first()).toBeVisible();
  await page.keyboard.press('Escape');
  // zooming past the OLD threshold (17) onto a cell keeps the CELLS — no swap to markers, no hint/overlay
  await page.evaluate(([la, ln]) => window.__map.setView([la, ln], 18), [lat, lng]);
  await page.waitForTimeout(800);
  await expect(page.locator('#map path.leaflet-interactive[fill]:not([fill="none"])').first()).toBeVisible();
  await expect(page.locator('.map-hint')).toHaveCount(0);
  await expect(page.locator('.marker-overlay')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('clicking a block cell pins its popup, deep-links the URL (replaceState, no history spam), and a shared link restores it', async ({ page }) => {
  trackErrors(page);
  await page.goto(url('mission'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const histBefore = await page.evaluate(() => history.length);
  // click a classified block cell (zoomed-out view) → sparkline popup + a cell id in the URL
  await page.locator('#map path.leaflet-interactive[fill]:not([fill="none"])').first().click({ force: true });
  await page.waitForTimeout(300);
  await expect(page.locator('.leaflet-popup-content .spark')).toBeVisible();
  await expect(page.locator('.leaflet-popup-content .cell-loc')).toBeVisible();   // intersection/address label
  await expect(page).toHaveURL(/[?&]cl=/);
  // replaceState, not pushState — opening cell popups must not grow the back stack
  expect(await page.evaluate(() => history.length)).toBe(histBefore);
  const shared = page.url();
  // a fresh load of the shared URL re-opens the same cell popup
  await page.goto(shared, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1400);
  await expect(page.locator('.leaflet-popup-content .spark')).toBeVisible();
  // closing the popup cleans the map params off the URL
  await page.evaluate(() => window.__map.closePopup());
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/[?&]cl=/);
});

test('time scrubber: presets render, default is Since Lurie, switching reclassifies the map', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(url('mission'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await expect(page.locator('#scrubber-presets .seg')).toHaveCount(4);
  await expect(page.locator('#scrubber-presets .seg.is-active')).toHaveText('Since Lurie');
  await expect(page.locator('#citywide-card .chip')).toHaveCount(3);
  await expect(page.locator('.scard').first().locator('.chip')).toHaveCount(3);
  await expect(page.locator('#chart svg .chart-window')).toBeVisible();
  const before = (await page.locator('.legend-count').allTextContents()).join(',');
  await page.locator('#scrubber-presets button[data-preset="3mo"]').click();
  await page.waitForTimeout(600);
  await expect(page.locator('#scrubber-presets .seg.is-active')).toHaveText('Last 3 mo');
  expect((await page.locator('.legend-count').allTextContents()).join(',')).not.toBe(before);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('methodology shows runnable queries, HSOC-as-response framing, and the waste/needles exclusions', async ({ page }) => {
  trackErrors(page);
  await page.goto(url('northern'), { waitUntil: 'networkidle' });
  const meth = page.locator('#methodology-body');
  await expect(meth.locator('a')).not.toHaveCount(0);
  await expect(meth).toContainText('Response signal');
  await expect(meth).toContainText('Needles');
  await expect(meth).toContainText('human');
});

// Regression guard for the "See details" popup-close bug: clicking the in-popup button (and the tod
// chips) must not propagate to the map (Leaflet's closePopupOnClick would otherwise close it). Also
// asserts the popup actually WIDENS — a CSS-only max-width approach left it cramped (~230px).
test('See details: popup stays open, widens, 5 tod chips, chips filter (no console errors)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(url('mission'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const markers = page.locator('#map path.leaflet-interactive');
  const n = Math.min(await markers.count(), 12);
  let opened = false;
  for (let i = 0; i < n && !opened; i++) {
    await markers.nth(i).click({ force: true });
    await page.waitForTimeout(250);
    if (await page.locator('.leaflet-popup .cell-details-btn').count()) { opened = true; break; }
    await page.mouse.click(3, 3);
    await page.waitForTimeout(120);
  }
  expect(opened, 'found a cell popup with a See details button').toBe(true);

  await page.locator('.leaflet-popup .cell-details-btn').click();
  await page.waitForTimeout(400);
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await expect(page.locator('.leaflet-popup .cell-details:not([hidden])')).toBeVisible();
  await expect(page.locator('.leaflet-popup .tod-chip')).toHaveCount(5);

  const w = await page.locator('.leaflet-popup-content').first().evaluate(el => el.offsetWidth);
  expect(w, `expanded popup width ${w}px (should widen well past the ~230px default)`).toBeGreaterThan(300);

  await page.locator('.leaflet-popup .tod-chip[data-tod="morning"]').click();
  await page.waitForTimeout(250);
  await expect(page.locator('.leaflet-popup')).toBeVisible();
  await expect(page.locator('.leaflet-popup .tod-chip[data-tod="morning"]')).toHaveClass(/is-active/);

  expect(errors, errors.join('\n')).toEqual([]);
});

// ── Recent-activity section (evergreen live DataSF query) — network STUBBED (offline CI). Two
// signals: encampment (311, vw6y-z8j6, default) + 911 presence (CFS, 2zdj-bwza). ──
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const UDIR = dirname(fileURLToPath(import.meta.url));
const RA_ENC = JSON.parse(readFileSync(join(UDIR, 'fixtures', 'recent-encampment.json'), 'utf8'));
const RA_PRES = JSON.parse(readFileSync(join(UDIR, 'fixtures', 'recent-presence.json'), 'utf8'));

async function stubDataSF(page, { fail = false } = {}) {
  await page.route('**/data.sfgov.org/**', (route) => {
    if (fail) return route.abort();
    const u = decodeURIComponent(route.request().url());
    const rows = u.includes('vw6y-z8j6') ? RA_ENC : RA_PRES;    // dataset id picks the fixture
    if (u.includes('max(')) {
      const col = u.includes('vw6y-z8j6') ? 'requested_datetime' : 'received_datetime';
      const mx = rows.map(r => r[col]).sort().at(-1);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ mx }]) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(rows) });
  });
}
async function revealRecent(page) {
  await page.locator('#recent-activity').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelectorAll('#ra-hours .ra-bar').length > 0, null, { timeout: 15000 });
}

test('recent-activity: renders (stubbed); signal picker switches encampment ↔ 911 presence', async ({ page }) => {
  const errors = trackErrors(page);
  await stubDataSF(page);
  await page.goto(url('tenderloin'), { waitUntil: 'networkidle' });
  await revealRecent(page);

  await expect(page.locator('#ra-body')).toBeVisible();
  await expect(page.locator('#ra-hours .ra-bar')).toHaveCount(24);
  await expect(page.locator('#ra-map path.leaflet-interactive').first()).toBeVisible();
  await expect(page.locator('#ra-signal .seg')).toHaveCount(2);
  // assert on the stable test-sig-<key> hook, not the display chip (which gets reworded)
  await expect(page.locator('#ra-signal .seg.is-active')).toHaveClass(/test-sig-encampment/);
  await expect(page.locator('#ra-note')).toContainText('encampment');

  // switch to the 911-presence signal (different dataset)
  await page.locator('#ra-signal .seg.test-sig-cfs_presence').click();
  await expect(page.locator('#ra-signal .seg.is-active')).toHaveClass(/test-sig-cfs_presence/);
  await expect(page.locator('#ra-note')).toContainText('911 presence');
  await expect(page.locator('#ra-hours .ra-bar')).toHaveCount(24);

  // brush an hour bar → map filters
  await page.locator('#ra-hours .ra-bar[data-hour="13"]').click();
  await expect(page.locator('#ra-note')).toContainText('filtered to');
  await expect(page.locator('.ra-clear')).toBeVisible();

  expect(errors, errors.join('\n')).toEqual([]);
});

test('recent-activity: DataSF failure shows a graceful message and hides the body', async ({ page }) => {
  await stubDataSF(page, { fail: true });
  await page.goto(url('mission'), { waitUntil: 'networkidle' });
  await page.locator('#recent-activity').scrollIntoViewIfNeeded();
  await expect(page.locator('#ra-status.ra-status--error')).toBeVisible();
  await expect(page.locator('#ra-body')).toBeHidden();
});
