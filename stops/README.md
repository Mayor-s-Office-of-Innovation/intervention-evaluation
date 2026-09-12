# Muni stops & shelters — complaints, use, and what a change would cost

A static lookup for **any Muni stop** (3,260 of them) showing four community-reported signals at the stop
month by month, the same signals at its nearest unsheltered neighbours and the surrounding block, and the
cost side — routes served, boardings, accessibility, and the walk to the nearest alternative stop. The
leadership **concern list** is an overlay of pinned stops carrying the stated basis for concern. Design,
decisions and findings: [`plan.md`](plan.md).

## Signals & sources

| Signal | Dataset | Filter |
|---|---|---|
| 311 encampment & unhoused reports | `vw6y-z8j6` | verbatim `unhoused/build/signals.py` · `encampment` |
| 311 shelter maintenance (cleaning · graffiti · damage · litter) | `vw6y-z8j6` | subtype/details tagged `transit_shelter` |
| 911 unhoused-presence calls (Sit/Lie + Homeless Complaint) | `2zdj-bwza` | verbatim `unhoused/build/signals.py` · `cfs_sitlie` + `cfs_homeless` |
| 911 drug-activity reports (Suspicious Person, drug-noted) | `2zdj-bwza` | verbatim `drug/build/signals.py` · `cfs_drug` |
| Stops, shelter flag, accessibility | `i28k-bkz6` (Muni Stops) | snapshot; `shelter` = 1/null |
| Routes served, nearest alternative stop | SFMTA GTFS | `stop_id` = DataSF `stopid` |

Filter parity with the source dashboards is asserted by `validation/validate_stops.py`.

## Refresh the data

```bash
cd stops/build
# 1. GTFS: download https://gtfs.sfmta.com/transitdata/google_transit.zip IN A BROWSER (the host times
#    out for CLI clients) and save it as build/cache/gtfs.zip
python3 01_pull.py        # Socrata pulls (4 signals citywide since 2023 + the stops snapshot) → cache/
python3 02_gtfs.py        # routes + nearest alternative stop per route → cache/gtfs_stops.json
python3 03_join.py        # spatial join, neighbours, 911 intersection mapping → cache/joined.json
python3 04_rollup.py      # → ../data/{stops,concern,citywide,provenance}.json + ../data/series/NN.json
python3 05_mapillary.py   # optional: nearest street-level image id per stop → ../data/mapillary.json
cd ../.. && python3 validation/validate_stops.py && npm run test:stops
```

- `build/cache/` is gitignored (~120 MB, regenerable). `data/` (~4.5 MB) is committed.
- **Concern list — two forms (plan D15).** The repo carries only `build/concern_list.public.tsv` (Stop ID,
  Location, Boardings), and `04_rollup.py` builds that **public** overlay by default: which stops are listed
  and their boardings figure, nothing else. The full leadership list (`build/concern_list.tsv`: precinct, boardings, primary issue, basis /
  notes, missed-servicing rank, needs-verification, removal requests) is **gitignored** — keep it locally.
  In public form the concern-list table section is hidden (each card carries the same facts). To restore the
  details: `python3 04_rollup.py --full` (the table section appears with removal / basis columns
  and the card gains its basis block). Never commit a `--full` build unless
  publishing the list has been cleared. `--concern <path>` points either mode at a file elsewhere. The
  detailed per-stop findings from the plan live in gitignored `private/plan-concern-details.md`.
- **Mapillary:** put `MAPILLARY_TOKEN=MLY|…` in the repo-root `.env.local` (gitignored via `.env.*`).
  `05_mapillary.py` resolves the nearest recent image within 40 m of each stop and stores **only image
  ids**; the page embeds the photo through Mapillary's public iframe, so no token ever reaches the
  browser or GitHub Pages. Without a token the step is skipped and the existing file is kept. First
  run is ~3,260 API calls (a few minutes); later runs only resolve new stops (`--refresh` redoes all,
  `--only concern` does the concern list).
- Stop IDs: the public 5-digit ID (`17301`) = `1` + DataSF/GTFS 4-digit `stopid` (`7301`). The page
  accepts either.

## Geometry (plan D6)

- **311 → stop:** nearest stop within 25 m of the case point; ring = every stop 25–250 m away.
- **911 → stop:** calls are geocoded to intersection centroids. Each stop is assigned to the centroid whose
  name carries its on/at streets (≤160 m), else the nearest centroid ≤100 m; the calls are shared by every
  stop at that intersection and labelled "at this intersection". No centroid in reach ⇒ no calls of that
  type near the stop since 2023 (a genuine zero, flagged).
- **Neighbours:** the 3 nearest unsheltered stops within 400 m (the "is it the shelter or the corner?" baseline).

## What's where

| Path | Purpose |
|---|---|
| `build/signals.py` | registry: the 4 signals, geometry constants, runnable-query builders |
| `build/01_pull.py` … `04_rollup.py` | pipeline (see above) |
| `build/concern_list.public.tsv` | the committed overlay input (stop identities + boardings) |
| `build/concern_list.tsv` · `private/` | gitignored: the full list and the per-stop findings (D15) |
| `data/stops.json` | every stop's meta + 12-month totals per signal (map + search) |
| `data/series/NN.json` | per-stop monthly series (stop + ring), sharded by the first two digits of `stopid` |
| `data/concern.json` · `data/citywide.json` · `data/provenance.json` | overlay · concentration context · datasets, filters, query links |
| `data/mapillary.json` | optional: nearest Mapillary image id per stop (built with a token, served without one) |
| `index.html` · `styles.css` · `js/app.js` | the page: map + search → stop card (`?stop=<id>`) |
| `tests/e2e.spec.js` | Playwright (`npm run test:stops`) |

## Automated refresh

[`.github/workflows/refresh-data.yml`](../.github/workflows/refresh-data.yml) rebuilds this tool weekly with
the other dashboards: GTFS is fetched best-effort (on failure `03_join.py` carries the committed routes
forward and the page shows the older "routes as of" date), Mapillary resolves only new stops and only if
the `MAPILLARY_TOKEN` repository secret is set, `validation/validate_stops.py` gates the PR, and the PR body
includes concern-list totals per signal. `deploy.yml` runs the validator + `test:stops` and stages `stops/`.

## Not built (plan §12)

Intervention log — deprioritised pending a team decision.
