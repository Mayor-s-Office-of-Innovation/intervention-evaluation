# Plan — Muni Stops & Shelters: complaints, use, and what a change would cost

**Working title:** "Bus stops — who complains, who rides, what changing the stop would do"
**Owner:** Aaron · **Drafted:** 2026-09-11
**Status:** 🟢 Built (2026-09-12) — pipeline, data, page, Mapillary, weekly refresh + deploy wiring. Remaining items deprioritised (§12).

> Living document. Keep it current as we build (see Changelog, §11).

---

## 1. Goal

Leadership has a list of ~30 downtown bus stops that draw repeated complaints — people sheltering,
congregating, or using drugs at the stop — and is weighing **changes to those stops**: removing the
shelter structure, removing the stop itself, or reversible measures (lighting, cleaning cadence, foot
patrols, outreach). Shelter and stop removals are effectively permanent; nobody rebuilds them.

This tool gives leadership, **for any Muni stop**, one card answering four questions:

1. **What is happening there?** Community-reported encampment, unhoused-presence, and drug-activity
   signals month by month, plus the shelter-maintenance signal.
2. **Is the stop the draw, or the corner?** The same signals at the nearest unsheltered stops and
   the surrounding block, so a shelter-specific effect is separable from a busy corner.
3. **Who loses if the stop changes?** Routes served, daily boardings, wheelchair accessibility, and
   the walk to the nearest alternative stop on each route.
4. **Did a change work?** Once an intervention is logged with a date, the same card becomes the
   before/after and displacement view — the pattern every other dashboard in this repo uses.

**Two layers (D1):**
- **Universal stop lookup** — every one of SFMTA's 3,260 stops is precomputed. Search by stop ID
  (4- or 5-digit), street names, or click the map. Stable URL per stop.
- **Concern-list overlay** — the leadership list is a curated set of pinned stops with the *stated
  basis for concern* attached. When the list changes, add or drop a row; the card is the same.

**Companion projects this builds on:** [`../unhoused/`](../unhoused/plan.md) (311 encampment filter,
CFS sit/lie + homeless complaint, hot/cold transition map), [`../drug/`](../drug/plan.md) (the
drug-noted 911 filter), [`../interventions-api/`](../interventions-api/README.md) and
[`../docs/plan-photo-uploads.md`](../docs/plan-photo-uploads.md) (saved interventions + staff photos).

---

## 2. Framing — what the tool must say out loud

This page can read as a removal hit-list if built carelessly. It must not. Three framing rules:

- **Complaints measure reporting, not harm.** 311 volume reflects who calls, and a burst can be one
  neighbour. 911 community calls are broader but still perception. The page says this on every card
  (as the other dashboards do for community-reported signals).
- **Removal is one option, listed with the reversible ones.** The card's intervention log accepts
  *any* change type. Lighting, cleaning, patrol, outreach, and relocation are first-class, so a
  before/after on a lighting change looks identical to one on a removal.
- **Cost is shown next to complaints, always.** Boardings, routes, accessibility, and walk-to-next-stop
  sit beside the complaint counts. A high-complaint stop on the 38 Geary with 200 boardings/day is a
  different decision from a 6-boarding stop, and the layout must make that visible without reading.

---

## 3. Data sources — validated live (2026-09-11)

