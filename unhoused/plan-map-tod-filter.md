# Plan / Review — Map-level time-of-day filter (PR #30)

**PR:** #30 · `zoya-r-khan:feature/map-filters` (head commit `29a1124`)
**Reviewed:** 2026-06-29 · against `main`
**Scope:** `shared/transition-map.js`, `unhoused/index.html`, `unhoused/js/app.js`, `unhoused/styles.css` (+196 / −6)

## What the PR adds

Granular **Morning / Afternoon / Evening / Night** filter chips on the unhoused
*Hotspots: what changed* map, on top of the existing page-level **Day/Night**
filter. When a bucket is selected, the map:

- rebuilds hotspot cells from filtered individual reports (`buildCellsFromMarkers`),
- re-classifies blocks using only reports in the selected bucket(s),
- filters the zoomed-in markers to match (`passesMapTod`).

Chips support single- and multi-select; "All" resets to no filter.

## Verification (done)

| Check | Result |
|---|---|
| Existing unhoused e2e suite | ✅ 8/8 pass |
| Drug e2e suite (also imports `shared/transition-map.js`) | ✅ 5/5 pass |
| Shared change backward-compatible | ✅ `passesMapTod()` returns `true` when no filter set; other dashboards never call `setMapTodFilter`, so they are unaffected |
| New feature at runtime (headless) | ✅ 5 chips render, single/multi-select + All reset work, **0 console errors** |
| Open-source safety | ✅ no secrets, no new deps, no eval/network/user-input surface; static chip labels; correct ray-casting (geojson `[lng,lat]` handled) |

**Merge-safety verdict:** does not break existing functionality and introduces no
security risk. Two correctness/honesty issues below should be decided before merge,
and the feature ships with no test.

---

## The two issues — shared root cause

Both issues come from **one** fact:

> The granular 4-bucket vocabulary the PR introduces on the frontend
> (`TIME_BUCKETS` = morning/afternoon/evening/night) **has no counterpart in the
> build or the precomputed data, which only knows day/night.**

The build's time-of-day source of truth is [`unhoused/build/tod.py`](build/tod.py):
`BUCKETS = ("day", "night")`. Everything baked into `data/transitions/*.json` and
`data/transitions/_meta.json` is therefore day/night only:

- per-cell histograms: `monthly`, `monthly_day`, `monthly_night` — **no** `monthly_morning` etc.
- per-district tide: `district_monthly`, `district_monthly_day`, `district_monthly_night` — **no** morning/afternoon/evening tide.

The PR bridges that gap on the client by re-deriving cells from the **markers**
file, which is the only artifact that still carries each report's raw hour
(`pt[3]`). That bridge is what creates both issues.

### Issue #1 — cell rebuild diverges from the canonical build

**Is it part of this PR?** Yes. `buildCellsFromMarkers` is entirely new in this PR.

**Why it was introduced:** the baked cells have no per-bucket histograms, so a
"morning only" view cannot be derived from them. The only place granular hour
survives is the markers. So the PR reconstructs cells from markers whenever a
granular filter is active.

