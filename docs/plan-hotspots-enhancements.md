# Plan — Hotspots view enhancements (re-implementation)

Companion to [`spec-hotspots-view.html`](spec-hotspots-view.html). This supersedes the raw review
of PR #32. See the deferred build option in [`plan-hotspots-hourly-map.md`](plan-hotspots-hourly-map.md).

## Status of PR #32 — abandoned as a diff
PR #32 ("Add hotspots view enhancements", zoya-r-khan) was built on a **pre-refactor `main`** and
**cannot be merged**. Since it was branched, `main` refactored the map:
- `126a1c1` "chuck the feature where you can drill down out of clustering mode" → removed the live
  marker layer (`renderMarkers`, `inMarkerMode`, `markerLayer`).
- `0f15ce9` "work these filters into the underlying data instead of computing them live."

Consequences (verified against current `main`):
- The PR imports **`setMapWindow`**, which no longer exists → the module import would throw and
  **the dashboard JS would fail to load entirely**. On a static site that auto-deploys from `main`,
  merging it would break the live dashboards.
- The 5 new APIs it adds (`setHourRange`, `setSplitView`, `getSplitView`, `onCellSelected`,
  `closeSelectedCell`) and its `renderMarkers()`/`inMarkerMode()` calls target a map that's gone.
- Its "Day vs night" markers always render 50/50 (never computed `nightPct`) — false data.
- Its hour slider is a dead control (no handler, `setHourRange` never called).
- ~100 lines of panel logic duplicated across the two `app.js` files.

**Decision:** salvage the *ideas*, not the diff. Re-implement cleanly on a **fresh branch off
current `main`**, with shared code. Nothing merges to `main` until verified in-app (main = live).

## Locked decisions
- **Approach:** fresh branch off `main`; shared code in `shared/`, not duplicated per dashboard.
- **Slider scope:** **panel-scoped only** (Option 1). The slider filters the *selected hotspot's*
  detail (hourly chart + "% of reports in window"), computed from marker points that already exist.
  It does **not** re-weight or re-classify the hotspot map — that would need baked hourly data we
  don't have (see deferred doc). No data-payload cost, fully honest.
- **Split markers:** honest, from the already-baked `monthly_day` / `monthly_night` arrays.
- **Scope:** Drugs + Unsheltered-homelessness dashboards only (both have the hotspots map). Not theft.

## Guardrails (accuracy is paramount — better to ship nothing than mislead)
- Every displayed number traces to real baked/marker data; **no placeholder or defaulted "even"
  splits presented as data**. If a cell lacks day/night volume, show "n/a", not 50/50.
- Marker **size and color must reflect the same filter/window** — never mix.
- Preserve existing behavior exactly: pin-a-cell → shareable URL (`selectedCellId`/`emitState`),
  deep-link restore (`queueRestore`/`pendingCellId`), the incident-type breakdown, and the
  parity-checked classification (`classify.js` `monthly` stays the oracle — do not touch it).
- Light **and** dark theme legible (manual toggle emits `themechange`); prefer `var(--…)` tokens.

---