| Source | Dataset | What we take | Validated |
|---|---|---|---|
| **Muni Stops** | DataSF `i28k-bkz6` | `stopid` (4-digit), name, lat/lon, `shelter` flag, `accessibilitymask`, supervisor district | 3,260 stops; **991 sheltered**. `shelter` is `1` or null — one snapshot (signup 151, as of 2026-04-08), **no history**. Flags bus shelters only; T-Third / N-Judah platform canopies are unflagged. |
| **GTFS** | SFMTA feed (`gtfs.sfmta.com/transitdata/google_transit.zip`) | routes per stop; stop sequence per route+direction → nearest alternative stop; `wheelchair_boarding` | GTFS `stop_id` **= DataSF `stopid`**; `stop_code` = public 5-digit ID. All 29 listed stops present. The host **times out from CLI** — download in a browser; the build reads the zip from a path. |
| **311 encampment / unhoused** | `vw6y-z8j6` | the exact `encampment` union from `unhoused/build/signals.py` (Encampment(s) ∪ General Request homelessness), lat/long | 153k cases since 2024-01 with coordinates; 14% fall within 25 m of a stop. |
| **311 shelter-tagged** | `vw6y-z8j6` | cases whose `service_subtype` or `service_details` contains `transit_shelter` (Street & Sidewalk Cleaning, Graffiti, Damaged Property, Litter Receptacle) | 25.7k since 2023. Explicitly *about the structure* — the public maintenance signal. |
| **911 unhoused presence** | `2zdj-bwza` | `SIT/LIE ENFORCEMENT` + `HOMELESS COMPLAINT`, community gate (`onview_flag IN ('N','HSOC') AND dup_cad_number IS NULL`) — same as `unhoused/` | 15.4k in the downtown box since 2024. |
| **911 drug activity** | `2zdj-bwza` | `SUSPICIOUS PERSON` with drug/dealer/sales/meth in call notes — verbatim `drug/build/signals.py` `_CFS_DRUG_WHERE` | 13.8k in the downtown box since 2024. |
| **Concern list** | leadership TSV (`bustops.txt`, 2026-09-11) | Stop ID, location, precinct, boardings, primary issue, basis/notes, missed-servicing rank, removal request | 33 rows → **29 matched** (3 are "not a stop"/unused/TBD). Seed for the overlay (§7). |

**Not available (slots reserved):**
- **Stop-level ridership series.** The list carries a single "boardings" number per stop (its column
  header says *Lift deployments*, but values like 294–303/day are boardings — **confirm with SFMTA**).
  A proper APC series may arrive later; the card shows the list number labelled "from leadership
  list, date unknown" until then.
- **Shelter contractor missed-servicing counts.** The list has only a Jan–Jun *rank*. It is the most
  direct occupancy signal we know of (crew arrives, someone is inside, no clean). Ask SFMTA for the
  per-stop monthly log; the card has a slot for it.
- **Shelter/stop change history.** No public source. The list notes one prior shelter removal (2022,
  unverified; which stop and at whose request is in the private file, D15). The intervention log (§8)
  is how history accrues from here on.

---

## 4. Data reality check — what the seed list shows (verified live, 2026-09-11)

Counts are 2024-01 → 2026-09 (~32 months). 311 within 25 m of the stop; 911 within 45 m of the
stop's intersection point (see D6 for why that radius is wrong and what replaces it).

### 4.1 Concentration is real citywide — and the concern list is not where it peaks

Encampment 311 within 25 m of a **sheltered** stop: top 10 stops = **22%**, top 50 = **47%**; 225 of
991 sheltered stops have zero. The **Castro cluster** dominates (Market & Castro EB **612** cases in
32 of 33 months; three more Castro stops in the top 20). **None are on the leadership list**, which
is entirely Tenderloin/Southern. The list reflects who complains *to the city directly* (CBDs, State
DGS, the shelter contractor), not 311 volume. The page keeps a citywide ranking as context (D9).

### 4.2 The shelter is the draw at some sites and irrelevant at others

Sheltered stops average **1.4×** the encampment cases of their three nearest unsheltered stops
(≤400 m), but only **48%** of sheltered stops exceed their neighbours at all. **9 of the 29 listed
stops have no shelter today** — including Market & Taylor NB (136 encampment cases, 150 sit/lie +
homeless calls, 84 drug calls; 22 boardings/day) and Turk & Hyde, which the list itself notes has
no shelter. Whatever draws people to those corners, it isn't a roof.

### 4.3 The four signals disagree about what each site *is*

_Per-stop table (removal requests, boardings, basis, the four signal counts) moved to
`stops/private/plan-concern-details.md` (gitignored) pending permission to publish the list's details — see D15.
The public findings: the four signals disagree about what each site *is* (a drug corner vs. an encampment
site vs. heavy on everything); some listed stops show almost nothing in 311 or 911 over 32 months, so their
basis is stakeholder-reported; several are high-use stops (100–300 boardings/day); and a stop's nearest
alternative can itself be listed, so removals compound._
### 4.4 The signals do not track the contractor's rank

Spearman rank correlation between the list's Jan–Jun missed-servicing rank and (a) shelter-tagged 311
= −0.16, (b) encampment 311 = 0.05. Missed servicing (someone inside at cleaning time) is a distinct
signal from public complaints. **The three families measure three different things** and the card
shows all of them rather than a blended index (`../districts/` D4 discipline).

### 4.5 The one prior removal — a "natural experiment" that says little

