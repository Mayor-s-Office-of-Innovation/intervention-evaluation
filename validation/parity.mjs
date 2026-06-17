#!/usr/bin/env node
// V2 · classifier parity gate. Proves classify.js (the browser source of truth) reproduces the build's
// baked classification EXACTLY when fed the fixed Lurie-split preset — so moving classification to the
// client introduced no drift. Runs over EVERY transition signal in the dashboard (classified + null
// cells), then fuzzes random windows for structural invariants. Exit 0 = parity holds, 1 = mismatch.
//
//   node validation/parity.mjs [dashboard]      (default: drug)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyCells, ymRange } from '../shared/classify.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dash = process.argv[2] || 'drug';
const load = p => JSON.parse(readFileSync(join(ROOT, dash, 'data', p), 'utf8'));

const meta = load('transitions/_meta.json');
const months = meta.months;
const base = ymRange(months, meta.pre_window);     // fixed pre-Lurie baseline
const win = ymRange(months, meta.now_window);      // fixed "now" (trailing 3 complete)
// Category MUST match exactly (computed from unrounded values). The rate FIELDS are 2-dp display
// values; Python round() is half-to-even, JS half-up, so an exact .xx5 can differ by 0.01 — compared
// within one display ulp.
const rateClose = (a, b) => Math.abs(a - b) <= 0.01 + 1e-9;
const CATS = new Set(['persistent', 'cooled', 'emerged', null]);

let failed = false;
for (const signal of Object.keys(meta.signals)) {
  const sigMeta = meta.signals[signal];
  const cells = load(`transitions/${signal}.json`);
  const knobs = { hot: sigMeta.hot_rate_per_month, floor: meta.knobs.floor, band: meta.knobs.tide_band };

  // 1. Exact parity vs the baked oracle, cell-by-cell
  const got = classifyCells(cells, sigMeta.district_monthly, win, base, knobs);
  const mismatches = [];
  for (let i = 0; i < cells.length; i++) {
    const baked = cells[i], js = got[i], issues = [];
    if ((baked.category ?? null) !== (js.category ?? null)) issues.push(`category ${baked.category} → ${js.category}`);
    if (!rateClose(js.preRate, baked.preRate)) issues.push(`preRate ${baked.preRate} vs ${js.preRate.toFixed(3)}`);
    if (!rateClose(js.nowRate, baked.nowRate)) issues.push(`nowRate ${baked.nowRate} vs ${js.nowRate.toFixed(3)}`);
    if (!rateClose(js.expectedRate, baked.expectedRate)) issues.push(`expected ${baked.expectedRate} vs ${js.expectedRate.toFixed(3)}`);
    if (issues.length) mismatches.push(`    ${baked.name || `${baked.lat},${baked.lng}`}: ${issues.join('; ')}`);
  }
  const nClassified = cells.filter(c => c.category).length;
  if (mismatches.length) {
    console.log(`✗ ${dash}/${signal}: ${mismatches.length}/${cells.length} mismatch(es) vs baked oracle:`);
    console.log(mismatches.slice(0, 12).join('\n'));
    failed = true;
    continue;
  }

  // 2. Fuzz random windows for structural invariants
  let fuzzFails = 0;
  for (let t = 0; t < 20; t++) {
    const lo = 24 + (t % Math.max(1, months.length - 27));
    const hi = Math.min(months.length - 1, lo + 2 + (t % 6));
    for (const c of classifyCells(cells, sigMeta.district_monthly, { lo, hi }, base, knobs)) {
      if (!CATS.has(c.category) || c.total < 0 || c.preRate < 0 || c.nowRate < 0) fuzzFails++;
    }
  }
  if (fuzzFails) { console.log(`✗ ${dash}/${signal}: ${fuzzFails} fuzz invariant failure(s)`); failed = true; continue; }
  console.log(`✓ ${dash}/${signal}: ${cells.length} cells (${nClassified} classified) — exact parity + 20 fuzzed windows clean`);
}
process.exit(failed ? 1 : 0);
