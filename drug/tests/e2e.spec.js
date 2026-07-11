import { test, expect } from '@playwright/test';
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