The list records one shelter removed in 2022 (stop and details in the private file, D15). If the date
is real, 311 can't show its effect: encampment cases within 25 m of that stop were already 0–4 per
half-year through 2020–22 and stayed there, while the 25–250 m ring ran 380–1,200 per half-year
throughout. The corner is still on the 2026 list. This is the honest precedent: **removal did not
remove the concern**. Show it as a case study, with the unverified caveat, once the date is confirmed
and the list details are cleared for publication.

---

## 5. Method & architecture — reuse `../unhoused/` wholesale

Same shape as the other tools: **offline Python build → pre-baked JSON → static ES-module page**,
no live Socrata calls at view time, every number linked to a runnable query in `provenance.json`.

```
stops/
  plan.md  README.md
  index.html  styles.css              ← map + search + per-stop card
  js/app.js                            ← imports ../shared/{data,rollup,chart,cross-street-search}.js
  data/
    stops.json                         ← 3,260 stops: id, code, name, lat/lng, shelter, wheelchair,
                                          routes[], nearest_alt{stop,m,route}, worst_route_gap_m,
                                          neighbours[] (3 nearest unsheltered ≤400 m), intersection_id
    concern.json                       ← the overlay (§7): pinned stops + basis + removal flag + list boardings
    series/<stopid>.json               ← monthly counts for the 4 signals at the stop + neighbours + ring
                                          (lazy-loaded, one small file per stop)
    provenance.json
    citywide.json                      ← §4.1 ranking, for the context view
  build/
    signals.py                         ← registry: the 4 signals (filters imported/duplicated verbatim from
                                          unhoused/ and drug/ registries — parity checked, see §10)
    01_pull.py  02_join.py  03_rollup.py  04_gtfs.py
    cache/                             ← gitignored raw pulls + the GTFS zip
  tests/e2e.spec.js
```

**Spatial join (D6):**
- **311 → stop:** nearest stop within **25 m** of the case point (cases are address/intersection
  geocoded; 25 m keeps the stop's own corner without swallowing the next stop).
- **911 → stop:** by **intersection, not radius.** CFS points are intersection centroids; far-side and
  mid-block stops (Market & Mason, Market & Hyde) show *zero* calls under a 45 m radius while the
  corner clearly has them. Each stop gets a parent intersection — **the centroid whose name carries the
  stop's on+at streets within 160 m, else the nearest centroid within 100 m** (built: big Market St
  intersections put far-side stops 80–130 m from the centroid, so pure-nearest picked wrong corners).
  Calls attach to every stop at that intersection, labelled "at this intersection" — never "at this
  stop". Centroids exist only for intersections with calls, so "no centroid in reach" means no calls of
  that type near the stop since 2023: a genuine zero, flagged, not "not attributable".
- **Ring:** 25–250 m annulus around the stop for the displacement panel.
- **Neighbours:** the 3 nearest *unsheltered* stops within 400 m (attribution baseline, §4.2).

**Everything else** (monthly rollup, `latest_complete_month`, partial-month shading, YoY / trailing-12
helpers, chart rendering, cross-street search) is the shared library as-is.

---

## 6. Decisions locked

- **D1 — Two layers, one card.** Universal lookup for all stops + a concern-list overlay. The card
  is identical either way; the overlay only adds the basis-for-concern block and a pin.
- **D2 — Four signals, never blended.** 311 encampment/unhoused; 311 shelter-tagged maintenance;
  911 sit/lie + homeless complaint; 911 drug-noted suspicious person. Each its own series and
  sparkline. No composite score, no "priority index" — a rank would be read as a verdict.
- **D3 — Filters are verbatim from `unhoused/` and `drug/`.** Same queries, same community gate,
  so a number here equals the same number on those dashboards for the same place and month.
- **D4 — Cost columns are mandatory on the card**, above the fold, beside the complaint counts:
  routes, boardings (with source + date), wheelchair boarding, nearest alternative stop per route
  and the walk in metres. Missing data renders as an explicit "not available" slot, never blank.
- **D5 — Intervention-agnostic before/after.** The log takes a date + type (shelter removed, stop
  removed, stop relocated, lighting, cleaning cadence, foot patrol, outreach, other) + note. The
  card renders the same pre/post + neighbour + ring panels for any type.
- **D6 — 911 joins by intersection; 311 by 25 m radius.** See §5. The card labels the geometry.
- **D7 — Alternatives that are themselves pinned are flagged.** Nearest-alt lookups check the
  overlay and warn "also on the concern list".
