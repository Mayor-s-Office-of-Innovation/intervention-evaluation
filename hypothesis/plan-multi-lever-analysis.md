# Plan — multi-lever analysis (small multiples)

_2026-07-13. Fixes the multi-select vs single-data-point mismatch documented in
[levers-audit.md](levers-audit.md)._

## Problem

The Levers field is a `multiple` `<wa-select>`, so `sel.value` is an array. The
analysis path does `dp = getDataPoint(sel.value)`, which matches nothing and
falls back to `DATAPOINTS[0]` (drug). Result: edit mode and interactive changes
always analyze drug, ignoring the selected levers.

## Decision (locked)

Analyze **every selected lever**, rendering a **separate panel per lever**
(small multiples), driven by **shared controls**. Chosen over one combined chart
(mixes different nouns/base rates on one axis) and over tabs (same refactor, this
is the display we want first).

- **Map:** one shared map, **color-coded markers per lever + legend** (chosen).
- **Cap:** none — one panel per selected lever, however many.
- **Default window:** computed from the **combined** events across all levers.

## Target layout (`#results`)

```
share-bar + save dialog            (unchanged)
Analysis-window card               (shared): range slider + readout + suggest
#panels  (JS-injected)
  └─ per lever: <article.lever-panel>
        header: color swatch + "<title> over time"
        verdict callout   (per-lever before/after + settle/break warnings)
        stat cards        (per-lever Before/After/Rate/In-view)
        chart card        (per-lever bar chart)
Map card: shared #events-map + #map-legend (color per lever)
Methodology: one block per selected lever (dataset + exact query)
```

One date-range slider drives the analysis window for **all** panels + the map,
split before/after the single intervention date. Compare every lever over the
same period.

## Work items

1. **index.html** — pull the range slider out of the single chart card into a
   shared "Analysis window" card above `#panels`; replace the single
   verdict/stat/chart blocks with an empty `#panels` container; add `#map-legend`
   under the map. Remove now-per-panel IDs (`verdict-body`, `stat-cards`,
   `chart-title`, `chart-host`, `chart-note`).
2. **app.js** — `dp` (single) → `dps` (array, resolved from selected keys):
   - `run()` fetches all `dps` in parallel; stores `panelData=[{dp,color,events,queries}]`;
     computes combined events → default window; builds panel DOM; wires shared slider.
   - `renderWindow` → `renderAllWindows(start,end,opts)`: loop panels, render each
     chart + verdict + stat cards into that panel's hosts; then render **one**
     color-coded map from all panels' windowed events + build the legend.
   - `verdictHtml(w,dp)` / `statCards(w,dp)` take the dp explicitly (noun/title).
   - `methodologyHtml` concatenates a block per selected dp.
   - `syncURL`/`readParams`: `dp` param becomes comma-joined keys; select value
     set as an array. Assign a stable color per lever by selection order.
   - Empty selection → fall back to `[DATAPOINTS[0]]`.
3. **map.js** — `renderEvents(el, center, radiusM, groups, {recenter})` where
   `groups=[{color,label,events}]`; keep the singleton map; one layer group,
   colored `circleMarker`s per group; popup shows the lever label. Legend HTML
   built in app.js into `#map-legend`.
4. **chart.js** — add `opts.noun` / `opts.title` for the tooltip text and
   `aria-label` (currently hardcoded "complaint(s)" / "Drug-related complaints").
5. **styles.css** — `.lever-panel`, `.lever-panel__head`, `.lever-swatch`,
   `.map-legend`, `.map-legend__item`, shared window card.

Colors: a fixed categorical palette indexed by selection order, reused for the
panel swatch + map dots + legend so a lever reads the same everywhere.

## Out of scope

- Create-mode live preview (results still render on edit/share only).
- Per-lever bar coloring (bars stay blue; the header swatch + map carry lever color).
- Combined cross-lever verdict/synthesis.

## Verify

`node --check` on each edited JS file, then run the app and open a shared/edit
URL with 2–3 levers (incl. one SFPD lever for the settle note) — confirm one
panel each, one color-coded map + legend, and the shared slider re-rendering all
panels.
