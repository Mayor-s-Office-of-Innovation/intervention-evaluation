# Encampment Reports by District

A static dashboard showing how community-reported **encampment & homelessness** 311 activity is
changing across four SF police districts — **Central, Northern, Mission, Tenderloin** — measured
against citywide totals and the same season a year earlier, with a heatmap/dot map of the underlying
reports.

See [`plan.md`](plan.md) for the full design, decisions, and data caveats.

## Launch the dashboard

It's a fully static site (no backend, no build step for the frontend). Any static server works — but
**serve from the repo root**, not from `districts/`, so the `/districts/...` paths resolve.

```bash
# from the repo root (intervention-evaluation/)
npx http-server . -p 8090 -c-1
# then open:
#   http://localhost:8090/districts/index.html
```

Or with Python (no install):

```bash
# from the repo root
python3 -m http.server 8090
# open http://localhost:8090/districts/index.html
```

> Opening `index.html` directly via `file://` will **not** work — the page fetches JSON via
> `fetch()`, which browsers block on the `file://` protocol. Use a local server.

## Refresh the data

The dashboard reads pre-baked JSON in [`data/`](data/) produced by the Python build in
[`build/`](build/). Data is committed, so you only rebuild to pull newer 311 records. Stdlib only —
no `pip install` needed.

```bash
cd districts/build
python3 01_pull.py     # fetch full-history 311 records from data.sfgov.org (~172k rows, a few min)
python3 02_assign.py   # tag each record with a police district (point-in-polygon)
python3 03_rollup.py   # emit ../data/aggregates.json, ../data/points/*.json, ../data/provenance.json
```

`02_assign.py` reads the district boundaries from the sibling repo
`../../emergent-map/data/sidecar/police_districts.geojson` (dataset `qgnn-b9vv`) and writes a trimmed
4-district copy to `data/police_districts.geojson` for the map.

## Run the tests

Browser smoke tests (renders cards/chart/map, no console errors, focus + map-mode switches):

```bash
# from districts/  (first time: `npx playwright install chromium`)
npx playwright test --config=playwright.config.js
```

## What's where

| Path | Purpose |
|---|---|
| `index.html`, `styles.css` | static shell + design tokens (reused from the root tool) |
| `js/data.js` | loads `aggregates.json`; lazy-loads point files |
| `js/rollup.js` | seasonal KPI math (YoY, trailing-12-mo trend, citywide share) |
| `js/chart.js` | hand-rolled SVG trend chart (bars + overlay lines + break marker) |
| `js/map.js` | Leaflet map: district boundaries, heatmap, dot layer |
| `js/app.js` | orchestration |
| `build/*.py` | data pipeline (pull → assign → rollup) |
| `data/` | committed JSON the page consumes |
| `data/provenance.json` | filters, counts, and the auditable June-2025 reporting break |