- **D8 — Basis for concern is shown, and typed.** Each pinned stop carries its basis verbatim from
  the list and a type: *contractor missed-servicing*, *CBD flag*, *State DGS*, *311/911 data*. When
  the data doesn't support the concern, the card says so plainly.
- **D9 — Citywide context stays.** A ranked list of the top sheltered stops by encampment cases,
  so the Castro cluster is visible even though it is not on the list.
- **D10 — Photos: Mapillary + staff uploads, not 311 media.** The public 311 API does return a
  `media_url` for many cases (Cloudinary-hosted), but those images show people in crisis and we
  would be re-publishing them; Aaron's call is to skip them. Instead: (a) a **Mapillary** embed of the
  nearest street-level image (free token, attribution required, coverage/recency varies), (b) a plain
  **Google Street View link** (no key, opens the panorama at the stop), (c) **staff photos** via the
  existing upload worker once a stop intervention is a saved intervention (§8).
  **Built (2026-09-12):** the token lives in the gitignored repo-root `.env.local`; `05_mapillary.py`
  resolves the nearest recent image within 40 m per stop and stores only image ids; the card embeds
  Mapillary's public iframe by image key, so the token never reaches the browser or Pages.
- **D11 — Shelter flag is a snapshot.** DataSF has no shelter history. The build stores the
  `data_as_of` date with the flag; the log is the only source of change history going forward.
- **D12 — Part of every regular refresh.** The stops tool is rebuilt by the weekly
  [`refresh-data.yml`](../.github/workflows/refresh-data.yml) run alongside drug/unhoused/theft, gated by
  `validation/validate_stops.py` (parity + invariants) and `npm run test:stops`, and its headline deltas
  (concern-list totals per signal) are included in the refresh PR table. **GTFS in CI:** the feed host
  times out from some networks; the workflow tries the download and, on failure, falls back to the
  committed `build/cache/gtfs_stops.json`-equivalent (`data/stops.json` already carries routes/alts, so a
  Socrata-only refresh still succeeds). Routes change only at SFMTA sign-ups (every 3–6 months), so a
  stale GTFS is acceptable for weeks, and a `gtfs_as_of` date on the page says how stale.
- **D13 — Map colouring is a checkbox set, not a single pick.** Each checked signal keeps its card
  colour; a dot takes the colour of the checked signal that dominates there (each signal normalised by
  its own citywide 95th percentile so a "hot" maintenance stop can compete with a "hot" encampment stop),
  and its size follows the summed intensity. Unchecking a signal visibly removes its colour, which is
  how a reader sees what each signal contributes.
  **Amended 2026-09-14 — wedge glyphs.** A single hue hid combinations: a stop with encampment *and*
  drug both elevated looked like an encampment-only stop. From zoom 14 up each dot is now a glyph with
  one fixed quadrant per signal (↖ encampment, ↗ shelter-tagged, ↙ 911 unhoused, ↘ 911 drug); a wedge
  is drawn only when its signal is checked and at least 25% of its citywide p95, and its radius grows
  with intensity. Fixed positions (not a proportional pie) so the layout is learned once and issues
  can be counted without decoding hue. Below zoom 14 dots are 3 px and keep the dominant-hue rule.
  The picker swatches are the quadrant shapes, so the picker is the key.

---

- **D15 — Concern-list details are private until cleared (2026-09-12, Aaron).** Permission to publish
  the list's notes and removal requests is unconfirmed, so the repo carries only stop identities and
  boardings (`concern_list.public.tsv`) — **boardings were explicitly cleared for publication
  (2026-09-12, Aaron); the notes and removal requests were not** — the build is public-by-default (`--full` opts in), and the per-stop findings
  tables live in gitignored `stops/private/`. Restoring is a rebuild with `--full` plus moving the private
  sections back into this plan.
- **D14 — Map usability (2026-09-12, Aaron).** (a) Canvas renderer with an 8 px click tolerance so a
  click beside a small dot still opens it. (b) The map opens on the concern-list extent at
  neighbourhood zoom (≤15) rather than the whole city. (c) **"Streets first"** toggle: the Carto Voyager
  base draws minor streets white-on-cream (invisible under dots), so the toggle swaps the base to
  OpenStreetMap's standard tiles — every street outlined and named — and fades/shrinks the dots.
  OSM has no dark style; dark mode applies a CSS invert. OSM tile policy: attribution shown, low
  traffic, browser sends the referer — acceptable for this dashboard; revisit if usage grows.

