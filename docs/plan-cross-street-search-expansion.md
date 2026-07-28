# Plan — data refresh + harden + expand cross-street search

A bundled pass. The headline feature (Workstream E) extends the offline cross-street search to
three more maps, but since the data is ~4+ weeks stale we're wedging in a full refresh-and-harden
first so everything published is current and accurate.

## ⏸ RESUME POINT (last updated end-of-Workstream-C-fixes, 2026-07-27)

**Order being executed:** A ✅ → D ✅ → C ✅ (incl. C-validate) → **E → G → B → F**. User runs git himself; everything lands in ONE PR on branch `refresh-data-plus-search-intersections`.

**Ordering change (2026-07-27):** B (dashboard-review pass) moved to **after E & G** — review everything once, after all the building is done, rather than re-auditing after each change.

**All 5 C-fixes + Tier-2 links are now COMPLETE (uncommitted):**
- drug #1/#2/#3 — `drug/js/app.js` (hotspot window wording, needle per-district removed, −18%→−19%).
- theft #4 + citywide — `theft/js/app.js` `renderFootnotes` (per-district + citywide links, client-side; verified live).
- homepage #5 — `js/app.js` `fetchEmergingSignal`/`getKRData` (real 1-mo change, no longer == 3-mo).
- Tier-2 recent-activity link — `shared/recent-activity.js` `redraw()` (dataset id + runnable query; covers drug+unhoused).
- Tier-2 homepage methodology — NEW `renderMethodology()` in `js/app.js` + `<div id="home-methodology">` in `index.html` footer; renders a `<details>` "Sources & method" listing the 3 emerging signals (fraud/dog_bites/street_robbery) per district with runnable monthly-series links, built from `EMERGING_SIGNALS`+`DISTRICT_KR3` so links always match what's fetched. No new CSS (inherits footer; centralize in Workstream E if desired).
- Theft "for Northern" wording (`theft/index.html` ~L83) — reworded to "spot-checked in Northern: ~99% consistent with point-in-polygon" so it reads as a validation spot-check, not a Northern-only method. (was plan REMAINING item 1)

**Done & verified:**
- **A** — data refresh (drug/unhoused/theft through 2026-07); trace 0.00% drift; committed by user.
- **D** — README rewritten (intro + "Built with" links to web-dev & dashboard-review skills; stale last line dropped). Uncommitted.
- **C-verify** — all 5 Tier-1 footnote defects independently confirmed in code. NOTE: the drug audit agent's line numbers were wrong — drug methodology text is **JS-rendered in `drug/js/app.js`**, not `index.html`.
- **C-fix drug #1/#2/#3** (`drug/js/app.js`): `#1` hotspot wording "last 3 complete months" → "time window selected on the chart above (by default, since Lurie's inauguration)" (~L499). `#2` removed unreproducible per-district needle %s → qualitative citywide statement + "311 has no reliable police district" note (~L485-491). `#3` "−18%" → "−19%" to match provenance/signals (~L485).
- **C-fix theft #4 + Tier-2 citywide** (`theft/js/app.js` `renderFootnotes`): query links now built CLIENT-SIDE from build-generated `filter`, keyed to `active` district (`districtQueryUrl`/`citywideQueryUrl` mirror `build.py` exactly — no re-pull). Added "In SF context" footnote. **Verified live**: Mission + citywide links return data. `build.py` left as-is (its baked Northern-only `query_url` is now vestigial for signals).

**C-validate — DONE ✅ (2026-07-27), all green except one pre-existing test deferred:**
- `validate_build.py` ✓ (districts/drug/theft/unhoused invariants hold) · `parity.mjs drug|unhoused` ✓ (exact + fuzzed) · `trace.py drug|unhoused` ✓ (every signal 0.00% drift).
- e2e per-dashboard (run ISOLATED — see gotcha below): homepage 3✓/1 skipped · drug 9✓ · unhoused 12✓ · theft 7✓ (incl. "runnable query links" — validates the C footnote work).

