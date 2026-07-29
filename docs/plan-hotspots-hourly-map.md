# Deferred spec — map-wide hourly hotspot filtering ("Option 2b")

**Status: NOT being built.** Captured for reference. The active work
([`plan-hotspots-enhancements.md`](plan-hotspots-enhancements.md)) ships a **panel-scoped** hour
slider that filters the *selected block's* detail from marker points — no data-pipeline change.

This doc describes the larger version we deliberately deferred: making the **whole hotspots map**
re-classify and re-weight for an **arbitrary hour window** (e.g. 9pm–1am), honestly. Read this only
if map-wide hourly filtering becomes a real requirement.

## Why it's a build change, not a UI change
The hotspot classification (persistent / emerged / cooled + `preRate`/`nowRate`) is a
difference-in-differences over each cell's **monthly** histogram vs its district's, computed live in
`classify.js`. Today the build bakes those monthly arrays at only **month** and **day/night**
resolution: `monthly`, `monthly_day`, `monthly_night` (per cell) and the matching
`district_monthly[_day|_night]` (see `drug/build/04_transitions.py` §classify). There is **no**
hourly-resolution monthly series. So an arbitrary hour window cannot be classified from current data
— only tallied from raw marker points, which lack the monthly/district structure the d-i-d needs.

## What would have to change

### 1. Build (`{drug,unhoused}/build/04_transitions.py`)
The classify loop already reads `r.get("hour")` and buckets day/night (`tod.py::tod_bucket`). Extend
it to bake, per cell, an **hour-resolved monthly histogram**, plus the district equivalent for the
tide. Two shapes, pick by cost/fidelity:
- **Full:** `monthly_by_hour[h][monthIdx]` — 24 × len(MONTHS) per cell **and** per district.
  Exact; lets any `[start,end]` window be summed to a monthly series and classified with full d-i-d.
- **Reduced:** bake a small set of named bands (e.g. late-night / morning / midday / evening) as
  monthly arrays. Smaller, but only those bands can be classified — not a free slider.

Keep `monthly` as the untouched parity oracle; assert `sum_h monthly_by_hour[h] == monthly` and
`day+night == total` (mirrors the existing tod assertions).

### 2. Data payload (the main cost)
Full shape ≈ **267 cells × ~40 months × 24 hours ≈ 256k ints per signal** (vs a few thousand today),
plus district arrays — a large increase for a static, auto-deployed GitHub Pages site. Mitigations:
sparse encoding (most cell-hour-months are 0), run-length/delta packing, or the reduced-band shape.
Measure the gzipped delta and its Core-Web-Vitals impact before committing.

### 3. Classifier (`shared/classify.js`)
Add an hour-window parameter: given `[start,end]` (wrapping midnight), sum the hour-resolved arrays
into a window-filtered monthly series for both cell and district, then run the existing d-i-d. Must
stay byte-identical to today when no hour filter is set (parity oracle intact;
`validation/parity.mjs`).

### 4. Frontend
- Promote the slider to a **map-level** control that calls into `renderMap()` to reclassify + redraw
  markers for the chosen window (size = window volume, color = window classification — consistent).
- Reconcile with the existing Day/Night preset (a slider window supersedes the preset, or the preset
  is just two slider positions).
- Update the map note / methodology to state the active window honestly.

### 5. Validation (`validation/`)
Extend `trace.py` / `validate_build.py` to reconcile the hour-resolved baked numbers against the
source query for ≥1 signal, per the E2E data-trace convention — nothing ships unreconciled.

## Honesty notes
- Do **not** ship the half-version ("2a": re-weight marker *size* by hour volume while classification
  color stays day/night) — size and color would reflect different filters, which misleads.
- With small hour windows, monthly counts get sparse and the d-i-d noisier; consider a minimum-volume
  gate and/or widening the baseline so a thin window doesn't produce spurious "emerged"/"cooled".

## Rough cost
Build + classifier + validation changes, a data-size/CWV investigation, a full pipeline re-run, and
parity re-validation across both signals and four districts. A multi-day data-pipeline effort, not a
UI iteration — which is why the panel-scoped slider was chosen for now.
