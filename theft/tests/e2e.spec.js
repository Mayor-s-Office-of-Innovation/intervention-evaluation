import { test, expect } from '@playwright/test';

// Structural smoke tests for the v1 theft dashboard: it loads the baked JSON,
// renders both reported-vs-enforced scorecards with charts, shows a verdict per
// card and the exclusion footnote, and logs no console errors.

test('renders both scorecards: primary reports stat, three comparisons, chart, verdict', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/theft/index.html', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.scorecard')).toHaveCount(2);
  await expect(page.locator('.scorecard__title')).toHaveText([
    'Shoplifting', 'Commercial burglary & robbery',
  ]);

  // primary reports figure per card + a chart
  await expect(page.locator('.primary__num')).toHaveCount(2);
  await expect(page.locator('.chart-host svg')).toHaveCount(2);

  // three reference comparisons per card (last month / a year ago / typical month)
  await expect(page.locator('.chip')).toHaveCount(6);
  await expect(page.locator('.chip__label')).toContainText([
    'vs last month', 'vs a year ago', 'vs typical month',
    'vs last month', 'vs a year ago', 'vs typical month',
  ]);

  // each card carries a plain-language verdict
  await expect(page.locator('.verdict')).toHaveCount(2);
  for (const v of await page.locator('.verdict').allTextContents()) {
    expect(v.trim().length).toBeGreaterThan(0);
  }

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('shows the SF-context strip: citywide trend + Northern share over time', async ({ page }) => {
  await page.goto('/theft/index.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.sf-context')).toHaveCount(2);
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
  await expect(note).toContainText('aren’t final');
  await expect(note).toContainText('within 30 days');
  await expect(note).toContainText('12-month trend');

  // each card prominently labels the month being evaluated
  await expect(page.locator('.evaluating')).toHaveCount(2);
  await expect(page.locator('.evaluating__tag').first()).toContainText('latest settled month');

  // the note appears above the footnotes in the DOM
  const noteY = await note.boundingBox();
  const fnY = await page.locator('#footnotes').boundingBox();
  expect(fnY.y).toBeGreaterThan(noteY.y);
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
