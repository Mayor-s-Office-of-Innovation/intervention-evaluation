# Plan — Cross-street search (hybrid: local hotspots + Nominatim fallback)

New feature for the hotspots map on the **Drugs** + **Unsheltered** dashboards. Supersedes the
external-only approach in the closed PR #34 (which was also mis-scoped — it carried all of PR #32's
superseded implementation; we only salvage the Nominatim geocoder idea). Static public GH Pages site
(main auto-deploys) — accuracy paramount, never mislead.

## Decision (locked)
**Hybrid.** Search matches our own intersection data first; if the corner isn't in our data, fall
back to Nominatim to still locate it and say — honestly — that we have no tracked activity there.

## Data reality (measured, drug/cfs_drug)
- Cells (classified hotspots, activity-gated): **267**, each with `name` + `lat`/`lng`.
- Markers (≥1 report, lazy-loaded): **1,041** distinct intersections; cells ⊆ markers.
- Corners with **zero** activity: not in our data at all (no name, no coordinates) → only Nominatim
  can locate them. This is exactly why hybrid is needed.
- Per-signal: unhoused has its own sets. Search operates on the **active signal**.

## Result tiers (most→least specific)
1. **Local match is a classified hotspot** → select it: reuse the existing popup/deep-link path so it
   pins + updates the shareable URL exactly like a click. Zoom to it.
2. **Local match is active-but-not-hotspot** (in markers, not a cell) → pan/zoom + a temporary result
   marker + honest note: "N report(s) here in this window · not a tracked hotspot."
3. **No local match → Nominatim fallback** (SF-bounded) → pan/zoom + neutral result marker + note:
   "No tracked activity at this corner." 
4. **Nominatim empty/failed** → status "No results in SF" / "Search failed" (no marker).

Tier 2 requires `markerData`; it's already lazy-loaded for "See details". If not yet loaded when a
search runs, load it on demand (same loader). If load fails, degrade tier 2 → tier 3.

## Matching (order-independent, suffix-tolerant) — the accuracy-critical part
Normalize both the query and each intersection `name` to a **set of significant street tokens**:
- lowercase; replace `&`, ` and `, `/` with a separator; split into street parts.
- per part: strip common suffixes (`st, street, ave, avenue, blvd, boulevard, dr, drive, ct, ln,
  pl, ter, way, hwy, rd, road`); normalize ordinals (`16th`→`16`); collapse whitespace.
- match if the query's token set ⊆ the intersection's token set (so "16th & mission" matches
  "16TH ST / MISSION ST"; "mission & 16th" matches too). Rank exact set-equality first, then subset,
  then choose the highest-volume cell on ties. Guard against 1-token queries matching too broadly
  (require ≥2 street tokens, or if 1 token, only match when unambiguous — else prompt to be specific).
- Build the index from cells (always) + markerData intersections (when available), deduped by
  normalized key, tagging each entry `{lat, lng, isHotspot, cellId?, reportCount?}`.

## Implementation
### `shared/transition-map.js`
- Maintain a `cellId → marker` registry populated in `renderCells` (so search can open a rendered
  hotspot's popup directly). Add `focusCellById(cellId)` → setView + `cm.openPopup()` (reuses the
  existing selection/URL emit; falls back to `queueRestore` if not currently rendered).
- Add `buildIntersectionIndex()` from `lastCells` (+ `markerData` if loaded) and a
  `searchIntersections(query)` returning the ranked tiered result described above.
- Add a `showSearchResult(lat,lng,label,note)` that drops/*replaces* a single temporary result
  marker (own divIcon, distinct from split/category markers), and `clearSearchResult()`.
- **Clear the result marker on district change / window scrub** (call `clearSearchResult()` at the
  top of `renderCells` or on district switch) — fixes PR #34's lingering-marker bug.
- Nominatim helper: keep SF `viewbox` + `bounded=1` + `limit=1`. **Drop the `User-Agent` header** (a
  forbidden header in `fetch` — silently ignored; document that Nominatim sees the referer). Add
  OSM/Nominatim attribution near the map (map already credits OSM/CARTO — verify wording).

### `shared/hotspots-panel.js`
- `wireSearch({ inputSel })`: render the search box (input + button + status, aria-labelled), wire
  Enter/click/Escape, call `searchIntersections`, then route to the right tier + set status text.
  Escape clears input, result marker, and status.

### `drug/js/app.js` + `unhoused/js/app.js`
- Add a `#map-search` container in the map header (its own element, NOT nested in `#map-controls` —
  same lesson as the split toggle) and call `wireSearch(...)` in `main()`.

### CSS (both `styles.css`)
- `.map-search*` input/button/status + the result-marker pulse, via `var(--…)` tokens; verify dark.

## Guardrails / honesty
- Never imply "no activity" when we simply didn't match: tier 3's note is about *tracked* activity
  and only shown once we've actually located the corner via Nominatim.
- Tier 2/3 notes must reflect the **active window/signal** (report counts are window-scoped).
- One external dependency (Nominatim) — occasional manual queries only (Enter/click, no autocomplete)
  to respect its 1 req/s policy; handle failure gracefully (degrade, never break the map).

## Acceptance criteria
- [ ] "16th & mission" (and "mission & 16th") selects the hotspot cell + opens its panel/popup + URL updates.
- [ ] An active-but-not-hotspot corner pans there with an honest "not a tracked hotspot" note.
- [ ] A real but zero-activity SF corner pans there (via Nominatim) with "no tracked activity".
- [ ] Gibberish → "No results in SF"; network failure → "Search failed"; map still works.
- [ ] Result marker clears on Escape, new search, and district/window change (no lingering pin).
- [ ] Shared code (no per-dashboard duplication); both dashboards; light+dark; no console errors.
- [ ] Deep-link/pin/See-details/split view all still work.

## Verify
Playwright on both dashboards: hotspot match (tier 1), non-hotspot active (tier 2), quiet corner
(tier 3, mock/allow Nominatim), gibberish; assert marker cleanup on district switch; 0 console errors.
Note: tier-3 tests hit the network (Nominatim) — gate/mvia a stub if flaky.
