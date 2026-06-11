// Structural smoke test for the district dashboard. Serves the folder and checks
// the page renders without console errors: 5 rollup cards, a chart SVG, the focus
// tabs, the Leaflet map, and a working signal/focus/map-mode switch.
import { test, expect } from '@playwright/test';

const errors = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
});

test('renders cards, chart, and map without errors', async ({ page }) => {
  await page.goto('/districts/index.html');

  // 5 rollup cards (4 districts + citywide)
  await expect(page.locator('#cards .card')).toHaveCount(5);
  await expect(page.locator('.card--citywide')).toHaveCount(1);

  // chart drew an SVG with bars
  await expect(page.locator('#chart-host svg')).toBeVisible();
  expect(await page.locator('#chart-host rect.chart-bar').count()).toBeGreaterThan(30);

  // focus tabs: Citywide + 4 districts
  await expect(page.locator('#focus-tabs .tab')).toHaveCount(5);

  // map initialised (container visible, tiles loaded, district boundary paths drawn)
  await expect(page.locator('#map.leaflet-container')).toBeVisible();
  await expect(page.locator('#map img.leaflet-tile').first()).toBeAttached();
  expect(await page.locator('#map path').count()).toBeGreaterThan(0);

  // as-of line populated
  await expect(page.locator('#data-asof')).toContainText('Data through');

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('switching focus to a district re-renders the chart', async ({ page }) => {
  await page.goto('/districts/index.html');
  await page.locator('#focus-tabs .tab', { hasText: 'Mission' }).click();
  await expect(page.locator('#chart-title')).toContainText('Mission');
  await expect(page.locator('#chart-host svg')).toBeVisible();
  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('switching the map to individual reports renders dots', async ({ page }) => {
  await page.goto('/districts/index.html');
  await page.locator('#map-modes .tab', { hasText: 'Individual reports' }).click();
  await expect(page.locator('#map path.leaflet-interactive')).not.toHaveCount(0);
  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('time window drives the cards (sync) and chart shows a window band', async ({ page }) => {
  await page.goto('/districts/index.html');
  await expect(page.locator('#chart-host rect.chart-window')).toHaveCount(1);
  const before = await page.locator('.card--citywide .card__value').textContent();
  // widen the window by dragging the left handle fully left → citywide total must change
  const lo = page.locator('#time-range').locator('[role="slider"]').first();
  await lo.focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('Home'); // jump to min
  await expect(page.locator('.card--citywide .card__value')).not.toHaveText(before || '');
  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

test('Play toggles to Pause and advances the window', async ({ page }) => {
  await page.goto('/districts/index.html');
  const readoutBefore = await page.locator('#time-readout').textContent();
  await page.locator('#play-btn').click();
  await expect(page.locator('#play-label')).toHaveText('Pause');
  await page.waitForTimeout(1700); // one tick
  await page.locator('#play-btn').click();
  await expect(page.locator('#play-label')).toHaveText('Play');
  expect(await page.locator('#time-readout').textContent()).not.toEqual(readoutBefore);
  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});