**⏭ NEXT ACTION when resuming: Workstream E** (cross-street search expansion — the original ask). Then G (2wk chip — **decisions locked & revised 2026-07-27**: weekly build series for ALL baked signals, YoY basis, 2wk on EVERY card, and **all chips (2wk/1mo/3mo) switch to each dashboard's latest _settled_ endpoint** — fixes a latent complete-vs-settled mismatch, shifts theft ~2mo / drug ~1mo; see Workstream G §DECISIONS LOCKED), then B (dashboard-review pass over everything), then F (docs move).

**Two findings parked for a debug follow-up (NOT caused by C — verified):**
1. **Pre-existing CLS regression** — `homepage/tests/e2e.spec.js` "tool cards do not shift…" fails a deterministic **21px** (reserved `.section-interventions` min-height no longer absorbs the first saved row). **Confirmed pre-existing**: fails identically with ALL branch work `git stash`ed, so it predates the Workstream C pass. Marked `test.fixme(...)` with a FIXME comment (not deleted) to unblock the branch. Debug: recheck reservation vs actual row height; compare to `main`.
2. **`npm run test:all` server contention** — the chained `&&` run spins a fresh http-server (port 8090) per config without tearing down the previous one; back-to-back configs then hit `page.goto` timeouts (unhoused showed 7 spurious fails in the chain, **all 12 pass in isolation**). Workaround: `pkill -f http-server` between configs, or run per-dashboard (`test:drug`/`test:unhoused`/etc.). Real fix (later): teardown/port handling in the configs or the `test:all` script.

*(Prior REMAINING items 1–4 — theft "for Northern" wording, homepage #5 1-mo badge, recent-activity link, homepage methodology — all DONE; see the "All 5 C-fixes + Tier-2 links are now COMPLETE" list above.)*

## Bundled workstreams (recommended order)

| # | Workstream | Why | Depends on |
|---|---|---|---|
| A | **Refresh pre-computed data** from latest Socrata pulls | ~4+ wks stale; do first so reviews run against current numbers | — |
| B | **Dashboard-review skill pass** on each dashboard | Accuracy/sources/tone audit — **run last, after E & G** so it reviews the final built state in one pass | A, E, G |
| C | **Footnote audit** — every major chart has an accurate source footnote | Provenance is a core project promise | A (numbers), overlaps B |
| D | **README review** — good intro + link the skills used | Front door of the repo; currently ends on a stale plan ref | — (independent) |
| E | **Expand cross-street search** to picker + both hexbin maps | The original ask | — (independent) |
| F | **Move root-level plan docs into `docs/`** | Tidy the repo root; a `docs/` convention already exists | — (independent) |
| G | **Add a "2-week" interval chip** to homepage OKR KR tickers (beside 1mo/3mo) | New ask (2026-07-27); shorter-horizon read | E; **decisions locked/revised** (weekly build series for all baked signals · YoY · 2wk on every card · all chips → latest _settled_ endpoint, labeled + footnoted) |

A → B/C run in sequence (refresh, then audit the refreshed output). D and E are independent and
can happen anytime. Per the house rule, **stop-and-report on any validation mismatch** during A
before committing.

---

## Workstream A — Refresh pre-computed data

Follow the existing **[plan-data-refresh.md](plan-data-refresh.md)** verbatim — it already has the
full pipeline (drug/unhoused 5-stage `01_pull→05_markers`, theft single `build.py`, then
`validate_build.py` / `parity.mjs` / `trace.py` / `npm run test:all`). Key points carried over:

- All builds are stdlib Python 3, anonymous read-only GETs — no token, no `pip install`.
- `provenance.json` `generated` date + partial/settled-month shading recompute from `date.today()` —
  no manual date edits.
- Homepage has **no separate build** — it reads each dashboard's `data/aggregates.json` live, so the
  three rebuilds refresh it automatically. District-card emerging signals are live in-browser too.
- **Stop and report** on any source drift or unexplained count cliff before committing (see
  [[civic-timeseries-baselines-2020]] for what counts as a real vs artifactual move; the trace
  harness [[e2e-data-trace-harness]] must tie out exactly).

Note: plan-data-refresh.md's staleness table is dated 2026-07-14; re-read each `data/provenance.json`
for the actual current `generated` dates before running.

## Workstream B — Dashboard-review skill pass

After A lands, run the **`dashboard-review`** skill against each shipped dashboard (drug, unhoused,
theft, and the homepage) — accuracy, source integrity, denominator/population conflation, simplicity,
neutral tone. Produce its severity-ranked findings doc and apply fixes on confirmation. This is a
re-audit of already-built dashboards (not scaffolding), which is exactly what the skill is for.

## Workstream C — Footnote / source-provenance audit

Enforce the project's provenance promise (see [[dashboard-source-provenance-footnotes]]): **every
major chart shows its dataset + a runnable query, and combined signals expose their component parts.**
For each dashboard:
1. Inventory every major chart/map/stat tile and confirm it has a corresponding source footnote.
2. Verify each footnote **accurately** describes the data pulled and the query used — reconcile the
   footnote text against the actual build query and the `trace.py` declared query (they must match the
   refreshed numbers from A). Watch for footnotes that drifted from the query during past edits.
3. Flag any chart missing a footnote, or any footnote whose described query no longer matches the code.

Overlaps B (the review skill also checks sources) — run C as the focused, chart-by-chart footnote
sweep and let B cover the broader audit.

## Workstream D — README review

`README.md` today is a solid structural intro (run-locally, tools table, layout, refresh, checks).
Changes wanted:
- Make sure it reads as a **good intro to the project** — what it is and why (OKR dashboards + hypothesis
  tool, every number traces to a runnable Socrata query, pre-baked static site).
- **Mention and link the skills** that shaped it, pointing at
  `https://github.com/Mayor-s-Office-of-Innovation/skills`:
  - the **dashboard-review** skill — used for data-quality / accuracy auditing (ties to Workstreams B/C).
  - the **web-dev** skill — used for building the site (lightweight, Core-Web-Vitals-first, accessible,
    web components + Web Awesome).
- **Drop the last line** (currently `README.md:84-85` — "The cross-cutting time-scrubber + validation
  work is documented in drug/plan-scrubber.md"). It points at one narrow internal plan and isn't a
  useful README closer; replace with nothing or a short pointer to the skills repo.

---

## Workstream F — centralize ALL plan/review docs into `docs/` (runs last, on its own)

**Decisions (2026-07-27):** move **everything** — every planning/review markdown repo-wide, including
the per-tool plans — into `docs/` (which already exists and holds `plan-interventions-by-district*.md`).
Run this **last, after A–E**, so the churn of moving + re-linking doesn't collide with edits the other
workstreams make to these same docs/README. `README.md` stays at root.

**Naming: mirror the subdirs under `docs/`** — flattening collides (four `plan.md` + `PLAN.md`). So
`drug/plan.md → docs/drug/plan.md`, `hypothesis/PLAN.md → docs/hypothesis/PLAN.md`, etc. Root docs go
straight into `docs/`. Use **`git mv`** so history follows.

**Full inventory to move (~28 docs):**
- Root: `plan-cross-street-search.md`, `plan-cross-street-search-baked-index.md`,
  `plan-cross-street-search-expansion.md` (this file), `plan-data-refresh.md`,
  `plan-hotspots-enhancements.md`, `plan-hotspots-hourly-map.md`, `plan-inline-edit.md`,
  `plan-layout-shift.md`, `plan-photo-uploads.md`, `plan-recent-activity-map.md`,
  `dashboard-refresh-review.md`, `recent-activity-review.md`
- `drug/`: `plan.md`, `plan-scrubber.md`, `plan-cell-details.md`, `plan-time-of-day.md`
- `unhoused/`: `plan.md`, `plan-map-tod-filter.md`, `plan-remove-zoom-markers.md`
- `theft/plan.md`, `districts/plan.md`
- `hypothesis/`: `PLAN.md`, `levers-audit.md`, `plan-form-ux-fixes.md`, `plan-form-ux-v2.md`,
  `plan-multi-lever-analysis.md`, `plan-one-pager.md`, `plan-retire-edit-page.md`
- `validation/TESTPLAN.md`
  *(Note: `validation/TESTPLAN.md` and `hypothesis/levers-audit.md` are tightly coupled to their dirs;
  included per the "everything" decision — flag at execution if co-location reads better.)*

**References that must be updated after the move** (grep `plan[-a-z]*\.md`, `PLAN.md`, `TESTPLAN.md`,
`*-review.md`, `levers-audit.md` hits in):
- `README.md` (tools table + refresh section links point at several of these)
- Code comments referencing plan files: `drug/index.html`, `unhoused/index.html`, `unhoused/js/app.js`,
  `shared/classify.js`, `shared/hotspots-panel.js`, `interventions-api/src/index.js` (+ re-grep all)
- Cross-references between the plan docs themselves (many link to siblings)
- The already-in-`docs/` files that link to root plans
- Memory `MEMORY.md` pointers name some paths (e.g. `plan-data-refresh.md`, `drug/plan-scrubber.md`) —
  update those so recall stays accurate (external to repo; separate edit).

**Verify after:** re-grep for any surviving path to a moved file (broken links); `npm run test:all`
(the homepage e2e references a plan path in a comment only, but confirm nothing code-path breaks).

## Workstream E — expand cross-street search to more map widgets

Extends the offline cross-street search (baked SF corner index, see
`plan-cross-street-search.md` and `plan-cross-street-search-baked-index.md`) from the ONE
map it lives on today to three more. **No Nominatim / no external geocoder** — everything
below is the fully-offline baked-index lookup.

## Where it lives today (the one map with search)

The D11/D12 transition/**hotspots** map, first on `./drug` and `./unhoused`.

| Concern | Code |
|---|---|
| Search UI (form/input/status, event handlers) | `wireSearch()` — `shared/hotspots-panel.js:60` |
| Tiered match logic + baked-index load | `searchIntersections()` — `shared/transition-map.js:475`; `ensureCityIntersections()` :420 |
| Pure helpers | `streetTokens` :367, `matchIndex` :454, `distMeters` :446, `NEARBY_M` :443 |
| Map actions (Leaflet) | `focusCellById` :505, `showSearchResult` :515, `clearSearchResult` :528 |
| Baked index | `shared/data/sf-intersections.json` (built by `shared/build/build_intersections.py`) |
| Per-page (duplicated) | `<div id="map-search">` in each index.html; `.map-search-*`/`.search-marker*` CSS copy-pasted into `drug/styles.css` + `unhoused/styles.css` |

**The core problem for reuse:** `wireSearch` is hard-wired to `transition-map.js`. Its results
switch on transition-map concepts (hotspot cell vs reported corner) and its map actions
(`focusCellById`, `showSearchResult`) operate on transition-map's *module-level* `map`,
`cellMarkers`, `lastCells`, `markerData`, `searchMarker`. It can't be pointed at another map
as written.

What **is** already reusable (pure, no map/data coupling): `streetTokens`, `matchIndex`,
`distMeters`, and `ensureCityIntersections` (module-relative fetch of the baked index — resolves
from any dashboard, deploy.yml already ships `shared/data/`).

## The three target widgets

| # | Widget | File | Map | Has local activity data? | Action on hit |
|---|---|---|---|---|---|
| 1 | Hypothesis "add intervention" location picker | `hypothesis/js/map.js:42` (`initPicker`) | Leaflet, click/drag to drop a pin | **No** — pure picker | Move the existing pin (`setLocation`) |
| 2 | Recent-activity **hexbin** (drug) | `shared/recent-activity.js:110`/`275` | Leaflet, hand-rolled hexbins | **Yes** — `allRows` w/ intersection `name`s | Pan + drop temp pin |
| 3 | Recent-activity **hexbin** (unhoused) | same shared module | same | same | same |

#2 and #3 are the **same shared module**, so wiring it once covers both pages.

## Recommended approach — extract a reusable search core

### Step 0 — `shared/cross-street-search.js` (new module)
Move the reusable pieces out of `transition-map.js`:
- `STREET_SUFFIX`, `streetTokens`, `matchIndex`, `distMeters`, `NEARBY_M`, `ensureCityIntersections`.
- Add `buildLocalIndex(entries)` — the generic guts of `buildIntersectionIndex` (token-index a
  `[{name,lat,lng,...}]` list), *without* the transition-map-specific cell/marker sources.
- Generalize `wireSearch({ containerSel, label, placeholder, resolve, onLocate, onClear, statusFor })`:
  - `resolve(query) → result` — caller-supplied tiered matcher. Ship a `makeResolver({ localEntries, nearbyMeters })` factory so simple callers don't hand-write it.
  - `onLocate(lat,lng,name,result)` / `onClear()` — caller-supplied map actions.
  - `statusFor(result)` — optional; default keeps today's need-two/local/city/none/error wording.

`transition-map.js` re-imports these (or keeps thin wrappers) so the hotspots map is
behavior-identical. `hotspots-panel.js`'s `wireSearch` becomes a thin call into the generic one
with transition-map's callbacks. **Also fix the stale "Nominatim" docstring** at
`hotspots-panel.js:55`.

Risk: low/mechanical. Verify the hotspots map still searches identically on both pages after the move.

### Step 1 — Hypothesis picker (simplest)
- Add a `<div id="picker-search">` above/below `#picker-map` in `hypothesis/index.html:91`; add the
  `.map-search-*` CSS (see CSS note below).
- In `initPicker` (or `app.js` after it builds the picker), call the generic `wireSearch` with:
  - `resolve` = **city index only** (no local tier — a picker has no activity data). Statuses collapse
    to found / need-two / no-results-in-SF.
  - `onLocate(lat,lng)` = `picker.setLocation({lat,lng})` — reuses the existing commit path (moves pin +
    radius circle, fires `onChange`). No new marker code needed.
- Effort: ~1 hr. Cleanest of the three; no honesty caveats (it makes no activity claims).

### Step 2 — Recent-activity hexbin (drug + unhoused at once)
- Add a `<div id="ra-search">` near `#ra-map` in **both** `drug/index.html:148` and
  `unhoused/index.html:153`; shared CSS.
- Call `wireSearch` **from inside** `initRecentActivity` (so it closes over `map`, `allRows`, and a
  per-instance search marker — recent-activity has no module-level state, which is actually clean):
  - `resolve` = local tier from `buildLocalIndex(allRows)` (corners with recent reports) → city index
    fallback. Rebuild the local index whenever `allRows` changes (signal switch / window reload in `load()`).
  - `onLocate(lat,lng,name)` = `map.setView([lat,lng], ~16)` + drop/replace a temp `L.marker`
    (same divIcon pattern as `showSearchResult`). `onClear` removes it.
  - **Honesty caveats to preserve** (this codebase cares — see the existing NEARBY_M note):
    - District-scoped map: a searched corner outside the district must say so plainly, not silently
      pan off into an empty area.
    - "No recent reports at this corner" vs the NEARBY_M block-attribution softening still applies.
    - Optional/deferred: open the containing hex's popup. Hard — hexes are binned in *screen space* and
      rebuilt on `moveend`, so the bin under the point changes after `setView`. Recommend **pin-only**
      for v1; revisit hex-highlight later.
- Effort: ~2–3 hrs (one implementation, both pages).

### CSS note
Today `.map-search-*` / `.search-marker*` are copy-pasted in `drug/styles.css` +
`unhoused/styles.css`. Adding two more consumers is the moment to **centralize** into one shared
stylesheet (or a shared `<style>` the modules already rely on) rather than a third/fourth copy.

## Effort summary
- Step 0 (extract core): ~1–2 hrs, low risk, mechanical.
- Step 1 (picker): ~1 hr.
- Step 2 (hexbin, both pages): ~2–3 hrs.
- Order: 0 → 1 (proves the generic API on the trivial case) → 2.

## Resolved decisions (2026-07-27)
1. **Hexbin search scope: within-district only.** A corner outside the current district is
   rejected with a clear note — no silent pan into empty area off the district.
2. **Hexbin hit UX: pin-only for v1.** Pan + drop a temp marker; do NOT try to open the
   containing hex's popup (screen-space rebinning makes it fragile). Revisit later.
3. **Centralize the search CSS.** Move `.map-search-*` / `.search-marker*` into one shared
   stylesheet as part of Step 0, before adding the two new consumers (removes the existing
   drug/unhoused duplication too).

---

## Workstream G — add a "2-week" interval chip to the homepage OKR KR tickers

**Ask (2026-07-27):** the homepage district OKR cards show each KR as a ticker row with **two**
change chips — **1mo** and **3mo**. Add a **2-week** chip alongside them.

### Where it lives
- Ticker render: `renderKRTicker()` — `js/app.js:196`. Header row labels the columns `1mo` / `3mo`
  (`js/app.js:218-219`); each KR row emits two `renderChangeBadge(...)` calls (`:207-208`).
- Badge: `renderChangeBadge(change, goal, label)` — `js/app.js:184` (null → sized `—` slot).
- Data, **two paths**:
  - **Baked signals** (`cfs_drug`, `dealer_arrests`, `encampment`, `cfs_homeless`, `shoplifting`,
    `commercial`): `getKRData()` reads a **MONTHLY** series from each dashboard's `aggregates.json`
    and derives 1mo/3mo by month index (`js/app.js:167-179`). **No sub-monthly granularity exists.**
  - **Live emerging signals** (`fraud`, `dog_bites`, `street_robbery`): `fetchEmergingSignal()`
    computes windows live from Socrata `wg3w-h783` over arbitrary date ranges (`js/app.js:667-709`).

### The core problem — 2wk is not derivable from the baked monthly data
A 2-week change is one extra window pair for the **live** emerging signals, but **cannot** be computed
from the baked **monthly** series. Uniformly adding a 2wk chip forces a data-source choice:

| Opt | Approach | Cost / risk |
|---|---|---|
| **A** | Live-fetch 2wk for **all** homepage KRs (baked + emerging) straight from each signal's Socrata source in-browser | Uniform, no build change — but the homepage must know every baked signal's raw filter (today only the dashboards do → duplicate or share them), adds live fetches, and makes a headline chip depend on live Socrata. Fill async like emerging already does. |
| **B** | Add a **weekly** series (or a small trailing-weeks block) to each build so `getKRData` computes 2wk offline like 1mo/3mo | Keeps homepage offline-first + consistent — but touches all 3 build pipelines + `provenance.json` + `trace.py`, and weekly settling/lag is messier than monthly. |
| **C** | 2wk chip **only** on the live emerging signals; baked rows show 1mo/3mo (2wk = `—`) | Cheapest — but ragged columns across rows; reads as missing data. |

### Two decisions that are independent of A/B/C
1. **Comparison basis.** Existing chips are **YoY** (vs the same period last year) to control seasonality.
   A 2-week YoY delta is **very noisy** (small n, day-of-week + holiday effects). Choose: (i) keep YoY
   (2wk vs same 2wk last year) for consistency + add a volatility caveat; (ii) 2wk vs **prior** 2wk
   (responsive momentum, but seasonal); (iii) reconsider whether 2wk is meaningful at these volumes.
2. **Reporting-lag caveat (strongest objection).** The dashboards deliberately evaluate the latest
   **settled** month because police/CFS reports fill in for weeks. A 2-week window sits **inside the
   unsettled zone**, so a 2wk "drop" is likely a reporting artifact, not a real move — especially for
   theft/CFS. If we ship 2wk we must surface this, or exclude the lag-heavy signals.

### ✅ DECISIONS LOCKED (2026-07-27, revised same day)
1. **Data source → Weekly build series (B), for ALL baked signals.** Compute 2wk offline from a new
   weekly (or daily→weekly) array baked into **all three** pipelines (drug: `cfs_drug`, `dealer_arrests`;
   unhoused: `encampment`, `cfs_homeless`; theft: `shoplifting`, `commercial`), with enough history to
   reach the same-2-weeks window a year back. Emerging live signals (`fraud`/`dog_bites`/`street_robbery`)
   compute their 2wk window live in `fetchEmergingSignal`.
2. **Comparison basis → YoY for all chips, incl. the new 2wk** (2wk = last 2 weeks vs the same 2 weeks
   last year). Keeps seasonality control + consistency. **Also fix the discoverability gap** the user hit
   (they didn't know the chips were YoY): explicit "vs same period last year" label — header/tooltip on
   each column **and** a line in the homepage "Sources & method" block (`renderMethodology()`).
3. **Reporting lag → 2wk EVERYWHERE, on the last _settled_ window, clearly labeled** (revises the earlier
   "exclude lag-heavy" call). Instead of dropping the `wg3w-h783` signals, shift the 2wk window back to the
   last *settled* period so it isn't built on still-filling data. No signals excluded.
4. **NEW — endpoint consistency: ALL chips (2wk/1mo/3mo) use each dashboard's latest _settled_ endpoint,
   clearly labeled.** This fixes a latent mismatch found 2026-07-27: the homepage chips today use latest
   **complete** month (`getKRData` `endIdx = hasPartial ? len-1 : len`, `js/app.js:168-169`), NOT settled —
   so the theft 1mo chip shows Jun-2026 while the theft dashboard headlines settled Apr-2026 (lag 2).
   Switching to settled aligns the homepage with each dashboard's own headline.
   **⚠️ Visible change:** existing 1mo/3mo numbers shift back by each dashboard's settle lag — theft ~2
   months, drug ~1 month, unhoused unchanged (no lag; 311/CFS is real-time). Reviewers will notice; call
   it out in the PR.

### Implementation (decisions locked — ready when its turn comes, after E)
- **Builds (all 3):** bake a weekly/daily count series for every baked signal, **plus a settled-cutoff
  date** (derive from the existing settle stats — theft already computes `median_days`/`within_30_pct`/
  `p90_days`; drug/theft have `settle_lag_months`, unhoused has none → cutoff = latest complete). The
  "last settled 2-week window" = the trailing 14 days ending at that cutoff. Update `provenance.json` +
  `trace.py` for the new series (0.00% drift bar still applies).
- **`getKRData`:** switch `endIdx` from latest-complete to the **latest-settled** index
  (`data.latest_settled_month` when present, else `latest_complete_month`) — this alone shifts 1mo/3mo.
  Add `change2wk` from the new weekly series against the settled cutoff.
- **`fetchEmergingSignal`:** shift its window endpoints back by the `wg3w-h783` settle lag (so emerging
  1mo/3mo match the new settled basis) and add the settled 2wk window.
- **`renderKRTicker`:** add a `2wk` column for **all** cards (`:218` header + a third `renderChangeBadge`
  at `:207`). Every row now has 2wk, so no ragged/omitted columns.
- **Labels + footnote (user spec, 2026-07-27):** each OKR card carries a short visible label along the
  lines of *"YoY comparison (controls for seasonality), through the last settled period"* with a `[n]`
  ref that links to a **new footnote at the bottom of the homepage** explaining (a) what "settled" means
  (data older than each dataset's reporting/approval lag, so counts won't keep filling in), (b) where it
  comes into play (the chip endpoints are pinned to the settled cutoff, not "today"), and (c) why YoY
  (seasonality control). Per-column headers/tooltips still state the specific window ("last 2 weeks vs
  same 2 weeks last year, through <settled date>"); 2wk tooltip also notes the shorter, noisier horizon.
  Fold the same explanation into `renderMethodology()` so JS-off degrades gracefully. (Homepage has no
  footnote list today — this adds the first one; keep it consistent with the dashboards' footnote style.)
- **CLS check:** a third badge widens the ticker; badges sit in fixed-size slots — verify no layout jump
  (the homepage 21px CLS test is already `test.fixme`'d and unrelated).
- **Tests:** extend `homepage/tests/e2e.spec.js` (2wk present on every card; label assertions). Re-validate
  after the endpoint shift — the dashboards' own `data↔UI` e2e keys off settled already, so those are
  unaffected; the shift is homepage-side.

**Sequencing:** after **E** (per the 2026-07-27 reorder), then B reviews it. Touches `js/app.js` homepage
render + **all three** builds (`provenance.json`/`trace.py` follow). Decisions locked; not started.
