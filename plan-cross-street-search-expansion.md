# Plan — data refresh + harden + expand cross-street search

A bundled pass. The headline feature (Workstream E) extends the offline cross-street search to
three more maps, but since the data is ~4+ weeks stale we're wedging in a full refresh-and-harden
first so everything published is current and accurate.

## Bundled workstreams (recommended order)

| # | Workstream | Why | Depends on |
|---|---|---|---|
| A | **Refresh pre-computed data** from latest Socrata pulls | ~4+ wks stale; do first so reviews run against current numbers | — |
| B | **Dashboard-review skill pass** on each dashboard | Re-audit accuracy/sources/tone after refresh | A |
| C | **Footnote audit** — every major chart has an accurate source footnote | Provenance is a core project promise | A (numbers), overlaps B |
| D | **README review** — good intro + link the skills used | Front door of the repo; currently ends on a stale plan ref | — (independent) |
| E | **Expand cross-street search** to picker + both hexbin maps | The original ask | — (independent) |
| F | **Move root-level plan docs into `docs/`** | Tidy the repo root; a `docs/` convention already exists | — (independent) |

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
