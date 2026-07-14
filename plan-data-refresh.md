# Plan — Refresh dashboard data (drug · unhoused · theft + homepage)

**Date:** 2026-07-14
**Goal:** Re-pull the latest SF OpenData for all three OKR dashboards and their homepage roll-ups,
verify every number ties back to source, and hand back git commands to commit.

## Why now
Data last generated (per each `data/provenance.json`):

| Dashboard | Last generated | Data span |
|-----------|----------------|-----------|
| theft     | 2026-06-22     | 2021-01-01 → present |
| drug      | 2026-06-26     | 2023-01-01 → present, latest settled month 2026-04 |
| unhoused  | 2026-06-29     | 2023-01-01 → present |

~3 weeks stale. A refresh pulls through June/July 2026.

## Scope
In scope: `drug/`, `unhoused/`, `theft/` data pipelines. The homepage (`index.html` + `js/app.js`)
reads each dashboard's `data/aggregates.json` live — it has **no separate data build**, so the three
rebuilds refresh it automatically. District cards' emerging signals (fraud / dog bites / street
robbery) are fetched live in-browser and are never baked.

Out of scope (not powered by these datasets / not stale): `districts/` geojson, `okr-map/`,
`hypothesis/`, `interventions-api/`, saved-interventions Worker.

## Key facts
- All builds are **stdlib Python 3**, anonymous read-only GETs against `data.sfgov.org`.
  No token, no `pip install`. `01_pull.py` already sleeps 0.3s between pages (polite).
- `provenance.json` `generated` date and partial/settled-month shading are computed from
  `date.today()` at build time — **no manual date edits needed**.
- Re-running `01_pull.py` overwrites `build/cache/*_raw.json`.

## Steps

### 1. Refresh `drug/` (from `drug/build/`)
```
python3 01_pull.py         # raw cfs_drug points (the map signal)
python3 02_assign.py       # point-in-polygon → police district
python3 03_rollup.py       # aggregates.json + provenance.json (+ agg_only arrest/needle signals)
python3 04_transitions.py  # hot/cold displacement cells
python3 05_markers.py      # zoom-in report markers
```

### 2. Refresh `unhoused/` (from `unhoused/build/`)
```
python3 01_pull.py
python3 02_assign.py
python3 03_rollup.py
python3 04_transitions.py
python3 05_markers.py
```

### 3. Refresh `theft/` (from repo root or `theft/`)
```
python3 theft/build/build.py
```

### 4. Validate (from repo root)
```
python3 validation/validate_build.py           # V1+V3 structural invariants, all dashboards
node    validation/parity.mjs drug
node    validation/parity.mjs unhoused
python3 validation/trace.py drug                # live source ↔ baked reconciliation
python3 validation/trace.py unhoused
npm run test:all                                # homepage + 3 dashboards e2e + build + parity
```
- `validate_build.py` / `parity.mjs` / e2e must pass (deploy gate).
- `trace.py` hits live Socrata — a mismatch flags real source drift to investigate before commit,
  not a hard blocker (it's the nightly-only check).

### 5. Dashboard-review pass (post-refresh)
Run the `dashboard-review` skill over each refreshed dashboard (drug, unhoused, theft) to re-check
accuracy, source integrity, denominator/population conflation, and neutral tone against the new
numbers. Apply fixes only on confirmation.

### 6. Docs
Add a standing "Refreshing the data" runbook section to the root `README.md` (all-three order,
validation sequence, homepage-auto-follows, stop-on-mismatch). **[done]**

### 7. Review & commit (Aaron runs git)
- `git diff --stat` to confirm only `*/data/**` JSON changed (+ the three `provenance.json` dates).
- Spot-check headline deltas make sense (no giant swings from a filter/schema change upstream).
- Commit commands handed back for Aaron to run.

## Risks / watch-for
- **Upstream schema/filter drift** (a renamed category, changed `service_subtype`) surfaces as a
  `trace.py` mismatch or an unexplained count cliff — investigate, don't blindly commit.
- **Portal outage / rate-limit** on the open portal — retry; pulls are resumable per stage.
- **New settled month** shifts drug/theft headline cards forward one month (expected).
- Large `diff` in `points/` and `markers/` is normal (every refresh rewrites them).

## Verification of done
All validation green, `git diff` limited to data JSON, headline deltas sane, commands returned.
