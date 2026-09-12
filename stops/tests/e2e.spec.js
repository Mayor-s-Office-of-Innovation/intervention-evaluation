import { test, expect } from '../../tests/e2e-base.js';

// The stop card embeds a Mapillary iframe when data/mapillary.json has an image for the stop. The live
// viewer streams tiles indefinitely (networkidle never settles) and logs permissions warnings, so every
// test serves an empty page in its place — the tests are about our page, not theirs.
async function stubMapillary(page) {
  await page.route('**/*.mapillary.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));
}

function trackErrors(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  return errors;
}

test('landing: map, concern table, citywide table render (no console errors)', async ({ page }) => {
  const errors = trackErrors(page);
  await stubMapillary(page);
  await page.goto('/stops/index.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#data-asof')).toContainText('Data through');
  await expect(page.locator('#map .leaflet-container, #map.leaflet-container')).toHaveCount(1);
  // Concern-list table: hidden in the default public build, shown only for a --full build.
  const detail = (await (await page.request.get('/stops/data/concern.json')).json()).detail === true;
  await expect(page.locator('#concern-block')).toBeVisible({ visible: detail });
  if (detail) expect(await page.locator('#concern-table tbody tr').count()).toBeGreaterThan(20);
  await expect(page.locator('#citywide-table tbody tr').first()).toBeVisible();
  await expect(page.locator('#stop-card')).toBeHidden();
  await expect(page.locator('#colour-by input[type=checkbox]')).toHaveCount(4);
  await expect(page.locator('#colour-by input[type=checkbox]:checked')).toHaveCount(4);
  await page.locator('#colour-by input[value=encampment]').uncheck();
  await expect(page.locator('#colour-by input[type=checkbox]:checked')).toHaveCount(3);
  await expect(page.locator('#show-concern')).toBeChecked();
  await page.locator('#show-concern').uncheck();
  await expect(page.locator('#show-concern')).not.toBeChecked();
  await page.locator('#streets-first').check();
  await expect(page.locator('#map .osm-tiles')).toBeAttached();          // OSM base swapped in
  await page.locator('#streets-first').uncheck();
  await expect(page.locator('#map .osm-tiles')).toHaveCount(0);
  expect(errors.filter(e => !/webawesome|favicon/i.test(e)), errors.join('\n')).toEqual([]);
});

test('?stop=<id> deep link opens the card with four signals, alternatives, and the basis block for a listed stop', async ({ page }) => {
  const errors = trackErrors(page);
  await stubMapillary(page);
  await page.goto('/stops/index.html?stop=7301', { waitUntil: 'domcontentloaded' });   // O'Farrell & Taylor — on the list
  const card = page.locator('#stop-card');
  await expect(card).toBeVisible();
  await expect(card.locator('h2')).toContainText("O'Farrell");
  await expect(card.locator('.sig')).toHaveCount(4);
  await expect(card.locator('.sig .spark')).toHaveCount(4);
  // The overlay ships in PUBLIC form by default (stop identities only); the basis block / removal flag
  // appear only when data/concern.json was built with --full. Assert whichever mode the data is in.
  const detail = (await (await page.request.get('/stops/data/concern.json')).json()).detail === true;
  await expect(card.locator('.basis')).toHaveCount(detail ? 1 : 0);
  await expect(card.locator('.pill--pin')).toContainText('On the concern list');
  if (!detail) await expect(card.locator('.pill--pin')).not.toContainText('removal requested');
  await expect(card.locator('.alts li').first()).toContainText('38');
  await expect(page.locator('#concern-block')).toBeVisible({ visible: detail });
  await expect(card.locator('a[href*="data.sf.gov/resource"]')).toHaveCount(4);
  await expect(card.locator('.photo__frame')).toHaveCount(1);          // Mapillary embed present for a resolved stop (stubbed)
  await expect(page.locator('#map .halo-label')).toContainText("O'Farrell");   // selection halo + name label on the map
  expect(errors.filter(e => !/webawesome|favicon/i.test(e)), errors.join('\n')).toEqual([]);
});

test('search by 5-digit public id and by street words opens a card; unlisted stop has no basis block', async ({ page }) => {
  await stubMapillary(page);
  await page.goto('/stops/index.html', { waitUntil: 'networkidle' });
  await page.fill('#stop-search', '15667');           // Market & Castro EB (1 + 5667)
  await page.keyboard.press('Enter');
  await expect(page.locator('#stop-card h2')).toContainText('Castro');
  await expect(page.locator('#stop-card .basis')).toHaveCount(0);
  await page.fill('#stop-search', 'turk jones');
  await expect(page.locator('#search-results li').first()).toBeVisible();
  await page.locator('#search-results li').first().click();
  await expect(page.locator('#stop-card h2')).toContainText('Turk');
  expect(page.url()).toMatch(/\?stop=\d+/);
});
