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