## 7. The concern-list overlay

**Two forms (D15).** `build/concern_list.public.tsv` (committed) carries Stop ID, Location and the list's boardings figure;
`build/concern_list.tsv` (gitignored, kept locally) is the full leadership list. `04_rollup.py` builds the
**public** overlay by default — stop identity, matched `stopid`, DataSF name, shelter flag, boardings (as
given, shown on the card), and which listed stops are each other's nearest alternative — and only with
`--full` adds precinct, primary issue, basis/notes verbatim, basis type (D8), missed-servicing rank, needs-verification
and removal-requested flags. `data/concern.json` records which form it is (`detail`), and the page adapts:
in public form the map outlines and the "On the concern list" pill remain, the concern-list table section
is hidden altogether (its columns are all on each card; the list shouldn't be the page's emphasis), and the
card's basis block and contractor slot are not rendered. Rows that
don't match a stop are kept with `matched: false` either way.

**Known list issues to raise with the author** (keep until resolved):
_Moved to `stops/private/plan-concern-details.md` (gitignored) — see D15._

Updating the list = replace the TSV, rerun `03_rollup.py`. No frontend change.

---

## 8. Intervention log & photos — reuse `interventions-api`

The saved-interventions Worker currently accepts only `…/hypothesis/?…` URLs (origin allowlist,
`docs/plan-saved-interventions.md` §6). Extend the allowlist to `…/stops/?stop=<id>&date=…&type=…&what=…`
— a stop intervention is then a saved intervention like any other: listed on the homepage, soft-
deletable, and **photo-capable** through the existing sfgov.org-gated upload widget (up to 6 photos,
EXIF stripped). No new storage, no new auth.

The stop card reads the saved list, filters to its stop, and draws each logged change as a dated
marker on the four series with the standard pre/post window comparison and the neighbour + ring
panels beside it.

---

## 9. Views

1. **Map + search** (default). All stops as small dots, sheltered stops distinct, pinned stops
   highlighted. Cross-street search (shared) and stop-ID search (4- or 5-digit). Toggle a signal to
   colour dots by 12-month count.
2. **Stop card** (`?stop=<id>`). Header: name, ID, routes, shelter Y/N (as of date), wheelchair,
   boardings, nearest alternative per route with walk and the D7 flag, Street View link, Mapillary
   image. Body: four sparklines (stop / neighbours / ring), the basis-for-concern block if pinned,
   the intervention log with before/after panels, shelter-tagged maintenance count, missed-servicing
   rank and contractor-log slot, provenance links.
3. **Concern list** table: every pinned stop with the §4.3 columns, sortable, with the basis type.
4. **Citywide context**: §4.1 ranking and the prior-removal case study (§4.5, once cleared — D15).

---

## 10. Checks

- **Parity:** the four filters are byte-identical to the source registries — a validator diffs
  `stops/build/signals.py` against `unhoused/` and `drug/` (same pattern as `validation/parity.mjs`).
- **Join sanity:** share of 311 cases within 25 m of any stop (~14%) and the 0-call check for
  far-side stops (D6) are asserted in `validate_build.py`.
- **GTFS ↔ DataSF:** every DataSF stop must resolve in GTFS or be listed in a `unmatched` block.
- **Overlay:** every TSV row either matches a stop or is in the unmatched list; counts asserted.
- **Playwright:** search → card → log marker renders; a pinned stop shows its basis block.

---

## 11. Open questions

1. **Boardings column** — confirm the "Lift deployments" values are boardings, and their date.
2. **Contractor missed-servicing log** — can SFMTA share per-stop monthly counts? Turns the rank into
   a series and makes the prior removal (and future changes) measurable on the most direct signal.
3. **The 2022 removal** — confirm the date with SFMTA; then it becomes the first logged intervention.
4. **Which changes are actually on the table per stop?** The list's "Request for removals" column is
   binary; the log needs the type. Relocation (moving a stop mid-block) is common at SFMTA and
   reversible-ish — is it being considered?
5. **Mapillary token** — a free developer token is needed; who holds it?
6. **Photo publication** — staff-uploaded stop photos will show public street scenes; same policy as
   the existing intervention photos (`docs/plan-photo-uploads.md`) or stricter?
