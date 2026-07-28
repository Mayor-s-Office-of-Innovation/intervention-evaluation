import { test, expect } from '@playwright/test';
import { DATAPOINTS } from '../js/datapoints.js';

// These tests drive the tool against the LIVE SF OpenData (Socrata) API, so
// assertions are structural/behavioral (counts drift day to day) rather than
// exact numbers.

// The dropdown is rendered straight from the DATAPOINTS registry, so derive the
// expected option list from that same source of truth — the assertion then can't
// go stale when a lever is added/removed (as it did when the registry grew from
// the original 5 to the full 14).
const DATA_POINTS = DATAPOINTS.map(d => d.key);

// Analysis is no longer triggered by a "Run" button — that button now SUBMITS an
// intervention. The app auto-runs when the URL carries report params (dp / lat+lng
// / from+to), so tests enter via a shared link and wait for the results to reveal.
// Results render one panel per selected lever under #panels ([data-stats] /
// [data-chart] / [data-verdict]); there is no longer a single #stat-cards/#chart-host.
const PIN = 'lat=37.77346&lng=-122.42736&r=250'; // Koshland Park pin
const REPORT = `dp=drug&date=2026-05-13&${PIN}`;

function collectErrors(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

// Load the app WITHOUT auto-running (no report params) — for tests that assert
// the pre-run gate or don't otherwise need an analysis.
async function gotoApp(page) {
  const errors = collectErrors(page);
  await page.goto('./', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => customElements.get('wa-select') && document.querySelectorAll('#in-expect wa-option').length > 0
  );
  return errors;
}

// Load via a shared link so the app auto-runs, then wait for the results section
// to reveal and the first lever panel's stat cards to render.
async function gotoReport(page, query = REPORT) {
  const errors = collectErrors(page);
  await page.goto(`./?${query}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#results:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#panels [data-stats] .stat').length > 0);
  return errors;
}

test('loads and lists all data points, with no console errors', async ({ page }) => {
  const errors = await gotoApp(page);
  const opts = await page.$$eval('#in-expect wa-option', els => els.map(e => e.getAttribute('value')));
  expect(opts).toEqual(DATA_POINTS);
  // methodology shows static filter text before any run; results stay hidden (gate)
  await expect(page.locator('#methodology-body')).toContainText('Suspicious Person');
  await expect(page.locator('#results')).toBeHidden();
  expect(errors).toEqual([]);
});

test('runs the default data point and reveals chart, map, stats, one query link', async ({ page }) => {
  const errors = await gotoReport(page);
  // one lever panel (drug) → 4 stat cards, chart bars, map dots, one source link
  expect(await page.$$eval('#panels [data-stats] .stat', e => e.length)).toBe(4);
  expect(await page.$$eval('#panels [data-chart] svg rect.chart-bar', e => e.length)).toBeGreaterThan(0);
  expect(await page.$$eval('#events-map path.leaflet-interactive', e => e.length)).toBeGreaterThan(0);
  expect(await page.$$eval('#methodology-body .method-src__link a', e => e.length)).toBe(1);
  await expect(page.locator('#results')).toBeVisible();
  expect(errors).toEqual([]);
});

test('homelessness aggregate is multi-source (911 + 311)', async ({ page }) => {
  await gotoReport(page, `dp=homeless_presence&date=2026-05-13&${PIN}`);
  await page.waitForFunction(() => document.querySelectorAll('#methodology-body .method-src__link a').length === 2);
  const paths = await page.$$eval('#methodology-body .method-src__link a', els => els.map(a => new URL(a.href).pathname));
  expect(paths.some(p => p.includes('2zdj-bwza'))).toBeTruthy();
  expect(paths.some(p => p.includes('vw6y-z8j6'))).toBeTruthy();
});

test('date slider narrows the window → daily bars and the before window updates', async ({ page }) => {
  await gotoReport(page);
  const beforeLabel = () => page.$eval('#panels [data-stats] .stat:nth-child(1) .stat__label', e => e.textContent);
  const full = await beforeLabel();
  await page.evaluate(() => {
    const s = document.getElementById('range-slider');
    s.minValue = Math.max(0, s.max - 40);
    s.maxValue = s.max;
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#range-readout')).toContainText('daily');
  expect(await beforeLabel()).not.toBe(full); // "Before · N days" recomputed for the window
});

test('radius slider enlarges the searched area (more reports at a bigger radius)', async ({ page }) => {
  await gotoReport(page);
  const inView = () => page.$eval('#panels [data-stats] .stat:last-child .stat__value', e => Number(e.textContent));
  const small = await inView();
  await page.evaluate(() => {
    const s = document.getElementById('radius-slider');
    s.value = 1000;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#coords-readout')).toContainText('1000 m');
  await expect.poll(() => inView(), { timeout: 30_000 }).toBeGreaterThan(small);
});

test('smart default window starts later than full history (not Jan 2023)', async ({ page }) => {
  await gotoReport(page); // no from/to → smart default window (not the shared window)
  // a suggestion is shown and the default range no longer starts at the 2023 history floor
  await expect(page.locator('#range-suggest')).toContainText('Drag the handles');
  const readout = await page.$eval('#range-readout', e => e.textContent);
  expect(readout.startsWith('Jan 1, 2023')).toBeFalsy();
});

test('save/share: a report serializes to the URL and reopening reproduces it', async ({ page }) => {
  const what = 'installed new lighting';
  // describe an intervention (via the shared-link param) and auto-run
  await gotoReport(page, `${REPORT}&what=${encodeURIComponent(what)}`);

  // the address bar now carries the full report state (live-sync via replaceState)
  const url = new URL(await page.evaluate(() => location.href));
  expect(url.searchParams.get('dp')).toBe('drug');
  expect(url.searchParams.get('what')).toContain('lighting');
  for (const k of ['date', 'lat', 'lng', 'r', 'from', 'to']) {
    expect(url.searchParams.get(k)).toBeTruthy();
  }

  // reopening the link reproduces the report (auto-runs, restores the free text)
  await page.goto(url.pathname + url.search, { waitUntil: 'networkidle' });
  await page.waitForSelector('#results:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#panels [data-stats] .stat').length > 0);
  expect(await page.$eval('#in-what', e => e.value)).toContain('lighting');
  await expect(page.locator('#range-suggest')).toContainText('shared report');
  // opening a shared link scrolls down to the results (copy button sits at the top of that area)
  await page.waitForFunction(() => window.scrollY > 0);
  const restored = new URL(await page.evaluate(() => location.href));
  expect(restored.searchParams.get('from')).toBe(url.searchParams.get('from'));
  expect(restored.searchParams.get('to')).toBe(url.searchParams.get('to'));
});

test('overflow: known reporting break surfaces only when the window straddles it', async ({ page }) => {
  // Shared-link params drive a deterministic window; default Koshland pin.
  const base = `dp=overflow&date=2025-11-15&lat=37.77346&lng=-122.42736&r=400`;

  // Window spans the Nordsense break (Nov 2025) → marker + verdict warning appear.
  await page.goto(`./?${base}&from=2025-08-01&to=2026-03-01`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#results:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#panels [data-stats] .stat').length > 0);
  await expect(page.locator('#panels [data-chart] svg line.chart-break')).toHaveCount(1);
  await expect(page.locator('#panels [data-verdict] .verdict-warn')).toContainText('reporting change');
  await expect(page.locator('#panels [data-verdict] .verdict-warn')).toContainText('Nordsense');

  // Window entirely after the break → no marker, no break warning.
  await page.goto(`./?${base}&from=2026-01-01&to=2026-05-01`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#results:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#panels [data-stats] .stat').length > 0);
  await expect(page.locator('#panels [data-chart] svg line.chart-break')).toHaveCount(0);
  await expect(page.locator('#panels [data-verdict]')).not.toContainText('reporting change');
});

test('respects OS dark mode (wa-dark class + CARTO dark tiles)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await gotoApp(page);
  expect(await page.evaluate(() => document.documentElement.classList.contains('wa-dark'))).toBeTruthy();
  await page.waitForFunction(() => !!document.querySelector('#picker-map img.leaflet-tile'));
  const srcs = await page.$$eval('#picker-map img.leaflet-tile', els => els.map(i => i.src));
  expect(srcs.some(s => s.includes('dark_all'))).toBeTruthy();
});
