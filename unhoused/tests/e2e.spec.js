import { test, expect } from '@playwright/test';

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
    await expect(page.locator('.district-nav a.is-active')).toHaveText(new RegExp(d, 'i'));
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('chart selector switches focus; clicking a success card focuses it', async ({ page }) => {
  trackErrors(page);
  await page.goto(url('northern'), { waitUntil: 'networkidle' });
  // default focus = aggregate
  await expect(page.locator('#chart-selector .seg.is-active')).toHaveText('Aggregate');
  // click the Encampments card → focuses encampment + reveals the dedicated-only toggle
  await page.locator('.scard[data-focus="encampment"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('#chart-selector .seg.is-active')).toHaveText('Encampment');
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

test('block popup shows a monthly sparkline; zooming in reveals individual report markers with a hover overlay', async ({ page }) => {
  trackErrors(page);
  await page.goto(url('mission'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  // sparkline in a block popup
  await page.locator('#map path.leaflet-interactive[fill]:not([fill="none"])').first().click({ force: true });
  await page.waitForTimeout(300);
  await expect(page.locator('.leaflet-popup-content .spark')).toBeVisible();
  await page.keyboard.press('Escape');
  // zoom past the threshold → individual markers + hint + hover overlay
  await page.evaluate(() => window.__map.setView([37.765, -122.419], 17));
  await page.waitForTimeout(1200);
  await expect(page.locator('.map-hint')).toBeVisible();
  const marker = page.locator('#map path.leaflet-interactive[fill]:not([fill="none"])').first();
  await marker.hover({ force: true });
  await expect(page.locator('.marker-overlay')).toBeVisible();
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

test('methodology shows runnable queries, HSOC-as-response framing, and the waste/needles exclusions', async ({ page }) => {
  trackErrors(page);
  await page.goto(url('northern'), { waitUntil: 'networkidle' });
  const meth = page.locator('#methodology-body');
  await expect(meth.locator('a')).not.toHaveCount(0);
  await expect(meth).toContainText('Response signal');
  await expect(meth).toContainText('Needles');
  await expect(meth).toContainText('human');
});
