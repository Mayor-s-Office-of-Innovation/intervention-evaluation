# Plan — Day/Night time-of-day filter (drug + unhoused)

A global **Day / Night** toggle that filters every visualization on the `drug` and `unhoused`
dashboards: headline numbers, KR tickers, line charts, the map dot layer, and the hot/cold
transition map. Prototype in `drug`, extract the shared mechanics into `shared/`, then apply to
`unhoused`. `theft` is **deferred** (server-side-only build; see §8).

Builds on the existing — but narrow — time-of-day support: markers already carry `hour`, and the
cell-details popup already has morning/afternoon/evening/night chips ([shared/transition-map.js:38](shared/transition-map.js#L38),
[:373](shared/transition-map.js#L373)). That filter touches **only** the incident-type breakdown
inside one clicked cell. This feature promotes time-of-day to a **global** filter.

## 1. Locked decisions

- **Scope:** `drug` + `unhoused` only. `theft` deferred.
- **Cutoff (fixed, baked at build time):** `DAY = 06:00–19:59`, `NIGHT = 20:00–05:59`
  ("a bit after average SF sunset"). One constant pair, footnoted, easy to tune.
- **UI:** two toggle chips, **Day** and **Night**, both active by default; at least one must stay
  on (deselecting the last is a no-op). Reuses the existing `.seg` chip styling.
- **Default state = both on = byte-identical to today.** Critical invariant (see §6).

## 2. The single definition

One source of truth, shared by Python and JS:

```
DAY_START   = 6     # 06:00 inclusive
NIGHT_START = 20    # 20:00 inclusive
bucket(hour):  6 <= hour < 20  -> "day"
               else (incl. hour 0..5, 20..23) -> "night"
```

- Python: a tiny `tod.py` helper (or a constant in each `signals.py`) — `tod_bucket(hour) -> 'day'|'night'`.
- JS: a constant + `todBucket(hour)` in `shared/transition-map.js` (next to the existing
  `TIME_BUCKETS`/`getTimeBucket`, which stay for the finer popup view).

**No unknown bucket — verified against the data (2026-06).** Every signal is fully time-stamped:
record-based caches have **0 / ~437k** null-hour rows (exactly 0.000%), and the server-side arrest
signal (`wg3w-h783`) has all 24 hours populated with a natural curve — hour `00:00` (554) sits on the
night slope between 23:00 (539) and 01:00 (350), i.e. **no midnight "unknown-time" placeholder spike**.
So `day + night == total` exactly; no third bucket, no special-casing. (Safety net: a `-1`/null hour, if
one ever appears, falls into `night` via the `else` and is caught by the §6 sum assertion.)

## 3. Data-model changes (additive — never replace the existing totals)

The existing total fields stay untouched so the parity oracle and the trace harness keep validating
the **both-on** (= total) state unchanged. We *add* day/night siblings.

### aggregates.json — per signal
```
"series":      { "<District>": [..total per month..], "Citywide": [...] },   // UNCHANGED
"series_tod":  { "day":   { "<District>": [...], "Citywide": [...] },
                 "night": { "<District>": [...], "Citywide": [...] } }       // NEW
```
Frontend: both on → use `series` (total); one on → use that `series_tod` bucket. (`day + night ==
total` exactly, so the total stays available with both chips on.)

### points/<signal>.json — map dots
```
[lat, lng, day, dist_idx]            // UNCHANGED shape...
[lat, lng, day, dist_idx, tod]       // NEW trailing field: 0=day, 1=night
```

### transitions/<signal>.json — hot/cold cells + scrubber
Each cell and the district tide gain day/night histograms beside the existing total:
```
"monthly":        [...],   // total, UNCHANGED — stays the parity oracle for "both on"
"monthly_day":    [...],   // NEW
"monthly_night":  [...],   // NEW
```
and in `_meta`/summary, `district_monthly` gains `district_monthly_day` / `district_monthly_night`.
`classify.js` selects which monthly array(s) to feed: both → `monthly` (oracle, untouched); one →
that bucket; the district tide is recomputed from the matching district array so the
difference-in-differences still cancels seasonality **within** the selected bucket.

### markers/<mapkey>.json — UNCHANGED
Already carry `hour`. The global filter pre-selects which markers feed the cell-details popup; the
popup's existing 4 chips then operate within that selection.

## 4. Build changes

### unhoused — record-based, no server work
Every signal has an assigned cache with `hour` ([02_assign.py:111](unhoused/build/02_assign.py#L111)).
In the per-record loops, split each accumulator by `tod_bucket(r["hour"])`:
- `03_rollup.py` `rollup()` — split `city`/`by_dist` into day/night dicts → emit `series_tod`; append
  `tod` to each `pts` row.
- `04_transitions.py` `classify()` — split each cell's `c["m"]` and `dist_month` into day/night →
  emit `monthly_day/night` + `district_monthly_day/night`.
- `05_markers.py` — no change (hour already baked).

### drug — same, plus ONE server-side piece
- `cfs_drug` (point) — identical record-based split as above.
- `dealer_arrests` / `paraphernalia` / `other_drug_arrests` (`agg_only`, server-grouped in
  [03_rollup.py:84 `rollup_agg`](drug/build/03_rollup.py#L84)) — add an hour bucket to the GROUP BY:
  ```sql
  $select: date_trunc_ym(incident_datetime) AS ym, police_district AS dist,
           CASE WHEN date_extract_hh(incident_datetime) >= 6
                 AND date_extract_hh(incident_datetime) < 20 THEN 'day' ELSE 'night' END AS tod,
           count(distinct incident_id) AS n
  $group:  ym, police_district, tod
  ```
  Build `series_tod` from the `tod` column; keep the existing total query for `series`.
- `needles` — excluded from the trend/charts already; no day/night needed.

### provenance.json
For each signal add the day/night runnable queries (D7 — every number ties back to source). The
`agg_only` arrest signals get the `CASE … date_extract_hh` query; the record-based signals get a
client-note that day/night is derived from the pulled `received_datetime`/`requested_datetime` hour.

## 5. Frontend changes

### Shared (`shared/`)
- `transition-map.js`: `todBucket()` + a global `todFilter` ('both'|'day'|'night'); dot layer and
  marker layer respect it; cell counts use the selected monthly array(s) via `classify.js`.
- `classify.js`: `classifyCell`/`classifyCells` take a `monthlySel` + matching `districtMonthlySel`
  (the chosen total/day/night arrays) instead of hardcoding `.monthly`. Both-on passes the existing
  arrays → **parity oracle unchanged**.

### Per dashboard (`drug/js/app.js`, `unhoused/js/app.js`)
- **Placement (locked):** a page-level control strip at the **top of `<main>`, above the headline
  cards** (`#summary-cards`) — between the `#data-asof` line and the first viz, so it reads as
  governing the whole page (unlike the scrubber, which lives inside the chart panel). A "Time of day"
  label + a segmented `.map-controls`/`.seg` pill holding **Day** / **Night**, both `is-active` by
  default; clicking the last active one is a no-op (≥1 must stay on).
- Render the two chips and wire a `todFilter` state. Changing it re-renders: KR/headline cards, the
  line chart, the points layer, the transition cells. (Same re-render fan-out the scrubber already
  triggers — [drug/js/app.js:449](drug/js/app.js#L449).)
- Chart + KR ticker: when a single bucket is selected, read from `series_tod[bucket]` instead of
  `series`; recompute trailing-12mo / YoY off that bucket.

## 6. The parity invariant + honesty

- **Both on == today.** Every existing baked total (`series`, `monthly`, `category`,
  `district_monthly`) is untouched; the frontend only swaps to day/night arrays when a single bucket
  is active. So default render, the parity oracle (`validation/parity.mjs`), and the data-trace
  harness ([validation/trace.py](validation/)) all stay green with **no expected-value changes**.
- **New validation:** extend the trace harness with day/night sub-queries asserting
  `series_day + series_night == series` per signal/month (exact — no unknown term).
- **Caveat (footnote).** Day/night on the **enforcement/arrest** signals partly reflects *shift
  staffing*, not just activity timing (reflexivity — consistent with the existing arrest caveats and
  [[crime-effectiveness-enforcement-reflexivity]]). The community-report signals (`cfs_drug`,
  `cfs_presence`, encampment) are the robust ones to read by time of day. State the fixed cutoff and
  this caveat wherever the toggle appears / in the methodology.

## 7. Sequencing

1. ✅ **drug build** — `tod` helper; record-based split for `cfs_drug`; server-side `CASE` for the
   arrest signals; `series_tod` + `points` tod field + transitions day/night arrays. Verified
   `day+night==total` (0 mismatches); totals unchanged vs HEAD (only live drift on arrest signals).
2. ✅ **shared frontend** — `todBucket`, `setTodFilter`, `classify.js` `monthlyKey` arg, dot/marker
   + cell-details filtering. Parity oracle still green (default `monthlyKey='monthly'`).
3. ✅ **drug app.js** — Day/Night chips (top of `<main>`) + `seriesBlock` bucket selection across
   cards/citywide/chart/composition/map + re-render wiring.
4. ✅ **extract → unhoused** — `tod.py`, record-based splits in 03/04, toggle strip + app.js wiring.
   Verified `day+night==total`, totals **identical** to HEAD (cache-based), parity oracle green (both signals).
5. ⏳ **validation** — extend trace harness with a live `series_day+series_night==series` assertion
   (deferred — needs network).
6. ⏳ **docs/caveats** — optional methodology footnote (cutoff + reflexivity note). Not yet added.
7. **theft** — deferred (§8).

Hot-rate threshold stays absolute (decided): day/night views legitimately show fewer/zero hotspots
since a smaller slice rarely clears the per-month bar — more honest + comparable across views.

## 8. Deferred: theft

`theft/build/build.py` keeps no raw rows — it fetches pre-grouped monthly counts server-side. Adding
day/night means a `CASE … date_extract_hh(incident_date)` in every GROUP BY (doubling each series) and
a frontend toggle on the KR tickers. Mechanically the same as drug's `rollup_agg` piece, but theft has
no map, so it's lower value and split out to a follow-up.

## 9. Open questions / risks

- **Arrest-hour fidelity:** `incident_datetime` is sometimes an officer estimate; day/night is coarse
  enough to absorb that, but worth a line in the caveat.
- **File-size:** transitions roughly doubles (two extra monthly arrays/cell). Likely fine; check the
  KB print in `04_transitions` after the change.
- ~~Chip placement~~ — **resolved:** top of `<main>`, above the headline cards (§5).