**Correction to the first-pass review:** the grid is **not** coarsened. The build
groups by `round(lat, 3)` / `round(lng, 3)` (`CELL_DECIMALS = 3`, ~111 m blocks) in
[`build/04_transitions.py`](build/04_transitions.py#L125-L127), and the PR rounds
to the *same* 3 decimals. Resolution matches. The real divergences are narrower:

1. **Position: grid-snap vs centroid.** The build stores the *average* lat/lng of a
   cell's member reports (e.g. `37.77693`); the PR stores the *rounded grid point*
   (`37.777`). Cell dots shift by up to a few tens of metres between filtered and
   unfiltered views.
2. **Lost popup names.** The build picks each cell's most-common location label
   (`names` Counter → e.g. "299 FRANKLIN ST"). The PR sets `name: ''`, so the popup
   loses its address line — see [`shared/transition-map.js:271`](../shared/transition-map.js#L271).
3. **Non-matching cell IDs.** Cell IDs are `lat.toFixed(4)_lng.toFixed(4)`. Because
   the coords differ (centroid vs grid), IDs differ from the baked cells, so
   click-selection state and deep-links don't survive a filter toggle.
4. *(Consistent)* FLOOR=6 is re-applied via the classify.js `knobs.floor`, so the
   minimum-volume rule is preserved.

These are byproducts of reconstructing from markers rather than reading a
per-bucket precompute. None crash; they degrade fidelity when a filter is active.

### Issue #2 — denominator mismatch in classification

The map classifies each block by **difference-in-differences** (classify.js): a
cell's now-rate is compared to `expected = preRate × districtTide`, where the tide
is the whole district's pre→now change. This is deliberate — it absorbs the
June-2025 reroute, citywide trend, and seasonality so a block is judged on whether
it moved *relative to its district*.

When a granular filter is active:

- **numerator** (the cell's counts) is restricted to the selected bucket(s), but
- **denominator** (`dm`, the district tide passed into `classifyCells`) is still
  `district_monthly` (all hours), or at best `district_monthly_day` / `_night` —
  **never** a morning/afternoon/evening tide, because those don't exist.

So a morning-only cell is normalized against an all-hours (or day-wide) district
baseline. The numerator is filtered; the denominator is not. Net bias: filtered
cells are measured against a too-large baseline and skew toward **"cooled" /
under-counted as hotspots**. For a public civic dashboard this is a quiet honesty
problem, not just cosmetics. The build literally cannot supply a matching
denominator today (`BUCKETS = ("day","night")`).

---

## Options to resolve

### Option A — data-side (proper, matches the dashboard's parity-oracle design)
Extend [`build/tod.py`](build/tod.py) `BUCKETS` to the 4 granular buckets and have
[`build/04_transitions.py`](build/04_transitions.py) export per-bucket
`monthly_<bucket>` cell arrays **and** per-bucket `district_monthly_<bucket>`
tides. The frontend then classifies off baked per-bucket data:
- same grid + centroid + names as the unfiltered view (kills issue #1),
- matching per-bucket denominator (kills issue #2),
- `buildCellsFromMarkers` and the app-side `markerDataCache` can be deleted.
Cost: a data rebuild + larger JSON. This is the recommended fix — the build is the
documented parity oracle for classify.js.

### Option B — frontend-only (lighter, keeps marker reconstruction)
Keep `buildCellsFromMarkers` but make it faithful:
- carry the location name from the marker tuple (`pt[4]`) into the cell,
- use the centroid (average of member coords) instead of the grid-snapped point,
- also build a **bucket-filtered district tide** from the markers so numerator and
  denominator match (fixes issue #2 client-side).
Cost: more client compute on each toggle; still a second code path that can drift
from the build.

### Option C — scope reduction
Drop the granular buckets and reuse the existing day/night precompute (which
already has matching cells + tide). But that duplicates the page-level Day/Night
filter, so the feature loses its reason to exist. Not recommended.

**Recommendation:** Option A.

---

## Tests to add (warranted)

The feature currently has **no** coverage — the suite would stay green even if the
chips were broken. Mirror the signal-toggle test at
[`tests/e2e.spec.js:56`](tests/e2e.spec.js#L56):

1. The 5 chips (All + 4 buckets) render under `#map-tod-filter`.
2. Clicking a bucket marks it `.is-active` and reclassifies the map with **no
   console errors**; "All" resets.
3. (If Option A/B lands) a data↔UI parity assertion that a bucket-filtered cell's
   rate equals the same cell derived from raw reports — guarding the denominator fix.

---

## Open decisions for the author/reviewer
- [x] Pick Option A / B / C for the cell rebuild + denominator. → **Option A** (2026-06-29).
- [x] Lost popup names / non-matching deep-link IDs → resolved by Option A (cells are the
      baked transition cells again, so names + IDs are preserved).
- [x] Add the e2e test(s) above. → added.

---

## Implementation log (2026-06-29) — Option A + fresh data

### Data refresh
Re-ran the **full** pipeline against the live Socrata API (`01_pull → 05_markers`),
not just a recompute off cache. Latest data as of 2026-06-29.

**Partial-month decision (user call):** the in-progress month (June 2026, 28/30 days
present) is now **included** as the newest analysis month, so the map's "now" window is
**Apr–Jun 2026**. Trade-off accepted: June's monthly *rate* reads ~7% low because the
month is incomplete. Controlled by `INCLUDE_PARTIAL_MONTH = True` in
[`build/04_transitions.py`](build/04_transitions.py) (flip to `False` to revert to the
prior "last complete month" convention). Mirrored in
[`build/05_markers.py`](build/05_markers.py); surfaced in `_meta.json` as
`latest_month` + `latest_month_partial` for an honest footnote.

### Build (data side)
- [`build/tod.py`](build/tod.py): added the 4 granular buckets (`TOD_BUCKETS`,
  `tod_granular_bucket`) as a SEPARATE partition from day/night, kept in sync with the
  frontend `TIME_BUCKETS`. (Note: granular `night` 22–06 ≠ day/night `night` 20–06.)
- [`build/04_transitions.py`](build/04_transitions.py): each cell now carries
  `monthly_tod` (4 per-bucket arrays) and the meta carries `district_monthly_tod`
  (matching per-bucket district tide). A build-time assertion enforces that the 4
  granular buckets repartition `monthly` exactly (cell **and** district level).

### Frontend
- [`shared/transition-map.js`](../shared/transition-map.js): **deleted**
  `buildCellsFromMarkers` (and the unused `getMapTodFilter`). The marker layer now lets
  the granular filter **override** the page Day/Night filter for the map.
- [`unhoused/js/app.js`](js/app.js): **deleted** `markerDataCache`, `pointInPolygon`,
  `getDistrictForPoint`. When the granular filter is active, `renderMap` classifies the
  **baked transition cells** off a summed `monthly_tod` slice with a matching summed
  `district_monthly_tod` denominator (`sumArrays` helper) — fixing both issue #1 (grid /
  names / IDs preserved) and issue #2 (numerator and denominator from the same slice).

### Interaction model (decided)
The granular map filter is a complete re-partition of the day, so **when active it
overrides the page-level Day/Night filter for the map only** (cells + markers). The rest
of the page still honors Day/Night. This avoids contradictory/empty combinations (e.g.
page=Night ∩ map=Morning) and keeps the d-i-d denominator well-defined.

### Known minor limitation
The cell "See details" drawer still filters its own breakdown by the page Day/Night
filter (it has its own internal chips), so the granular map selection does not propagate
into that drawer. Acceptable for now; a follow-up could thread the granular set in.

### Verification
- `node validation/parity.mjs unhoused` → **exact** classifier parity (1492 + 759 cells)
  + 20 fuzzed windows clean, on the fresh partial-June data.
- `python3 validation/validate_build.py` → all invariants hold (all 4 dashboards).
- `unhoused` e2e **9/9** (incl. the new time-of-day test); `drug` e2e **5/5** (shared
  file unaffected).
- Runtime: granular chips reclassify (All 25/32/25 → Morning 5/18/12 → +Night 7/21/16 →
  All resets), multi-select works, **0 console errors**.