7. **Static photo instead of the Mapillary embed?** (discussed 2026-09-12) The embed ships viewer
   controls (play/auto-move, "contribute") that distract. A plain JPEG is available via the Graph API's
   `thumb_1024_url` / `thumb_2048_url`, but those URLs are signed and short-lived, so they must be fetched
   at view time with the token. Options: (a) token in the page — Mapillary's client-token model, simple,
   quota-abuse risk only (no billing); (b) **preferred:** a `/mapillary/:id` route on the existing
   Cloudflare Worker holding the token, returning the thumbnail (cache header; fall back to the embed);
   (c) overlay to block the embed's controls — fragile, not worth it. Panoramas flatten badly as
   thumbnails; the resolver already prefers non-pano. Mapillary terms: display, don't store JPEGs.

---

## 12. Staging

1. ✅ **Stage 0 — build pipeline** (`build/01_pull → 02_gtfs → 03_join → 04_rollup`), citywide since
   2023-01 (the shared epoch), `validation/validate_stops.py`.
2. ✅ **Stage 1 — stop card + search + map + concern overlay + citywide context**, `npm run test:stops`.
3. ✅ **Stage 2 — Mapillary** street-level image on the card (D10; resolver + embed built 2026-09-12,
   run once the token is in `.env.local`).
4. ✅ **Stage 3 — regular refresh (D12)** (2026-09-12): `refresh-data.yml` fetches GTFS best-effort, runs
   `01_pull → (02_gtfs) → 03_join → 04_rollup → 05_mapillary`, gates on `validate_stops.py`, adds
   `stops/data/**` to the rolling PR; `refresh_delta.py` reports concern-list totals per signal.
   `03_join` carries committed routes forward when no feed was fetched (page shows "routes as of").
   `deploy.yml` runs the stops validator + e2e and stages `stops/`. **One-time repo setting:** add the
   `MAPILLARY_TOKEN` secret (Settings → Secrets → Actions) or the Mapillary step just skips.
5. **Deprioritised — intervention log** (allowlist extension, save dialog, before/after panels, staff
   photos): pending a team decision on whether stop changes belong in the saved-interventions system.
   **SFMTA data** (boardings confirmation, missed-servicing log, the 2022 removal date): arrival unknown; the
   card keeps its slots.

---

## 13. Changelog

- **2026-09-14** — Per-chart legend (Aaron). Replaced the single shared bottom legend (one slate swatch that
  matched none of the four differently-coloured charts) with a stacked 3-row legend under each sparkline,
  keyed to that signal's own bar colour. Each row now carries its own 12-mo total inline with the unit —
  this stop / neighbours mean / surrounding block — so the neighbours **number** is visibly the blue line.
  Wording de-jargoned: "nearest N unsheltered" → "nearest N stops with no shelter" (was misreadable as
  *unsheltered people* on an encampment card); "surrounding 25–250 m (own scale)" → "surrounding block
  (25–250 m)" (the own-scale/peak caveat still lives on the in-chart strip label, its correct home).
  Methodology paragraph aligned to the same "no shelter" wording. `.cmp-legend` CSS retired; `.sig__leg*`
  added. Tests green.
- **2026-09-12 (later still)** — D15: concern-list details withheld from the repo/page pending permission;
  public-by-default build, `--full` opt-in, private notes moved to `stops/private/`.
- **2026-09-12 (later)** — Weekly refresh wired (Stage 3, D12): workflow steps, GTFS carry-forward,
  Mapillary secret, delta report, deploy gate. Map UX D14 (click tolerance, Streets first, halo, default view).
- **2026-09-12** — Mapillary built (resolver + embed, token in `.env.local`). Priorities reset (Aaron):
  Mapillary first, weekly refresh after sign-off; intervention log and SFMTA data deprioritised.

- **2026-09-11 (later)** — Stage 0 + 1 built. D12 (part of every regular refresh — Aaron), D13 (checkbox
  colouring — Aaron). D6 geometry corrected to what was built (name-match snap, zero-not-null). Epoch
  2023-01 to match the other dashboards.
- **2026-09-11** — Drafted after live validation of DataSF stops, GTFS, 311 (encampment + shelter-
  tagged), 911 (unhoused + drug) and a full join of the 29-stop leadership list. Findings §4.
  D10 set to Mapillary + staff uploads over 311 media (Aaron).
