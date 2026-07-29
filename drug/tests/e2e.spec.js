import { test, expect } from '../../tests/e2e-base.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DRUG = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGG = JSON.parse(readFileSync(join(DRUG, 'data', 'aggregates.json'), 'utf8'));
const url = (d) => `/drug/index.html#${d}`;

function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  return errors;
}

// Guard: this suite must run against the DRUG dashboard. A mis-pointed config (the old bug — it
// pointed at /unhoused) now fails loudly here instead of silently testing the wrong page.
test('is the drug dashboard (guard against a mis-pointed config)', async ({ page }) => {
  await page.goto(url('northern'), { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Drug/i);
  await expect(page.locator('#chart-selector')).toContainText('Dealer arrests');
});

test('headline cards, citywide card, scrubber, chart, map render (no console errors)', async ({ page }) => {
  const errors = trackErrors(page);
  for (const d of ['northern', 'mission', 'central', 'tenderloin']) {
    await page.goto(url(d), { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await expect(page.locator('.scard')).toHaveCount(2);                       // reports + dealer arrests
    await expect(page.locator('.scard').first().locator('.chip')).toHaveCount(3);  // 1/3/12 momentum chips
    await expect(page.locator('#citywide-card .chip')).toHaveCount(3);
    await expect(page.locator('#scrubber-presets .seg')).toHaveCount(4);       // Since Lurie · 12mo · 3mo · All
    await expect(page.locator('#scrubber-presets .seg.is-active')).toHaveText('Since Lurie');  // default
    await expect(page.locator('#chart > svg')).toBeVisible();
    await expect(page.locator('#chart svg .chart-window')).toBeVisible();      // the selection band
    await expect(page.locator('#map path.leaflet-interactive').first()).toBeVisible();
    await expect(page.locator('.legend-item')).toHaveCount(3);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('V7 · the rendered headline number equals aggregates.json (data↔UI)', async ({ page }) => {
  await page.goto(url('mission'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  // cfs_drug evaluates the latest complete month; the card shows that district's value, comma-formatted.
  const idx = AGG.months.indexOf(AGG.latest_complete_month);
  const expected = AGG.signals.cfs_drug.series.Mission[idx].toLocaleString('en-US');
  await expect(page.locator('.scard[data-focus="cfs_drug"] .scard__num')).toContainText(expected);
});

test('scrubbing the window reclassifies the map', async ({ page }) => {
  trackErrors(page);
  await page.goto(url('tenderloin'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const before = (await page.locator('.legend-count').allTextContents()).join(',');
  await page.locator('#scrubber-presets button[data-preset="3mo"]').click();
  await page.waitForTimeout(600);
  await expect(page.locator('#scrubber-presets .seg.is-active')).toHaveText('Last 3 mo');
  const after = (await page.locator('.legend-count').allTextContents()).join(',');
  expect(after).not.toBe(before);                                             // map recolored for the new window
});

test('composition panel sits BELOW the map; methodology has runnable queries', async ({ page }) => {
  await page.goto(url('northern'), { waitUntil: 'networkidle' });
  const order = await page.evaluate(() => {
    const m = document.querySelector('#map'), c = document.querySelector('#composition-chart');
    return (m.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'map-first' : 'composition-first';
  });
  expect(order).toBe('map-first');
  await expect(page.locator('#methodology-body a')).not.toHaveCount(0);
});

// Regression guard for the "See details" popup-close bug: clicking the in-popup button (and the tod
// chips) must not propagate to the map (Leaflet's closePopupOnClick would otherwise close it). Also
// asserts the popup actually WIDENS — a CSS-only max-width approach left it cramped (~230px).
test('See details: popup stays open, widens, 5 tod chips, chips filter (no console errors)', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(url('mission'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  // open a hotspot cell (find one whose popup carries the "See details" button)
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

// ── Recent-activity section (evergreen live DataSF query) — network STUBBED for a deterministic,
// offline CI run (hop-② convention: no live network on the PR path). ──
const RA_ROWS = JSON.parse(readFileSync(join(DRUG, 'tests', 'fixtures', 'recent-activity.json'), 'utf8'));

async function stubDataSF(page, { fail = false } = {}) {
  await page.route('**/data.sfgov.org/**', (route) => {
    if (fail) return route.abort();
    const u = decodeURIComponent(route.request().url());
    if (u.includes('max(received_datetime)')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ mx: '2026-07-14T18:14:30.000' }]) });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(RA_ROWS) });
  });
}

async function revealRecent(page) {
  await page.locator('#recent-activity').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelectorAll('#ra-hours .ra-bar').length > 0, null, { timeout: 15000 });
}

test('recent-activity: heatmap + hex map render from the live query (stubbed); chips + brush work', async ({ page }) => {
  const errors = trackErrors(page);
  await stubDataSF(page);
  await page.goto(url('tenderloin'), { waitUntil: 'networkidle' });
  await revealRecent(page);

  await expect(page.locator('#ra-body')).toBeVisible();
  await expect(page.locator('#ra-hours .ra-bar')).toHaveCount(24);                      // 24 hour bars
  await expect(page.locator('#ra-map path.leaflet-interactive').first()).toBeVisible(); // hexes drawn
  await expect(page.locator('#ra-note')).toContainText('Live from DataSF');
  await expect(page.locator('#ra-note')).toContainText('Tenderloin');
  await expect(page.locator('#ra-recency .seg')).toHaveCount(4);
  await expect(page.locator('#ra-recency .seg.is-active')).toHaveText('Last 4 wks');

  // recency chip switches the window
  await page.locator('#ra-recency .seg', { hasText: 'Last 8 wks' }).click();
  await expect(page.locator('#ra-note')).toContainText('last 8 weeks');

  // brushing an hour bar filters the map to that hour
  const litBefore = await page.locator('#ra-map path.leaflet-interactive').count();
  await page.locator('#ra-hours .ra-bar[data-hour="13"]').click();                      // 13:00 has fixture reports
  await expect(page.locator('#ra-note')).toContainText('filtered to');
  await expect(page.locator('.ra-clear')).toBeVisible();                                // "Show all hours" reset
  const litAfter = await page.locator('#ra-map path.leaflet-interactive').count();
  expect(litAfter).toBeLessThanOrEqual(litBefore);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('recent-activity: clicking a hex shows the corner drill-down popup', async ({ page }) => {
  await stubDataSF(page);
  await page.goto(url('tenderloin'), { waitUntil: 'networkidle' });
  await revealRecent(page);
  const hex = page.locator('#ra-map path.leaflet-interactive').first();
  await hex.click({ force: true });
  await expect(page.locator('.leaflet-popup .ra-pop')).toBeVisible();
  await expect(page.locator('.leaflet-popup .ra-pop thead')).toContainText(/Location/i);
});

test('recent-activity: DataSF failure shows a graceful message and hides the body', async ({ page }) => {
  await stubDataSF(page, { fail: true });
  await page.goto(url('mission'), { waitUntil: 'networkidle' });
  await page.locator('#recent-activity').scrollIntoViewIfNeeded();
  await expect(page.locator('#ra-status.ra-status--error')).toBeVisible();
  await expect(page.locator('#ra-status')).toContainText(/Couldn.t reach DataSF/i);
  await expect(page.locator('#ra-body')).toBeHidden();
});
