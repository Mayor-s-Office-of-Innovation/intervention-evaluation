# Cell "See details" Panel — Integration Plan

Part of the [plan.md](plan.md) chain (follow-on work). Covers `drug` + `unhoused` + the shared `../shared/` lib.

Status: **in progress (2026-06-18).** Porting PR #6 (`feature/cell-details`) onto current `main` (Leaflet)
without the abandoned Mapbox migration it was authored against. Doing the work on a fresh branch
`feature/cell-details-leaflet` off `main`.

---

## 1. What we're adding

An expandable **"See details"** panel inside each transition-map **cell popup** (zoomed-out block view).
When opened it shows the **incident-type breakdown** for that cell, with **time-of-day filtering**
(All / Morning / Afternoon / Evening / Night). Bars show each type's share; counts on the right.

Lands on `drug` + `unhoused` (the two dashboards with a transition map + individual-marker drill-down).
`districts` / `hypothesis` / `theft` are untouched.

---

## 2. Background — why not just merge PR #6

PR #6 (`feature/cell-details`, single commit `a330ef6`) was built on top of `feature/mapbox-migration`
(`5865f8b`), the Leaflet→Mapbox GL rewrite **we decided against**. The branch is therefore:

- **Mapbox-based** — its `shared/transition-map.js` popup wiring uses the Mapbox API
  (`popup.setLngLat().setHTML().addTo()`, `popup.getElement()`, `popup.setMaxWidth()`, `[lng,lat]` order).
- **Stale** — branched from `1be01fe` (node-upgrade), *before* main's homepage reorg + intervention tracker.

Reusing the branch would mean *reverting* an 18-file/+689-line migration **and** reconciling all the
intervention-tracker work. The cleaner direction is the opposite: **add the feature onto current
Leaflet `main`**, porting only the popup wiring. Smaller diff, no migration to unwind.

`feature/cell-details` and `feature/mapbox-migration` stay closed/abandoned.

---

## 3. Decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Port onto fresh `feature/cell-details-leaflet` off `main`; don't reuse the PR branch. | Avoids un-doing the Mapbox migration and the staleness vs current main. |
| D2 | Apply the 6 map-agnostic files **verbatim**; hand-port only `shared/transition-map.js`. | 4 build `.py` + 2 `styles.css` have no Leaflet/Mapbox coupling. |
| D3 | Preserve original authorship (zoya-r-khan) in the commit message / co-author trailer. | Content is reused even though the branch isn't. |
| D4 | Rebuild marker data **offline from existing raw caches**; do not re-pull from Socrata. | `build/cache/*_raw.json` already hold full datetimes (hour). No network needed. |
| D5 | Fix the latent field-offset bug the PR introduced (see §5). | PR shifts `pts` layout but only half the readers were updated. |

---

## 4. File-by-file scope

| File | Coupling | Action | Done |
|---|---|---|---|
| `drug/build/02_assign.py` | none — extracts `hour` from datetime | apply verbatim | ✅ |
| `drug/build/05_markers.py` | none — emits `hour` into `pts` | apply verbatim | ✅ |
| `unhoused/build/02_assign.py` | none | apply verbatim | ✅ |
| `unhoused/build/05_markers.py` | none | apply verbatim | ✅ |
| `drug/styles.css` | none — additive panel/chip/bar CSS | apply verbatim | ✅ |
| `unhoused/styles.css` | none | apply verbatim | ✅ |
| `shared/transition-map.js` | **Mapbox popup API** | hand-port to Leaflet | ⏳ |

---

## 5. The latent offset bug (must fix during port)

The build change inserts `hour` into the per-marker `pts` row at **index 3**, shifting detail fields
from offset 3 → **offset 4**:

```
old pts row: [lat, lng, day, ...fields]          # fields at index 3+i
new pts row: [lat, lng, day, hour, ...fields]    # fields at index 4+i
```

