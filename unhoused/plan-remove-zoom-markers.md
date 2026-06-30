# Plan — Remove the zoom-in "individual report markers" view

**Date:** 2026-06-29 · **Branch:** `pr-30`
**Goal:** Stop the map from swapping the classified ~block **cells** for **individual
report markers** when zoomed in past `ZOOM_THRESHOLD` (17). The cell view stays at all
zoom levels. The zoom-in marker view is confusing and is being removed.

## Current behavior (two zoom regimes)

`shared/transition-map.js` runs two layers off the map zoom:
- **Zoomed out → cells** (`cellLayer`): persistent/cooled/emerged circles; popup carries
  a sparkline + a **"See details"** button. ← KEEP.
- **Zoom ≥ 17 → markers** (`markerLayer`, `renderMarkers`): individual reports grouped by
  exact intersection, period-colored, with a hover overlay + a `.map-hint` legend. ←
  REMOVE.

`applyZoomMode()` (bound to `zoomend`) does the swap.

## ⚠️ Hard constraint — keep the markers DATA

The "See details" drawer (`showCellDetails` → `getMarkersForCell` → `computeBreakdown`)
**reuses `markerData`** to compute a clicked cell's incident-type breakdown. So:
- KEEP: `loadMarkers`, `setMarkers`, `markerKey`, `markerData`, `markerLoader`,
  `markerLoading`, `getMarkersForCell`, `computeBreakdown`, `renderBreakdownList`,
  `showCellDetails`, and the drawer's own time-of-day chips.
- REMOVE: only the zoom-triggered marker *layer/rendering*.

## Scope (shared file → both dashboards)

`transition-map.js` is imported by **unhoused** and **drug** only (no other dashboard).
Both show the zoom-in markers and both carry the "zoom in for individual reports" copy.
**Decision needed:** remove for both (simplest, consistent) vs. unhoused-only (needs a
config flag → more code + divergence). *Recommendation: remove for both.*

## Changes by file

### `shared/transition-map.js`
- **Delete** `renderMarkers()` entirely.
- **Delete** `applyZoomMode()`; replace its callers:
  - `renderCells()` ends with `applyZoomMode()` → just ensure `cellLayer` is on the map.
  - `setMarkers()` calls `applyZoomMode()` → drop the call (it only needs to stash
    `markerKey`/`markerLoader` for the drawer's lazy load).
- **Remove** the `zoomend` listener (`map.on('zoomend', applyZoomMode)`) and the
  `moveend → renderMarkers` listener. Keep `moveend → emitState` (URL sync).
- **Remove** `markerLayer`, `hintEl` (create + appendChild + show/hide), `inMarkerMode()`.
- **Remove** marker-only constants: `ZOOM_THRESHOLD`, `MARKER_CAP`, `HIT_RADIUS`,
  `OLDER_COLOR`, `RECENT_COLOR`.
- **Remove** the marker-coloring window state: `mapWinSpan`, `mapBaseSpan`, and the
  `setMapWindow()` export (now unused — see app.js).
- **Simplify** `setTodFilter()` / `setMapTodFilter()`: drop the
  `if (inMarkerMode()) renderMarkers()` re-render (the marker layer is gone; the page-
  level filter still drives cell classification upstream via `classify.js`, and the
  drawer recomputes on open).
- Update the file header comment (drop the "two zoom regimes" description).

### `unhoused/js/app.js` and `drug/js/app.js`
- Remove the `setMapWindow` import + its call in `renderMap` (`setMapWindow(winSpan, …)`).
- Keep `setMarkers(mapSignal, () => loadMarkers(mapSignal))` — still feeds the drawer.
- Update map-note copy: drop "**zoom in** for individual reports …". Replace with a
  pointer to the per-cell drawer, e.g. "click a block for its trend + a breakdown of
  report types." (unhoused line ~341; drug line ~341.)

### `unhoused/styles.css` (and drug if it has copies)
- Remove now-dead marker styles: `.map-hint`, `.marker-overlay`, `path.mk-halo`,
  `.ov-date`, `.ov-row`, `.ov-multi`, `.hint-dot`. (Grep first; remove only if unused.)

### `unhoused/tests/e2e.spec.js`
- The test *"block popup shows a monthly sparkline; zooming in reveals individual report
  markers …"* (~line 97) must be **split/rewritten**:
  - KEEP the sparkline-in-popup assertion.
  - DELETE the zoom→`.map-hint`→`.marker-overlay` half.
  - ADD (or rely on an existing) assertion that zooming past 17 keeps the **cells**
    visible (no layer swap) and that **"See details"** still renders a breakdown.
- Drug has no marker/zoom test → no drug test change.

## Risks / watch-outs
- **Don't break "See details"** — verify the drawer still lazy-loads `markerData` after
  `applyZoomMode` is gone (the drawer has its own loader block, so it should be fine).
- **Deep-link/URL state** — `emitState` persists zoom/center while a cell is pinned; the
  comment mentioning the marker view should be updated, behavior is unaffected.
- **Drug parity** — same shared change; re-run the drug suite.

## Verification
- `node validation/parity.mjs unhoused && node validation/parity.mjs drug`
- `python3 validation/validate_build.py` (no data change expected, but cheap)
- e2e: `unhoused` + `drug` suites green.
- Runtime: zoom past 17 on both dashboards → cells stay, no `.map-hint`, no console
  errors; "See details" drawer still works.

## Open decision
- [x] **Scope:** remove for **both dashboards** (2026-06-29) — no flag, shared code stays simple.

---

## Implementation log (2026-06-29)

**`shared/transition-map.js`** — deleted `renderMarkers`, `applyZoomMode`, `inMarkerMode`,
the `markerLayer`/`hintEl`, the marker-only constants (`ZOOM_THRESHOLD`, `MARKER_CAP`,
`HIT_RADIUS`, `OLDER_COLOR`, `RECENT_COLOR`), the marker-window state
(`mapWinSpan`/`mapBaseSpan`) and the `setMapWindow` export, the `zoomend` +
`moveend→renderMarkers` listeners (kept `moveend→emitState`), and the now-dead
`passesMapTod`. **Kept** the markers-data plumbing (`setMarkers`/`markerData`/loader) and
the whole "See details" drawer, which still lazy-loads the markers JSON. Cells render at
every zoom (the `cellLayer` is never removed).

**`unhoused/js/app.js` + `drug/js/app.js`** — dropped the `setMapWindow` import + call;
updated the map-note copy from "zoom in for individual reports" → "click a block for its
monthly trend, a breakdown of report types, and a shareable link."

**`unhoused/styles.css` + `drug/styles.css`** — removed the dead marker/overlay/hint
styles (`.marker-overlay`, `.map-hint`, `.mk-halo`, `.ov-*`, `.hint-dot`).

**`unhoused/tests/e2e.spec.js`** — rewrote the marker test: keeps the sparkline
assertion, adds a "See details" breakdown check, and asserts that zooming to z18 keeps
the **cells** (no `.map-hint`, no `.marker-overlay`).

### Verification
- Parity exact (unhoused enc/cfs + drug); `validate_build.py` all green.
- e2e: unhoused **9/9**, drug **5/5**.
- Runtime (both dashboards): cell popup sparkline + "See details" breakdown work; at z18
  cells persist (99 unhoused / 22 drug paths), no hint, no overlay, **0 console errors**.

### Note
The drug dashboard also loses the zoom-in markers (shared code, per the scope decision).
No data changed; markers JSON is still built/used by the drawer.