## Current-main integration facts (what we build on)
- **Cells** (`{drug,unhoused}/data/transitions/<sig>.json`) carry: `lat,lng,name,district,category,
  preRate,nowRate,expectedRate,total,monthly[],monthly_day[],monthly_night[]`. Confirmed real,
  differentiated day/night (e.g. HYDE/O'FARRELL = 15% night). `monthly == monthly_day + monthly_night`.
- **Markers** (`data/markers/<sig>.json`) = `{coordScale, fields, pts}`; each `pt` is
  `[latE5, lngE5, dayIndex, hour, ...fields]`, `hour` ∈ 0–23 (all 24 present, verified). Lazy-loaded
  by `setMarkers(key, loaderFn)` for the per-cell breakdown.
- **Detail today** lives in the Leaflet popup: `renderCells` binds a popup with sparkline + "See
  details" button; `showCellDetails` injects an incident-type breakdown with granular tod chips
  (`getTimeBucket` → morning/afternoon/evening/night) via `computeBreakdown`.
- **Selection/URL:** `popupopen` sets `selectedCellId` + `emitState()`; `popupclose` clears it;
  deep-link opens the queued cell's popup. Any docked-panel design must keep this working.
- `renderMap()` in each `app.js` classifies via `classifyCells(..., monthly_${todFilter})` and calls
  `renderCells(classified, active, visibleCats)`, then `setMarkers(...)`.

---

## Work items

### A. Shared module for the new UI (`shared/hotspots-panel.js`)
House the docked-panel + split-view + panel-slider logic once; both `app.js` files import it.
Keeps parity and avoids the PR's duplication/drift.

### B. Change #2 — honest Day/Night split markers
1. In `renderMap()`, after `classifyCells`, compute per-cell `nightPct` over the **active window**:
   `nd = sum(monthly_night[lo..hi]); dd = sum(monthly_day[lo..hi]); nightPct = dd+nd ? nd/(dd+nd)*100 : null`.
   (Window `{lo,hi}` is the same `w` used for classification — keeps size & split on one window.)
2. Add `setSplitView(on)/getSplitView()` to `shared/transition-map.js`. In `renderCells`, when split
   is on, render each cell as a divIcon conic-gradient (`night` indigo / `day` amber), **sized by
   volume** (same `r` as today), split by `nightPct`. If `nightPct == null`, fall back to the normal
   classification circle (never a fake 50/50).
3. Split toggle (Combined | Day vs night) in its **own container**, a **sibling** of `#map-controls`
   (not nested — that's what the PR got wrong in unhoused, where `buildMapControls` overwrote it).
   `aria-pressed` on the buttons. Toggling re-renders the map and shows/hides the split legend.
4. Keep classification discoverable in split view (legend + popup still name persistent/emerged/cooled).

### C. Change #3 — docked detail panel (replaces the cramped popup detail)
1. Markup: a `.map-with-panel` grid wrapping `#map` + `#detail-panel`, in both `index.html` (sibling
   layout, `has-panel` toggles the second column; collapses to 1-col under ~800px).
2. On cell selection, populate the panel from the **cell object we already have** (name, classified
   category badge, before/now/district-tide, larger sparkline) + **marker-derived** hourly
   distribution and day/night split for that cell. Reuse `computeBreakdown` for the incident-type list.
3. **Preserve selection/URL:** drive the panel off the same selection event that sets
   `selectedCellId`. Options to decide during build (pick the one that keeps deep-links intact with
   least surface area): (i) keep the Leaflet popup as the lightweight click target and mirror its
   open/close into the panel via a new `onCellSelected` callback; or (ii) shrink the popup to a
   title-only anchor and move all detail into the panel. Deep-link restore must still open the right
   cell and panel. Add `onCellSelected(fn)` + `closeSelectedCell()` to `transition-map.js`.
4. Guard the async fill: after awaiting marker load, bail if `selectedCellId` changed (no stale panel).
5. Colors via tokens; verify dark theme.

### D. Change #1 — panel-scoped hour slider (honest)
1. The slider lives **inside the detail panel** (not a global control above the map), so it never
   implies a map-wide filter it can't deliver. Label it for what it does: "Focus an hour window for
   this block."
2. Build 24 segments; support drag + keyboard to pick `[start,end]` (wraps midnight). On change,
   recompute from the selected cell's marker points (hour): highlight the window on the hourly chart,
   show "N of M reports (P%) fall in this window · peaks ~Hh", and optionally re-filter the
   incident-type breakdown to the window. All per-selected-cell, from data that exists.
3. No `setHourRange` on the shared map; no map re-render. Remove any dead affordance.

### E. Cleanup / tests
- No dead variables (the PR's unused `splitLabel`); render the label or drop it.
- Add a `validation/trace.py` (or `validate_build.py`) check reconciling the day/night split for at
  least one signal, per the E2E data-trace convention.
- Manual verify (below) is mandatory before any merge — `main` is the live site.

---

## Execution order
1. (done) Plan docs.
2. B (split markers) — smallest honest win; validates the shared-module setup.
3. C (docked panel) — the biggest change; get selection/deep-link parity right first, then fill.
4. D (panel slider) — layers onto C's panel.
5. E (cleanup + trace).
6. Verify in-app, both dashboards, light+dark.

## Acceptance criteria
- [ ] "Day vs night" markers show **data-driven** splits (day-heavy vs night-heavy visibly differ);
      no cell ever shows a fake 50/50 — missing data reads as the normal circle or "n/a".
- [ ] Split toggle is visible and works on **both** dashboards and survives signal-button clicks.
- [ ] Docked panel opens on selection; pin/shareable URL and **deep-link restore still work**;
      incident-type breakdown preserved.
- [ ] Hour slider affects **only** the selected block's panel; its numbers match a hand tally of
      that block's marker points; no map re-render, no dead affordance.
- [ ] Panel/split logic in exactly one shared place; no duplication, no dead vars.
- [ ] Legible in light and dark; no console errors on load or interaction.
- [ ] `validation/` reconciles the day/night split for ≥1 signal.

## Verification (required — main auto-deploys)
- Serve locally and drive both dashboards (see the `run` skill / project http-server).
- Toggle split view; confirm a known night-heavy and day-heavy block differ and match the panel.
- Select cells, open/close panel, exercise slider; reload a deep-linked cell URL and confirm restore.
- Check the browser console (zero errors) and dark mode.
