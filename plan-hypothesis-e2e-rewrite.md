# Plan — rewrite the hypothesis e2e suite to the new interaction model

**Status: DONE.** Part of the `refresh-data-plus-search-intersections` bundle (workstream E tail).
Decision locked: **rewrite the suite now** (not skip/defer).

## Outcome
All 9 hypothesis tests pass (36.9s standalone). Full `npm test` = **45 passed, 1 skipped** (the known
CLS `test.fixme` in `homepage/tests/e2e.spec.js`) + build invariants hold + parity clean (drug &
unhoused). The overflow/Nordsense failure was **also just stale selectors** (`#chart-host` etc.), not
data drift — the overflow lever's `breaks:[{date:'2025-11-01', … Nordsense …}]` config was intact, so
fixing the selectors restored it. Only `hypothesis/tests/e2e.spec.js` was edited.

Rewrite shape shipped: added `collectErrors()` + `gotoReport(page, query=REPORT)` (enters via a
shared-link URL so `run()` auto-fires), kept `gotoApp()` for the two no-run tests (gate + dark mode),
dropped the obsolete `runAnalysis()`/`selectDataPoint()` helpers, and retargeted every selector from
the old single-panel ids to the `#panels [data-stats|data-chart|data-verdict]` structure.

## Why (diagnosis — a pre-existing break on `main`)
The "interventions flow UI overhaul" (`d1bdd28`) rewrote `hypothesis/index.html` + `js/app.js`
(+297 lines) but **never touched `hypothesis/tests/e2e.spec.js`**. `main`'s spec is byte-identical to
the pre-overhaul one and drives an interaction model the app no longer has.

It stayed green because **no CI job ever ran hypothesis**:
- `deploy.yml` on `main` gated on 4 baked suites only (`-c {homepage,drug,unhoused,theft}/…`), excluding
  hypothesis (live-Socrata = flaky gate) and districts.
- `trace.yml` runs only `validation/trace.py drug|unhoused` (no Playwright).
- Local `npm test` on `main` = `playwright test -c hypothesis/playwright.config.js` (only hypothesis) —
  its failures were written off as "network flakiness."

The harness consolidation + workstream E's `../../shared/` import (which finally lets the module load
under the single root server) is what surfaced it. Net effect of this PR = a **stricter** gate than main.

## New interaction model (how analysis actually runs now)
- `#run-btn` = **"Submit intervention"** → `handleSubmit` (app.js:139). Requires `#in-submitter` +
  fields; with none, it bails validation and **never runs analysis**. The old `runAnalysis()` helper
  (click `#run-btn` → wait `#results`) is obsolete.
- Analysis (`run()`, app.js:544) is triggered by:
  1. **Shared-link auto-run** on load — `readParams()` truthy (any of `dp` / `lat`+`lng` / `from`+`to`)
     → `run(true)` (app.js:148-149). **This is the reliable test entry point.**
  2. selection-change / slider-change **only when `hasRun`** already true (app.js:93,105,136) — so an
     initial shared-link run enables subsequent live re-runs (date/radius slider tests still work).
  3. after a successful submit (app.js:342/356) and on `?view=ID` load (app.js:218).

## DOM selector changes (old single-panel → new multi-panel)
Results now render one panel per selected lever under `#panels`:
| Old (stale in spec) | New |
|---|---|
| `#stat-cards .stat` | `#panels [data-stats] .stat` (per lever `[data-stats="i"]`) |
| `#chart-host svg …` | `#panels [data-chart] svg …` |
| `#verdict-body` | `#panels [data-verdict]` |
| `#chart-title` (selectDataPoint waited on this) | `.lever-panel .panel__title` ("… over time"); no `#chart-title` |
Unchanged & still valid: `#results`, `#methodology-body .method-src__link a`, `#events-map path.leaflet-interactive`,
`#range-slider`, `#range-readout`, `#range-suggest`, `#radius-slider`, `#coords-readout`, `line.chart-break`,
`#verdict-body .verdict-warn` text is now `[data-verdict] .verdict-warn`, `#picker-map img.leaflet-tile`.

Levers are a **multi-select** `wa-select` (`#in-expect` has `multiple`); value is an array of keys.

## Per-test rewrite plan (9 tests)
1. **loads & lists data points** — ✅ DONE. Assertion now derives from `DATAPOINTS` registry (import), not a
   hardcoded 5-list. Passes (9.5s).
2. **respects OS dark mode** — ✅ already passes (no run). Leave as-is.
3. **overflow reporting break** — auto-run path works (shared link), but the `line.chart-break` /
   "Nordsense" assertion FAILS → **investigate as data-refresh drift** (does the overflow lever still
   carry the Nov-2025 Nordsense `break`? check `datapoints.js` overflow entry `.breaks`). Separate from
   the model fix.
4–9. **runs default / homelessness aggregate / date slider / radius slider / smart default / save-share** —
   rewrite each to enter via a **shared-link URL** (`?dp=…&lat=…&lng=…&r=…[&from=&to=]`) so `run()` auto-fires,
   then retarget selectors to the `#panels [data-*]` structure. For homelessness, set `dp=homeless_presence`
   and assert 2 `method-src__link` sources (2zdj-bwza + vw6y-z8j6). For save-share, set `#in-what` via the
   URL `what=` param (readParams applies it) and assert `syncURL` round-trip params.

   New shared helper to replace `runAnalysis(page)`:
   ```js
   // Enter via a shared link so the app auto-runs (no Run button anymore).
   async function gotoReport(page, params = '') {
     const errors = collectErrors(page);
     const base = '?dp=drug&date=2026-05-13&lat=37.77346&lng=-122.42736&r=250';
     await page.goto(`./${base}${params}`, { waitUntil: 'networkidle' });
     await page.waitForSelector('#results:not([hidden])');
     await page.waitForFunction(() => document.querySelectorAll('#panels [data-stats] .stat').length > 0);
     return errors;
   }
   ```

## Verify when done
`npx playwright test --project=hypothesis` all green, then full `npm test`. Consider adding hypothesis
back to the deploy gate? — NO (keep it out of `deploy.yml`; live-Socrata is still a flaky gate). It runs
in local `npm test` only, which is the intended stricter local gate.

## Resume pointer
Next action: write the `gotoReport` helper + rewrite tests 4–9, then investigate the overflow `.breaks`
drift (#3). Files: `hypothesis/tests/e2e.spec.js` (only file to edit for the rewrite),
cross-ref `hypothesis/js/app.js` run()/readParams()/renderAllWindows() + `index.html` #panels structure.
