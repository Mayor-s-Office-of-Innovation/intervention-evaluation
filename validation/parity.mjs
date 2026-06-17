#!/usr/bin/env node
// V2 · classifier parity gate. Proves classify.js (the browser source of truth) reproduces the build's
// baked classification EXACTLY when fed the fixed Lurie-split preset — so moving classification to the
// client introduced no drift. Runs over ALL emitted cells (classified + null), then fuzzes random
// windows for structural invariants. Exit 0 = parity holds, 1 = mismatch.
//
//   node validation/parity.mjs [dashboard]      (default: drug)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyCells, ymRange } from '../drug/js/classify.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dash = process.argv[2] || 'drug';
const load = p => JSON.parse(readFileSync(join(ROOT, dash, 'data', p), 'utf8'));

const meta = load('transitions/_meta.json');
const SIGNAL = 'cfs_drug';
const cells = load(`transitions/${SIGNAL}.json`);
const sigMeta = meta.signals[SIGNAL];

const months = meta.months;
const knobs = { hot: sigMeta.hot_rate_per_month, floor: meta.knobs.floor, band: meta.knobs.tide_band };
const base = ymRange(months, meta.pre_window);     // fixed pre-Lurie baseline
const win = ymRange(months, meta.now_window);      // fixed "now" (trailing 3 complete)
// Category MUST match exactly (it's computed from unrounded values). The rate FIELDS are 2-dp display
// values; Python round() is half-to-even, JS half-up, so an exact .xx5 can differ by 0.01 — not a
// parity failure, so rates are compared within one display ulp.
const rateClose = (a, b) => Math.abs(a - b) <= 0.01 + 1e-9;

// ── 1. Parity vs the baked oracle, cell-by-cell ────────────────────────────
const got = classifyCells(cells, sigMeta.district_monthly, win, base, knobs);
const mismatches = [];
for (let i = 0; i < cells.length; i++) {
  const baked = cells[i], js = got[i];
  const issues = [];
  if ((baked.category ?? null) !== (js.category ?? null))
    issues.push(`category ${baked.category} → ${js.category}`);
  if (!rateClose(js.preRate, baked.preRate)) issues.push(`preRate ${baked.preRate} vs ${js.preRate.toFixed(3)}`);
  if (!rateClose(js.nowRate, baked.nowRate)) issues.push(`nowRate ${baked.nowRate} vs ${js.nowRate.toFixed(3)}`);
  if (!rateClose(js.expectedRate, baked.expectedRate))
    issues.push(`expected ${baked.expectedRate} vs ${js.expectedRate.toFixed(3)}`);
  if (issues.length) mismatches.push(`  ${baked.name || `${baked.lat},${baked.lng}`}: ${issues.join('; ')}`);
}

const bakedClassified = cells.filter(c => c.category).length;
console.log(`── parity · ${dash}/${SIGNAL} · ${cells.length} cells (${bakedClassified} classified) ──`);
if (mismatches.length) {
  console.log(`✗ ${mismatches.length} mismatch(es) vs baked oracle:`);
  console.log(mismatches.slice(0, 20).join('\n'));
  process.exit(1);
}
console.log(`✓ exact parity on all ${cells.length} cells (category + preRate/nowRate/expected)`);

// ── 2. Fuzz random windows for structural invariants ───────────────────────
const CATS = new Set(['persistent', 'cooled', 'emerged', null]);
let fuzzFails = 0;
const rand = (a, b) => a + Math.floor(((Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1 + 1) % 1 * (b - a));
for (let t = 0; t < 30; t++) {
  const lo = rand(24, months.length - 3 - t % 3);          // windows inside the Lurie era
  const hi = Math.min(months.length - 1, lo + 2 + (t % 6));  // ≥3 months (min-window guard)
  const out = classifyCells(cells, sigMeta.district_monthly, { lo, hi }, base, knobs);
  for (const c of out) {
    if (!CATS.has(c.category)) { fuzzFails++; console.log(`  bad category ${c.category} @win[${lo},${hi}]`); }
    if (c.total < 0 || c.preRate < 0 || c.nowRate < 0) { fuzzFails++; console.log(`  negative metric @win[${lo},${hi}]`); }
  }
}
if (fuzzFails) { console.log(`✗ ${fuzzFails} fuzz invariant failure(s)`); process.exit(1); }
console.log('✓ 30 random windows: every cell ∈ {persistent,cooled,emerged,null}, no negative metrics');
process.exit(0);
