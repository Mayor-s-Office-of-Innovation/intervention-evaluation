import { test, expect } from '../../tests/e2e-base.js';

// Structural smoke tests for the v1 theft dashboard: it loads the baked JSON,
// renders the reported-vs-enforced scorecards (two KR signals + a context signal)
// with charts, shows a verdict per card and the exclusion footnote, and logs no
// console errors.

test('renders the scorecards: primary reports stat, three comparisons, chart, verdict', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/theft/index.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.scorecard')).toHaveCount(3);
  await expect(page.locator('.scorecard__title')).toHaveText([
    'Shoplifting', 'Commercial burglary & robbery', 'Vehicle theft',
  ]);

  // the two committed KRs render up top; vehicle (context) is demoted below the concentration map
  await expect(page.locator('#cards .scorecard__title')).toHaveText([
    'Shoplifting', 'Commercial burglary & robbery',
  ]);
  await expect(page.locator('#vehicle-cards .scorecard__title')).toHaveText(['Vehicle theft']);
  const mapY = await page.locator('#shoplifting-map-section').boundingBox();
  const vehY = await page.locator('#vehicle-context').boundingBox();
  expect(vehY.y).toBeGreaterThan(mapY.y);   // context sits after the KR map, not beside the KRs

  // primary reports figure per card + a chart
  await expect(page.locator('.primary__num')).toHaveCount(3);
  await expect(page.locator('.chart-host svg')).toHaveCount(3);

  // three reference comparisons per card (last month / a year ago / typical month)
  await expect(page.locator('.chip')).toHaveCount(9);
  await expect(page.locator('.chip__label')).toContainText([
    'vs last month', 'vs a year ago', 'vs typical month',
    'vs last month', 'vs a year ago', 'vs typical month',
    'vs last month', 'vs a year ago', 'vs typical month',
  ]);

  // each card carries a plain-language verdict
  await expect(page.locator('.verdict')).toHaveCount(3);
  for (const v of await page.locator('.verdict').allTextContents()) {
    expect(v.trim().length).toBeGreaterThan(0);
  }

  // the context signal (vehicle) is badged and suppresses the arrests axis
  const vehicle = page.locator('.scorecard').nth(2);
  await expect(vehicle.locator('.badge--context')).toContainText('Context');
  await expect(vehicle.locator('.context')).toHaveCount(0);

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('shows the SF-context strip: citywide trend + Northern share over time', async ({ page }) => {
  await page.goto('/theft/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.sf-context')).toHaveCount(3);
  const first = page.locator('.sf-context').first();
  await expect(first).toContainText('Citywide 12-mo trend');
  await expect(first).toContainText('Northern share of SF');
  await expect(first).toContainText(/vs \d+% all-time avg/); // robust share baseline
});

test('arrests appear as context below the chart, not as a headline', async ({ page }) => {
  await page.goto('/theft/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.context__head').first()).toContainText('context, not a success target');
  // the enforcement-context block comes after the chart in the DOM
  const firstCard = page.locator('.scorecard').first();
  const chartY = await firstCard.locator('.chart-host').boundingBox();
  const ctxY = await firstCard.locator('.context').boundingBox();
  expect(ctxY.y).toBeGreaterThan(chartY.y);
});

test('shows a prominent reporting-lag note and the evaluated month on each card', async ({ page }) => {
  await page.goto('/theft/index.html', { waitUntil: 'domcontentloaded' });

  // the note explains the lag and names the evaluated (settled) month
  const note = page.locator('#reporting-note');
  await expect(note).toContainText(/aren.t final/);
  await expect(note).toContainText('within 30 days');
  await expect(note).toContainText('12-month trend');
  // completeness estimate is surfaced (date-independent shape, not a hard-coded month/percent)
  await expect(note).toContainText(/~\d+% complete/);
  await expect(note).toContainText(/still to arrive|treat it as final/);

  // each card prominently labels the month being evaluated
  await expect(page.locator('.evaluating')).toHaveCount(3);
  await expect(page.locator('.evaluating__tag').first()).toContainText('latest settled month');

  // newest-month "peek": when the note says the headline is held back, cards preview the newer month
  // with its completeness — but a card whose newest-month count is 0 suppresses its peek (a "0 · ~96%
  // complete" tag would read as "more coming"). So expect 1–3 peeks, each with a non-zero count. When
  // the newest complete month is already final, no peek shows at all.
  const peeks = page.locator('.primary__peek');
  if (/hold the headline back/.test(await note.innerText())) {
    const n = await peeks.count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(3);
    await expect(peeks.first()).toContainText(/so far/);
    await expect(peeks.first()).toContainText(/~\d+% complete/i);
    // every rendered peek shows a real (non-zero) count — the zero-suppression guard
    for (const strong of await peeks.locator('strong').allTextContents()) {
      expect(Number(strong.replace(/[^\d]/g, ''))).toBeGreaterThan(0);
    }
  } else {
    await expect(peeks).toHaveCount(0);
  }

  // the note appears above the footnotes in the DOM
  const noteY = await note.boundingBox();
  const fnY = await page.locator('#footnotes').boundingBox();
  expect(fnY.y).toBeGreaterThan(noteY.y);
});

