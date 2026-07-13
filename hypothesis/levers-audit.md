# Hypothesis tool — "Levers" field audit

_Audit date: 2026-07-13. Scope: the `./hypothesis/` tool only — the **Levers**
field in the intervention form and what the tool pulls/displays when that
selection drives an analysis. Sibling dashboards (`districts/`, `theft/`,
`unhoused/`, `drug/`) are out of scope here._

## TL;DR

The Levers dropdown originally offered **17 options**, but only **5** were
actually wired to a real SF OpenData query. The other **12** were label-only
stubs: selecting one and letting the tool analyze it either **errored out**
("Couldn't load data") or **silently analyzed drug complaints instead** (the
default fallback). None of the 12 pulled the data its label promised.

So the concern was correct: the field had been expanded with options that were
**not** responsibly tied to clean data queries.

**Resolved (2026-07-13).** Changes made:

1. The 4 stubs with no cleanly available data source (`fraud`,
   `animal_incidents`, `public_safety`, `public_space`) were **removed**.
2. `cleanliness` was **dropped** (composite; overlaps `overflow`/`dumping`/
   `hazard` and belongs to the standalone cleanliness project).
3. The remaining **7 stubs were wired** to real live queries.
4. Two new levers were added after research: **mental-health crisis calls**
   (`mental_health`) and **potentially life-threatening medical emergencies**
   (`medical_emergencies`). See "Mental-health & overdose research" below.

The field now offers **14 options, all fully wired** — no label-only stubs
remain. `LEVERS` is now simply `[...DATAPOINTS]`.

The **multi-select vs single-data-point** mismatch (below) has since been fixed
by the multi-lever refactor — every selected lever now renders its own panel.
See [plan-multi-lever-analysis.md](plan-multi-lever-analysis.md). The narrative below is kept as the
record of the original bug.

## How a lever becomes a data pull

The field is populated from the `LEVERS` array and rendered as a **multi-select**:

