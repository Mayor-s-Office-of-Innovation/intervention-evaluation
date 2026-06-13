# Unhoused Presence in San Francisco

A standalone, static dashboard tracking how community-reported **unhoused presence** is changing across
four SF police districts — **Northern, Mission, Tenderloin, Central** — each with its own page, measured
against citywide totals and prior seasons, plus a per-intersection **hot/cold transition map** anchored on
the Lurie inauguration (Jan 8 2025).

A clean re-scope of [`../districts/`](../districts/): homeless-specific signals only. **Needles** are
deferred to a separate drug-use project and **human/animal waste** to a cleanliness project (it could not
be confidently attributed to unhoused — see [`plan.md`](plan.md) §3). See [`plan.md`](plan.md) for the full
design, all decisions, and data caveats.

## Signals & sources

Every number on the page ties back to a runnable Socrata query recorded in
[`data/provenance.json`](data/provenance.json) (plan D7). The build pulls **only** these:

| Signal (tier) | Dataset | What it is |
|---|---|---|
| **Encampment & homelessness reports** (1 · headline) | SF 311 Cases — `vw6y-z8j6` | Dedicated 311 Encampment category **unioned** with the homelessness service-requests it was rerouted into in June 2025; deduped on `service_request_id`. |
| Encampment category only (1 · sub-view) | `vw6y-z8j6` | The dedicated category alone — exposes the June-2025 reroute cliff. |
| **911 calls about unhoused presence** (2 · grouped) | SFPD CFS — `2zdj-bwza` | **Sit/Lie Enforcement + Homeless Complaint**, summed (distinct call types, deduped per `cad_number`, no overlap). |
| HSOC outreach response (3 · context) | `2zdj-bwza` | City-response routing. **Context only, never a success metric** (plan D8); overlaps the 911 signals — never summed with them. |

## Refresh the data

The dashboard reads pre-baked JSON in [`data/`](data/) produced by the Python build in
[`build/`](build/). **The `data/` JSON is committed; `build/cache/` (the raw pulls, ~117 MB) is
gitignored and regenerable.** Stdlib only — no `pip install`.

```bash
cd unhoused/build
python3 01_pull.py        # fetch full-history records from data.sfgov.org → build/cache/<signal>_raw.json
python3 02_assign.py      # point-in-polygon → police district (carries detail fields) → build/cache/<signal>_assigned.json
python3 03_rollup.py      # emit ../data/{aggregates,provenance}.json + ../data/points/*.json
python3 04_transitions.py # emit ../data/transitions/*.json (block hot/cold + monthly sparkline series)
python3 05_markers.py     # emit ../data/markers/*.json (individual reports + detail fields for the zoom-in view)
```

- Run a single signal: `python3 01_pull.py encampment` (each script accepts signal keys as args).
- `02_assign.py` reads district boundaries from the sibling repo
  `../../emergent-map/data/sidecar/police_districts.geojson` (dataset `qgnn-b9vv`) and writes a trimmed
  4-district copy to `data/police_districts.geojson` for the map.
- **No settling buffer** (plan D13): 311 + CFS are creation-stamped (no approval lag), so only the
  in-progress current month is partial. `03_rollup.py` flags `latest_complete_month` automatically.
- **Refresh cadence is manual.** Rerun the three steps and commit the updated `data/` JSON; no frontend
  change needed. (A scheduled GitHub Action that rebuilds + commits is a noted later option.)

### Editing / adding signals

The single source of truth for filters, labels, datasets, grouping, and provenance is
[`build/signals.py`](build/signals.py) (`SIGNALS` + `GROUPS`). Adding or changing a signal is a registry
edit there + a rebuild — `provenance.json` and the query links regenerate from it, so the page and the
queries can't drift.

## What's where

| Path | Purpose |
|---|---|
| `build/signals.py` | **Registry** — the 5 signals, the 911 group (D14), datasets, filters, runnable-query builder |
| `build/01_pull.py` · `02_assign.py` · `03_rollup.py` | data pipeline (pull → point-in-polygon → rollup) |
| `build/cache/` | **gitignored** raw + assigned intermediate pulls (regenerable, not used by the page) |
| `data/aggregates.json` | committed monthly series per signal + group, per district + citywide |
| `data/points/<signal>.json` | committed compact `[latE5,lngE5,dayIndex,districtIdx]` tuples (map, lazy-loaded) |
| `data/provenance.json` | dataset id+name + **runnable Socrata query per signal and per component** (D7) |
| `data/police_districts.geojson` | the 4 district polygons for the map |

> Frontend (index.html / styles.css / js/) is not built yet — Stage 0 (this data pipeline) is complete.
> See [`plan.md`](plan.md) §10-equivalent staging.
