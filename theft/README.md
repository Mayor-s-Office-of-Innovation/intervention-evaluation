# Theft from Merchants — Northern District

A static dashboard tracking **theft against Northern-district businesses** and whether the city is
reducing it. Each merchant-theft type is read on **two axes** — *theft reported by businesses* (want ↓)
and *arrests by SFPD* (want ↑) — so the metric can't be faked by dialing enforcement up or down.

Two signals (see [`plan.md`](plan.md) for the full design, decisions, and data caveats):

- **Shoplifting** — `Larceny Theft - Shoplifting` (the enforcement-reflexive core signal)
- **Commercial burglary & robbery** — `Burglary - Commercial` + `Robbery - Commercial`, lumped

The `Theft from Merchant or Library` code is **deliberately excluded** (a fading legacy code) — with a
visible footnote on the dashboard explaining why.

## Launch the dashboard

Fully static (no backend). **Serve from the repo root** so `/theft/...` paths resolve:

```bash
# from the repo root (intervention-evaluation/)
python3 -m http.server 8090
# open http://localhost:8090/theft/index.html
```

> `file://` won't work — the page uses `fetch()` for the JSON, which browsers block on `file://`.

## Refresh the data

The page reads pre-baked JSON in [`data/`](data/) produced by the Python build. Stdlib only — no
`pip install`. Unlike the `districts/` build, there's **no point-in-polygon and no raw-row paging**:
`wg3w-h783` has a native `police_district` field, so the build fetches pre-aggregated monthly counts
straight from Socrata.

```bash
cd theft
python3 build/build.py   # → data/aggregates.json + data/provenance.json
```

## Run the tests

```bash
# from theft/  (first time: `npx playwright install chromium`)
npx playwright test --config=playwright.config.js
```

## What's where

| Path | Purpose |
|---|---|
| `index.html`, `styles.css` | static shell + light/dark styling |
| `js/data.js` | loads `aggregates.json` |
| `js/rollup.js` | trailing-12mo / YoY math + the two-axis verdict logic |
| `js/chart.js` | hand-rolled SVG line chart (monthly reported & arrests + 12-mo avg) |
| `js/app.js` | orchestration: renders the two scorecards + charts + footnotes |
| `build/signals.py` | the 2 signals + the excluded category |
| `build/build.py` | data pipeline (aggregated SoQL → committed JSON) |
| `data/aggregates.json` | per-signal monthly series (reported / arrests / online) for Northern |
| `data/provenance.json` | dataset id, exact filters, axis definitions, the excluded category |