- [`js/datapoints.js:191`](js/datapoints.js#L191) — `LEVERS = [...DATAPOINTS, ...12 extra stubs]`
- [`index.html:66`](hypothesis/index.html#L66) — `<wa-select id="in-expect" … multiple>`
- [`js/app.js:57-59`](hypothesis/js/app.js#L57-L59) — dropdown options come from `LEVERS`

When an analysis runs, the selected key is resolved to a **data point**, which
supplies the dataset + query:

- [`js/app.js:350`](hypothesis/js/app.js#L350) — `fetchEvents(dp, …)`
- [`js/soda.js:15-28`](hypothesis/js/soda.js#L15-L28) — builds the live Socrata URL from
  `dp.dataset` / `dp.geoCol` / `dp.dateCol` / `dp.select` / `dp.signalWhere`
- [`js/datapoints.js:187`](js/datapoints.js#L187) — `getDataPoint(key)` resolves the key

`getDataPoint` falls back to `DATAPOINTS[0]` (drug) when the key isn't a real
data point. A label-only stub has **none** of `dataset/geoCol/dateCol/select/
signalWhere`, so if it is ever passed to `fetchEvents`, `soda.js` requests
`https://data.sfgov.org/resource/undefined.json?...` → HTTP 404 → the results
panel shows **"Couldn't load data: Socrata request failed (HTTP 404)"**
([`js/app.js:378-379`](hypothesis/js/app.js#L378-L379)).

### A compounding bug: the field is `multiple`, but the analysis expects one key

Because the select is `multiple`, `sel.value` is an **array** (e.g. `['fraud']`).
`getDataPoint(['fraud'])` matches nothing (`d.key === ['fraud']` is never true)
and falls back to `DATAPOINTS[0]` — **drug**. Consequences:

- Interactively changing the dropdown after a first run
  ([`js/app.js:61-66`](hypothesis/js/app.js#L61-L66)) re-analyzes **drug**, whatever you picked
  — including for the 5 *wired* levers.
- Editing a saved intervention ([`js/app.js:132-136,154`](hypothesis/js/app.js#L132-L136)) sets the
  multi-select from `record.levers` and calls `run()`, but `run()` reads the
  module-level `dp`, which was never updated from those levers → the shown
  analysis is **drug** unless a single `?dp=<key>` URL param set it.
- Only the **shareable-link path** carries a single key via `?dp=`
  ([`js/app.js:260`](hypothesis/js/app.js#L260), validated by `getDataPoint`), so that is the one
  path where a chosen lever reliably drives its own query — and only for the 5
  wired keys. A hand-crafted `?dp=fraud` hits the 404 path above.

Net: the multi-select label ("what do you expect to change?") invites picking
several outcomes, but the analysis engine is single-data-point and mostly ends
up on the drug default.

## The 14 options — all wired

Every lever below is a real `DATAPOINTS` entry with a live query. `settle`
marks the SFPD levers that carry a report-approval-lag caveat.

| # | Lever `key` | Label | Dataset · filter |
|---|---|---|---|
| 1 | `drug` | Reduce drug-related activity | `2zdj-bwza` · `call_type_final_desc='SUSPICIOUS PERSON' AND onview_flag IN ('N','HSOC') AND (notes LIKE DRUG/DEALER/SALES/METH)` |
| 2 | `overflow` | Reduce overflowing trash cans | `vw6y-z8j6` · `Street and Sidewalk Cleaning` + `service_details LIKE '%overflow%'` (Nov-2025 sensor-cutoff break marker) |
| 3 | `dumping` | Reduce illegal dumping | `vw6y-z8j6` · `Street and Sidewalk Cleaning` + bulky-item tokens |
| 4 | `hazard` | Reduce health-hazard waste | `vw6y-z8j6` · `Street and Sidewalk Cleaning` + human/urine/needle/oil/hazard tokens |
| 5 | `homeless_presence` | Reduce homelessness presence | multi-source: `2zdj-bwza` (Sit/Lie, Blocked Sidewalk, Homeless Complaint) + `vw6y-z8j6` (`Encampment(s)`) |
| 6 | `mental_health` | Reduce mental-health crisis calls | `2zdj-bwza` · `call_type_final_desc IN ('MENTALLY DISTURBED','MENTALLY DIST CRIT') AND onview_flag IN ('N','HSOC') AND dup_cad_number IS NULL` |
| 7 | `medical_emergencies` | Reduce life-threatening medical emergencies | `nuek-vuh3` · `call_type='Medical Incident' AND call_type_group='Potentially Life-Threatening' AND unit_sequence_in_call_dispatch=1` (all-cause, **not** overdose) |
| 8 | `encampments` | Reduce encampments | `vw6y-z8j6` · `service_name IN ('Encampment','Encampments')` **unioned** with post-June-2025 reroute (`General Request` + `service_subtype LIKE '%homeless%'`) |
| 9 | `graffiti` | Reduce graffiti | `vw6y-z8j6` · `service_name IN ('Graffiti','Graffiti Public','Graffiti Private')` |
| 10 | `noise` | Reduce noise complaints | `vw6y-z8j6` · `service_name IN ('Noise Report','Noise')` |
| 11 | `lighting` | Improve lighting | `vw6y-z8j6` · `service_name='Streetlights'` |
| 12 | `shoplifting` | Reduce shoplifting | `wg3w-h783` · `incident_subcategory='Larceny Theft - Shoplifting'` · **settle** |
| 13 | `street_robbery` | Reduce street robbery | `wg3w-h783` · `incident_subcategory='Robbery - Street'` · **settle** |
| 14 | `commercial_burglary` | Reduce commercial burglary | `wg3w-h783` · `incident_subcategory='Burglary - Commercial'` · **settle** |

**Removed 2026-07-13 (no cleanly available data source):** `fraud`
(`wg3w-h783` `incident_category='Fraud'` exists, but fraud is geocoded to
victim/station address and much is online → radius analysis is misleading),
`animal_incidents` (only 311 `General Request - ANIMAL CARE CONTROL`, ~9.7k and
category-ambiguous), `public_safety` (composite; no single dataset), and
`public_space` (no direct public-space-usage signal in SF OpenData).
**Dropped 2026-07-13:** `cleanliness` (composite; overlaps `overflow`/`dumping`/
`hazard`; belongs to the standalone cleanliness project).

### SFPD dataset (`wg3w-h783`) wiring notes
- geo = `point`, date = `incident_datetime`, place = `intersection`; a single
  incident can span multiple rows, so events dedup on `incident_id`.
- **Settled-month caveat:** SFPD incident reports appear only after supervisor
  approval, so the ~2 most recent months undercount (theft-family lag measured
  in `theft/build/build.py`). Surfaced as a verdict warning whenever the
  analysis window's trailing edge reaches within ~2 months of today. 311/CFS
  levers are creation-stamped and carry no such lag.

### EMS dataset (`nuek-vuh3`) wiring notes
- geo = `case_location` (intersection/call-box level; addresses obfuscated for
  privacy), date = `received_dttm`, place = `address`.
- Multiple unit-rows per call → the `signalWhere` keeps only
  `unit_sequence_in_call_dispatch = 1` (verified 1:1 with distinct `call_number`,
  drops nothing), so Socrata returns one row per call and the 5000-row fetch cap
  isn't wasted on duplicate unit rows.
- Real-time (updated daily) — **no** settle lag.
- ⚠️ **Row-cap caveat (tool-wide):** `soda.js` caps each query at `ROW_CAP`
  (5000) rows. High-volume levers in dense areas over long windows can exceed
  that and truncate to the most-recent 5000 (ordered by date DESC) — affects
  `medical_emergencies` and `graffiti` most. **Handled:** a fetch that returns
  exactly `ROW_CAP` rows is flagged `truncated`; the panel shows a verdict
  warning naming the earliest loaded date whenever the analysis window starts
  before it (so a truncated before/after isn't read as real).

## Mental-health & overdose research (2026-07-13)

**Mental health — wired.** SFPD 911 CFS (`2zdj-bwza`) has strong geolocated
signals: `MENTALLY DISTURBED` (~131k) + `MENTALLY DIST CRIT` (~1.8k). Added as
the `mental_health` lever. `WELL BEING CHECK` (~268k) and `PERSON DOWN` (~7.5k)
were **excluded** — mostly generic welfare/triage, not mental-health-specific.
Caveat baked into its description: it measures 911 crisis-response *demand*, not
clinical prevalence, and a drop can mean calls routed to non-police crisis teams.

**Overdose — no point-level source; not wired as an OD lever.** SF publishes 4
overdose datasets, all citywide aggregates (no lat/lng):
- `jxrr-bmra` — Preliminary Unintentional Drug Overdose **Deaths**, monthly,
  through **May 2026** (current, ME-sourced). The authoritative fatal signal.
- `ed3a-sn39` — **Overdose-related 911 (EMS) responses**, weekly, through
  **Mar 29 2026**. Non-fatal proxy; proves EMS *does* flag OD calls internally.
- `k4g8-b3sf` — OD death rate by race/ethnicity, annual (through 2024).
- `ubf6-e57x` — DPH substance-use services incl. naloxone distribution, quarterly.

The incident-level Fire/EMS dataset (`nuek-vuh3`) that *has* lat/lng omits the
medical nature (PHI) — finest grain is `call_type='Medical Incident'`. So where
there's location there's no OD flag, and where there's an OD flag there's no
location. Overdoses are only **~2.4% of medical 911 calls** citywide (3,192 OD /
130,707 medical, 2025), so medical-911 is far too diluted to proxy overdoses.
The `medical_emergencies` lever was added as an **all-cause** acute-medical
signal only — explicitly not overdose. Overdose tracking, if pursued, belongs in
a **citywide trend view** (deaths + EMS responses), a separate build from this
pin-radius tool.

## What the tool displays

All 14 levers now behave the same way: live query → chart over time, before/
after verdict anchored to the intervention date, stat cards, and a map of
events, with the methodology panel showing the dataset + exact runnable query.
The 3 SFPD levers additionally show the settled-month caveat when the window
reaches recent months. (Historically, the 8 stubs either errored with
"Couldn't load data" or silently fell back to a drug analysis — no longer the
case.)

## Recommendation (for a follow-up plan)

**Done (2026-07-13):**

- Removed the 4 no-clean-source stubs (`fraud`, `animal_incidents`,
  `public_safety`, `public_space`).
- Wired the 7 remaining stubs as real `DATAPOINTS`:
  - **311 single service** (reuse `map311`/`point`): `encampments` (with the
    June-2025 reroute union), `graffiti`, `noise`, `lighting`.
  - **SFPD incidents `wg3w-h783`** (new `mapSFPD` mapper + `incident_id` dedup +
    settled-month caveat): `shoplifting`, `street_robbery`, `commercial_burglary`.
- Dropped `cleanliness`.

**Still open — the multi-select vs single-data-point mismatch.** The Levers
field is `multiple`, so `sel.value` is an array and `getDataPoint([...])` falls
back to `DATAPOINTS[0]` (drug). It bites in **edit mode** (analysis ignores the
record's levers, always shows drug — [app.js:132-154](hypothesis/js/app.js#L132-L154)) and on
**interactive change**; **share links** (`?dp=<key>`, single) work, and create
mode never auto-runs an analysis.

_Design discussion in progress (paused 2026-07-13):_ the chosen direction is to
**analyze every selected lever and render a separate bar chart per lever**
(small multiples), since separate axes avoid mixing different nouns/base rates
on one chart. Shared controls (pin, radius, intervention date, one date-range
slider) drive all panels over the same window; queries fire in parallel; each
panel = title · verdict · stat cards · chart (settle notes/breaks fall out
per-panel). Core refactor = parameterize the render path by `(dp, events)` into
a container instead of the current fixed element IDs (this same refactor also
enables a tabbed layout later).

Undecided before implementing:
1. **Map** — `renderEvents` is a singleton ([map.js:64-65](hypothesis/js/map.js#L64-L65)), so choose:
   (a) map follows one lever (cheapest), or (b) one shared map with color-coded
   markers + legend (recommended, needs a `renderEvents` refactor).
2. **Soft cap** on selected levers (~4 suggested) or none.
3. Default window computed from the **combined** events across levers.

Next step: pick (1) and (2), write `plan-multi-lever-analysis.md`, then build.

Adding a data point = adding one entry to `DATAPOINTS` in
[`js/datapoints.js`](hypothesis/js/datapoints.js); the query builder and renderer are already generic.