test('renders the vehicle-theft detail section: type mix, reported-hour histogram, top corners', async ({ page }) => {
  await page.goto('/theft/index.html', { waitUntil: 'domcontentloaded' });
  const detail = page.locator('#detail-sections .detail');
  await expect(detail).toHaveCount(1);

  // vehicle-type mix bars (auto/truck/motorcycle/other) + a reported-hour histogram of 24 bars
  await expect(detail.locator('.tbar')).toHaveCount(4);
  await expect(detail.locator('.hours .hour-bar')).toHaveCount(24);
  // exactly one peak hour is highlighted
  await expect(detail.locator('.hour-bar--peak')).toHaveCount(1);
  // the histogram is explicitly labelled as reported (not occurrence) hour
  await expect(detail).toContainText(/reported hour/i);
  // top corners render as ranked bars
  expect(await detail.locator('.cbar').count()).toBeGreaterThanOrEqual(1);
});

test('renders the shoplifting concentration map + scrubber (C/E)', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/theft/index.html', { waitUntil: 'domcontentloaded' });

  // the section exists with its mandatory single-store reporting caveat
  const section = page.locator('#shoplifting-map-section');
  await expect(section).toBeVisible();
  await expect(section.locator('.sm-caveat')).toContainText(/one store/i);

  // the map is deferred (IntersectionObserver) — scroll it in, then it initializes
  await section.scrollIntoViewIfNeeded();
  await page.waitForSelector('#sm-map path.leaflet-interactive');

  // scrubber: five presets, a brushable strip, exactly one shaded still-settling month
  await expect(page.locator('#sm-presets .sm-seg[data-preset]')).toHaveCount(5);
  expect(await page.locator('#sm-strip .sm-bar').count()).toBeGreaterThan(12);
  await expect(page.locator('#sm-strip .sm-bar.is-settling')).toHaveCount(1);

  // count-sized markers + a ranked side list + the cross-street search box
  expect(await page.locator('#sm-map path.leaflet-interactive').count()).toBeGreaterThan(0);
  expect(await page.locator('#sm-list .sm-rank').count()).toBeGreaterThan(0);
  await expect(page.locator('#sm-search .map-search-input')).toHaveCount(1);

  // switching the window preset re-labels and re-aggregates
  const label = page.locator('#sm-window-label');
  await expect(label).toContainText('mo)');
  const before = await label.textContent();
  await page.locator('#sm-presets .sm-seg', { hasText: 'All time' }).click();
  await expect(label).not.toHaveText(before);
  await expect(label).toContainText('Jan 2021');   // history starts 2021 (2020 excluded) — stable anchor

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('shows the excluded-category footnote (D9)', async ({ page }) => {
  await page.goto('/theft/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#exclusion-note')).toContainText('Theft from Merchant or Library');
});

test('source footnotes render with rationale and runnable query links', async ({ page }) => {
  await page.goto('/theft/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#footnotes li');

  // a footnote per tracked signal + the exclusion + the axes note
  await expect(page.locator('#fn-shoplifting')).toContainText('Shoplifting');
  await expect(page.locator('#fn-commercial')).toContainText('Commercial');
  await expect(page.locator('#fn-excluded')).toContainText('Theft from Merchant or Library');
  await expect(page.locator('#fn-axes')).toContainText('Reported by businesses');
  await expect(page.locator('#fn-vehicle')).toContainText('context'); // vehicle shown as context

  // each footnote ref in the source text jumps to a real footnote
  for (const href of await page.locator('.fnref').evaluateAll(a => a.map(x => x.getAttribute('href')))) {
    await expect(page.locator(href)).toHaveCount(1);
  }

  // exact queries are runnable Socrata links
  const links = await page.locator('#footnotes a[href*="data.sfgov.org/resource"]').count();
  expect(links).toBeGreaterThanOrEqual(3);
});

test('comparison deltas render as percentages with direction arrows', async ({ page }) => {
  await page.goto('/theft/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.chip__delta');
  for (const d of await page.locator('.chip__delta').allTextContents()) {
    expect(d).toMatch(/[▲▼]\s*\d+%|—/);
  }
});