`computeBreakdown` (new code) correctly uses `fieldOffset = 4`. **But the PR never updated
`renderMarkers`**, which still reads `g.top[3 + i]` (confirmed in the PR's own `transition-map.js`).
After rebuild, the existing marker-overlay hover rows would read `hour` as the first detail field.

**Fix:** bump `renderMarkers`'s field read from `g.top[3 + i]` → `g.top[4 + i]`
(main: `shared/transition-map.js` ~line 253). Audit for any other `[3 + i]` / `g.top[3]` / `p[3]`
field reads while in there.

---

## 6. `shared/transition-map.js` port — Leaflet adaptation

The data helpers port **verbatim** (they touch `markerData.pts` / `.fields`, not the map lib):
`TIME_BUCKETS`, `getTimeBucket`, `getMarkersForCell`, `computeBreakdown`, `renderBreakdownList`.
The marker-data infra they rely on (`markerData`, `markerLoader`, `coordScale`, `fields`, `pts`)
already exists on main.

Wiring changes (Mapbox → Leaflet):

| PR (Mapbox) | Main (Leaflet) |
|---|---|
| Button injected in `popup.setHTML(...)` using `coords[1]/coords[0]` | Append button + `<div class="cell-details" hidden>` to the `cm.bindPopup(...)` HTML (~line 164), using `c.lat`/`c.lng`. |
| `popup.getElement()?.querySelector(...)` then `addEventListener` | Attach in the existing `popupopen` handler (~line 171): `cm.getPopup().getElement().querySelector('.cell-details-btn')` → `showCellDetails(c.lat, c.lng, popupEl)`. |
| `popup.setMaxWidth('340px')` on expand | Raise `bindPopup` `maxWidth` (currently 230) and call `cm.getPopup().update()` after expand. |

Open item to verify in impl: `getMarkersForCell` matches markers→cells at **3-decimal** rounding,
while cell IDs use `toFixed(4)`. It's coordinate-*value* matching (not ID matching), so it should be
fine, but confirm the breakdown is non-empty on real cells.

**Not ported:** `mapbox-token.js` / `mapbox-config.js` / CDN swaps / districts & hypothesis map rewrites.

---

## 7. Rebuild (offline)

Raw caches present with hour-bearing timestamps (`...T00:06:18.000`), so no Socrata pull. Run per
dashboard: `02_assign.py` (re-emit assigned cache with `hour`) then `05_markers.py` (regenerate
`data/markers/<mapkey>.json`). `03/04` outputs are unaffected (they don't use `hour`).

```bash
python3 drug/build/02_assign.py     && python3 drug/build/05_markers.py
python3 unhoused/build/02_assign.py && python3 unhoused/build/05_markers.py
```

---

## 8. Validation

- `validation/trace.py` data-trace harness — baked numbers still tie out to declared queries.
- Playwright smoke / e2e (`npm test` scope).
- Manual at `npm run dev`: open a cell popup on both dashboards → "See details" → breakdown renders,
  time-of-day chips filter, counts/bars correct, marker-overlay rows (zoomed in) still aligned.

---

## 9. Git (user runs these himself)

```bash
git checkout -b feature/cell-details-leaflet      # off main
# … claude makes the edits + rebuild …
git add -A && git commit                          # message preserves zoya-r-khan authorship
```

---

## 10. Follow-on task — street-name legibility (added 2026-06-18)

**Motivation.** The original reason for the (abandoned) Mapbox switch was a basemap where **street
names are easier to read**, in both light and dark mode. Solve that within Leaflet — no API key
(keeping the reason we dropped Mapbox intact).

**Current state.** All three maps use CARTO Positron / Dark Matter:
`shared/transition-map.js:12-13`, `districts/js/map.js:7-8`, `hypothesis/js/map.js:8-9`
(`TILE_LIGHT`/`TILE_DARK`, swapped on the `themechange` event). These are minimal basemaps:
labels are small/low-contrast, and — the real issue — our data dots are drawn **on top of** the
labels, hiding street names.

**Options (no API key, same CARTO CDN):**

| Opt | Approach | Pro | Con |
|---|---|---|---|
| A | **CARTO Voyager** light base (`rastertiles/voyager`) | bolder, more legible road labels out of the box; one-line URL swap | no true dark Voyager — dark mode stays Dark Matter (asymmetric) |
| B | **Base + labels-on-top pane**: `{light,dark}_nolabels` base below data + `{light,dark}_only_labels` in a high-z Leaflet pane above the markers | street names always render on top of dots; symmetric light/dark; keeps the clean look | 2 tile layers (more requests); ~15 lines per map |
| C | Stadia/Stamen Toner, Thunderforest, etc. | strong cartography | **requires an API key** → rejected (defeats the point of dropping Mapbox) |

**Decision (2026-06-18):** Went with **A (Voyager)** for light mode after a visual side-by-side
(B was prototyped + screenshotted but the user preferred Voyager's look). Dark mode stays Dark Matter
(`dark_all`) — Voyager has no dark variant. Applied to all three maps:
`shared/transition-map.js`, `districts/js/map.js`, `hypothesis/js/map.js` (just the `TILE_LIGHT`
URL → `rastertiles/voyager`). Labels are part of the basemap (under the data dots), so no
click/hover interference. B fully reverted from the working tree.

Status: **done** — all three maps on Voyager light / Dark Matter dark; e2e green.
