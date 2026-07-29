# Plan — "Where reports are appearing recently" (recent-activity map)

A **new, separate** map section on `drug` + `unhoused` that answers a different question from the
existing hot/cold map: not *"what changed since Lurie"* but *"where are community reports showing up
**recently**, and at what times of day / days of week."* Operational read (helps direct resources)
framed observationally — **not** as a directive.

Prototype on `drug`, extract the shared mechanics into `shared/`, adopt on `unhoused`. Same
build-first-extract-later path the [scrubber](../drug/plan-scrubber.md) and
[time-of-day](../drug/plan-time-of-day.md) work took. `theft` excluded (no map).

Supersedes the deferred [`plan-hotspots-hourly-map.md`](plan-hotspots-hourly-map.md) **for the
operational use-case** — that doc shelved arbitrary-hour filtering on the *difference-in-differences*
map because honest d-i-d needs 24×months histograms per cell (~256k ints/signal, too heavy for Pages).
This view sidesteps that blocker entirely: it is **absolute + recent**, not **relative + historical**,
so it needs no monthly-by-hour precompute. It goes further — it queries **DataSF live** (§3), so it's
**evergreen** and needs no baked data at all (unlike the rest of the page).

---

## 1. Why this is a separate section, not a filter on the current map (locked)

The existing map is a **difference-in-differences vs a fixed pre-Lurie baseline**
([`shared/classify.js`](shared/classify.js), driven by the chart scrubber). Each dot's color means
*"this block moved relative to its district since Lurie"* — emerged / persistent / cooled. A block
slammed every night but **unchanged** since Lurie correctly reads as "persistent" (muted) — which is
exactly backwards for figuring out where the need is *now*.

| | Existing hot/cold map | This section |
|---|---|---|
| Question | Did the intervention move this block? | Where are reports showing up **now**? |
| Measure | Change vs baseline (d-i-d) | **Absolute** recent intensity |
| Horizon | Lurie → now (long) | Last N weeks (recent, tunable) |
| Encoding | emerged / persistent / cooled (categorical) | density heat (sequential) + a 7×24 rhythm |
| Baseline | fixed pre-Lurie 24-mo | **none** |

Different question → different measure → **its own section with its own title, legend, and color
semantics.** Hard requirement: the density heat must be visually unmistakable from the categorical
emerged/persistent/cooled palette so no one misreads "busy" as "emerged."

## 2. Scope (locked)

**In:** the community-report **point** signals only —
- `drug`: `cfs_drug`
- `unhoused`: `encampment`, `cfs_presence`

**District-scoped (locked).** The tool is presented to **different groups in each district**, so
the shipped view is **always a single district** — the component receives its district from the
embedding district page (no switcher). Citywide is useful for exploration but **does not ship**.
This drops per-view volume to ~100–225 reports / 4wk (Northern 101 / Central 102 / Mission 205 /
Tenderloin 225), which sharpens the encoding + sparsity decisions below.

**Out:** the arrest/enforcement signals (`dealer_arrests`, `paraphernalia`, `other_drug_arrests`).
They're `agg_only` (no raw points to place/time) **and** reading enforcement by time-of-day is
circular — it reflects shift staffing, not need ([[crime-effectiveness-enforcement-reflexivity]],
[time-of-day plan §6](../drug/plan-time-of-day.md)). The cheap scope and the honest scope coincide.

## 3. Data source — **live DataSF (Socrata) query, evergreen** (DECIDED 2026-07-15, user call)

Unlike the rest of the (baked, point-in-time) dashboard, this section queries **DataSF live from the
browser** — the same no-backend/no-key pattern `./hypothesis` already uses ([hypothesis/js/soda.js](hypothesis/js/soda.js)).
This makes it **evergreen** ("where issues are appearing *recently*" is always current) and it fits the
operational purpose better than a baked snapshot.

**Validated live (2026-07-15):** `GET https://data.sfgov.org/resource/2zdj-bwza.json` with the
dashboard's exact `cfs_drug` filter + `received_datetime >= <now-Nd>` + `police_district='TENDERLOIN'`
→ HTTP 200, **173 rows**, newest 2026-07-14 (a day newer than the baked build). Returns everything the
two components need, server-scoped so the payload is only the district+window rows (~hundreds, not MB):

| field | use |
|---|---|
| `intersection_point` (GeoJSON point) | hex map coords |
| `intersection_name` | corner label in the hex drill-down popup |
| `received_datetime` (creation-stamped, **no settle lag**) | recency window **and** hour (→ 7×24 heatmap) + day-of-week |
| `call_type_original_notes` / `call_type_final_notes` | popup detail (why it counts as drug activity) |

**Why this beats baked markers / a baked recent-slice:** evergreen, tiny payload, **server-side
district + recency scoping (no client point-in-polygon)**, no pipeline change, and it reuses the
**exact** baked filter (`signals.py` `_CFS_DRUG_WHERE`) so it's definitionally consistent with the page.

**Query construction (reuse `soda.js` shape):**
- **Date anchoring — anchor to the DATA, not the client clock (decided).** Two-step per load:
  1. `$select=max(received_datetime)` with the same filter + district → `anchor`.
  2. Window = `[anchor − N weeks, anchor]`; fetch `received_datetime >= '<anchor-Nweeks>'`.
  Rationale: `received_datetime` is **naive Pacific local** (no tz offset), so a client-clock cutoff
  would drift with the visitor's timezone/wrong clock; and if DataSF lags a few days, a "from today"
  window silently goes partly-empty. Anchoring to the dataset's own latest record avoids both and
  matches the dashboard's existing `latest_complete`/`latest_settled` honesty ([[civic-timeseries-baselines-2020]]).
  The section note states the real anchor it's showing ("through Jul 14"), not an implicit "today."
- `$select` (window fetch): the five fields above (optionally `date_extract_hh(received_datetime) AS hh`).
- `$where`: `_CFS_DRUG_WHERE` **AND** `received_datetime >= '<anchor − N weeks>'` **AND** `police_district='<ACTIVE>'`.
- `$order received_datetime DESC`, `$limit` well above the window (173/28d ⇒ 8w citywide still far under `soda.js` `ROW_CAP=5000`).
- Districts are UPPERCASE in this dataset (`TENDERLOIN`, `MISSION`, `NORTHERN`, `CENTRAL`).

**Caveats to bake in (methodology / section note):**
- **Live, so newer than the rest of the page** — the baked hot/cold map + cards are a validated
  point-in-time snapshot; this section is current-to-yesterday. State it (it's the point).
- **Reliability:** a live request can fail — ship a skeleton/loading state and a graceful
  "couldn't reach DataSF" fallback (throw-on-`!res.ok`, like `soda.js`).
- **District scoping — match the dashboard's geometry (DECIDED 2026-07-15).** The source's native
  `police_district` is ~20% off the dashboard (measured: Tenderloin native 180 vs baked PIP 225) —
  the build deliberately ignores that field and assigns by point-in-polygon, so this section must too,
  or it silently disagrees with the hot/cold map. **Method: `within_box(intersection_point, …)`
  bounding-box fetch + client-side point-in-polygon** against the already-loaded
  `police_districts.geojson` (the same boundary the map draws — `app.js:487`). Measured exact and
  universal (Central 242 fetched → 109 kept, matches baked ~102).
  - Rejected: server-side `within_polygon(WKT)` — exact for Tenderloin (47 pts, 236 ✓) but **HTTP 414**
    for Central (703 pts → ~32 KB URL). Not universal; not worth a small-district fast-path.
  - Over-fetch is ~2× (hundreds of tiny rows), PIP is a ~15-line ray-cast (reuse the build's
    `point_in_ring` / `02_assign.py`). Handle multipolygon + holes.
- **Rate limits:** works with no app token now; add a public (non-secret) Socrata `app_token` if
  traffic warrants. No secret handling ([[public-github-pages-no-security]]).
- **unhoused signals** (`encampment` 2zdj-.../vw6y-z8j6, `cfs_presence`) get the same treatment in
  Phase 2 with their own datasets/filters from `unhoused/build/signals.py` + provenance.

## 4. The three components

### 4a. Recency selector (the "how far back" knob)
Segmented chips: **`Last 1w · 2w · 4w · 8w`**, default **4w**. Controls how many trailing weeks feed
**both** the heatmap and the map. One control, not a range slider — deployment cares about "recent,"
and a single depth knob is far clearer than a dual-ended date brush.

Why not literal last-week-only (the original instinct): at block resolution one week is too sparse to
read. Measured volumes: `cfs_drug` **127 reports last 7d** vs a 7×24 = 168-cell rhythm grid (**<1
report/cell** — pure noise); `encampment` 863/7d (~5/cell, still thin). Aggregating ~4 weeks into a
**typical week** is both less noisy and more actionable (outreach is usually a *recurring* schedule —
"a Tuesday-morning team"). `Last 1w` stays available as the tightest setting, footnoted as noisy.

### 4b. Hour-of-day bars  (the "when" view + the filter) — DECIDED 2026-07-15
**Collapsed from the original 7×24 heatmap to a 24-bar hour-of-day strip.** Measured on live
Tenderloin data: **day-of-week is a weak signal** (Tue 34 vs Sat 17 — a ~2× gentle weekday>weekend
gradient) and at a single district's 4-week volume a 7×24 grid is ~1 report/cell (noise), whereas
**hour-of-day is a clean ~15× dawn-to-dusk signal** (≈0 overnight, ramp at 6–7a, sustained 7a–6p,
peak ~1p, tail after 7p). Collapsing removes noise, is more robust (~9/bucket), is the actionable
"when to deploy" dimension, and takes far less vertical space (user ask). Weekday/weekend × hour was
offered as a middle ground and declined.

- A single row of 24 bars; **height + teal fill both encode volume** (redundant encoding aids a11y).
- **Doubles as the map filter:** click a bar to toggle an hour, or **press-and-drag across bars** to
  select an hour range → map redraws to just those hours. Default = all hours. "Show all hours" reset.
- Axis labels at 12a / 6a / 12p / 6p / 11p. (If a district ever shows a real weekend split, a
  weekday/weekend toggle is the documented next step — not day-of-week rows.)
- Section order (user ask): **map first (Where), then hours (When)**.

### 4c. Density map — absolute recent intensity (the *where*)
A Leaflet layer over the same base map, showing **absolute report density** for the
recency-window × brushed-heatmap-cells selection.

**Encoding: hexbin with clickable corner drill-down (DECIDED 2026-07-15, user call).** Prototyped
both graduated dots and hexbin on real per-district 4-week `cfs_drug` data
(`/tmp/recent-activity-proto/`, reviewed 2026-07-15) with a shared **teal** sequential ramp
(validated monotonic-L; deliberately distinct from the categorical persistent=red / emerged=amber /
cooled=blue). Findings:

| | Graduated dots | **Hexbin (chosen)** |
|---|---|---|
| Concentrated district (Tenderloin, 36 locations) | crisp hot corners | **clean, reads as one system** |
| Diffuse district (Northern, 62 singleton locations) | faint scatter (stroke-rescued singletons) | **legible area density** |
| Visual quality (user preference) | busy | **clearly preferred** |
| "Which corner to send a team" | real node | **recovered via click-drill-down (below)** |
| Zoom stability | stable | bins re-form on zoom (acceptable; see risks) |

The dots' one advantage — a real, inspectable corner — is recovered by two choices:
- **Smaller hex cells** (`HEXR ≈ 13px`): at this size most hexes contain only 1–2 snapped corners, so
  a hex ≈ a corner anyway, but the surface still reads as a clean density system.
- **Click a hex → popup** listing the specific corners inside it and their counts (a
  `corner · reports` table, sorted desc). Verified in the prototype: the busiest Tenderloin hex opens
  "29 reports · 1 location · Ellis St / Leavenworth St — 29." This makes the hex actionable *and*
  keeps the aesthetic.

**Decision: hexbin**, small cells, clickable drill-down, sequential teal ramp, dark-mode inverts
(bright = high), hairline surface-colored hex stroke for separation. Never the
emerged/persistent/cooled colors.
- Fill by count-break on the teal ramp; hover tooltip = hex total; click = corner breakdown popup
  (reuse marker detail — address/type/status — in the per-corner rows).
- Small-count gate on the ramp's lightest step lets near-empty hexes recede (satisfies the WCAG seam
  §8 #1: meaningful hexes use higher-contrast steps; the drill-down popup + fast-follow list are the
  text alternative + keyboard path).
- Nice-to-have companion: a "top blocks in this window" ranked list beside the map (accessible,
  non-map read; **fast-follow** per user).

## 5. Interaction model (locked)

```
[ recency: 1w · 2w · 4w · 8w ]  ──feeds──▶  ┌─ 7×24 rhythm heatmap ─┐
                                            │  (brush day×hour cells) │
                                            └───────────┬─────────────┘
                                                        │ selection
                                                        ▼
                                       [ density map: absolute intensity,
                                         recency-window ∩ brushed cells ]
```
- Recency knob → recomputes heatmap averages **and** the map.
- Heatmap brush → filters **only** the map (+ the top-blocks list). Default all-selected.
- This section's controls are **independent** of the page-level Day/Night toggle and the chart
  scrubber — those drive the *accountability* map; leave them untouched here to avoid two conflicting
  time models on one page. State this in the section's note.

## 6. Placement / IA

New `<wa-card class="panel">`, inserted **after** the hot/cold map panel and **before** the
composition/hsoc panel:

```
cards → citywide → chart(scrubber) → HOT/COLD map → ★ recent-activity map → composition|hsoc → methodology
```
- `drug`: after [`drug/index.html:131`](drug/index.html) map panel, before the composition panel.
- `unhoused`: after the hot/cold map panel, before the `hsoc-block`.

Panel title (softer, observational — user steer): **"Where reports are appearing recently"** with a
subtitle covering the *when* (e.g. "…and at what times of day"). Tunable. Deployment intent stays
implicit; no directive language ("deploy," "send teams"), consistent with the dashboards' neutral tone.

## 7. Honesty caveats (bake into the section note / methodology)

- **Community reports = demand-for-service, not verified incidence.** These are 311/CFS calls; volume
  reflects who reports, not a confirmed count. Say so.
- **Node-snapping** ([[cfs-node-snapping-attribution]]): calls snap to the nearest named node, so a
  between-node hotspot (e.g. 16th & Mission) can land on an adjacent alley. The dot is approximate.
- **Recency window is stated explicitly**, and the current partial week is flagged (mirrors the
  partial-month convention, [[civic-timeseries-baselines-2020]]).
- **Small-count gate** disclosed; `Last 1w` footnoted as noisy.
- **Arrests deliberately excluded** and why (reflexivity) — one line.

## 8. Encoding / palette — governed by the `dataviz` skill

Before writing any heatmap/map color or legend: invoke **`dataviz`**. Requirements it must satisfy:
- Heatmap: **sequential** ramp, legible in light + dark, WCAG AA, with a value legend.
- Map density: sequential, **categorically distinct** from emerged/persistent/cooled.
- Consistent stat-tile/legend system with the rest of the dashboard constellation
  ([[sf-civic-dashboard-constellation]], [[dashboard-source-provenance-footnotes]]).
Accessibility (keyboard-operable brush, non-color encoding of the heatmap value, the top-blocks list
as a non-map read) per the `web-dev` baseline.

## 9. Sequencing

- **Phase 0 — drug section. ✅ BUILT + VERIFIED (2026-07-15).** [`drug/js/recent-activity.js`](drug/js/recent-activity.js)
  + panel in [`drug/index.html`](drug/index.html) + CSS + lazy-init wiring in [`drug/js/app.js`](drug/js/app.js).
  Live DataSF query (anchor to `max(received_datetime)` → trailing window; `within_box` + client-PIP to
  the active district; reuses `_CFS_DRUG_WHERE`). Verified headless: Tenderloin **226 reports** (matches
  baked PIP ~225 → PIP reproduces the dashboard's district exactly); 7×24 heatmap renders + brushes;
  recency chips (4wk 226 → 8wk 447); clickable hex drill-down popup with corner names; dark-mode ramp
  inversion + tile swap via `themechange`; graceful failure state (body hidden, friendly message);
  **0 console errors**.
  - **Polish complete (2026-07-15):** map-first then hours (order swap); 7×24 heatmap → compact
    **hour-of-day bars** (day-of-week dropped, §4b); **drag-brush** an hour range; **single-hue** bars
    (height alone encodes volume — dropped the confusing light→dark ramp on the bars; the hex map keeps
    the sequential ramp, correct for a density surface); methodology footnote added; **stubbed e2e**
    (render+chips+brush, hex popup, failure) — full drug suite **9/9 green**. **Awaiting user review before commit.**
- **Phase 1 — extract to `shared/`.** Pull the recency/heatmap/density-map mechanics into a new
  `shared/recent-activity.js` (mirror `transition-map.js` structure); `app.js` stays per-dashboard.
- **Phase 2 — adopt on `unhoused`.** Wire `encampment` + `cfs_presence`; signal picker within the
  section if >1 signal. Verify volumes read well (encampment dense; cfs_presence check).
- **Phase 3 — polish + caveats + docs.** Methodology copy; partial-week + node-snapping footnotes;
  payload/CWV measurement + mitigation finalized.

## 10. Validation

- **No build change** → `validation/parity.mjs` + `validation/trace.py` stay green unchanged (this
  view doesn't touch baked totals or classification). Confirm they still pass (regression guard).
- **New e2e** (per-dashboard, mirrors existing suites): with the live query **mocked/stubbed** (fixed
  fixture, no network on the CI path — like the offline hop-② convention), assert the section renders;
  recency chips switch; heatmap brush filters the map; reset; **0 console errors**; skeleton→loaded;
  and the **failure state** shows when the stub returns an error.
- **Data-source integrity is inherent** — the view IS the source query (reuses `_CFS_DRUG_WHERE`), so
  there's no baked intermediary to drift. Optional **nightly canary** (like `trace.py` hop-①): run the
  live query and assert it returns ≥0 rows / HTTP 200 for each district, off the PR critical path.
- **Client-PIP correctness:** unit-test the ray-cast against known in/out points + a hole; assert the
  bbox∩PIP kept-count reconciles to a `within_polygon` count for a **small** district (Tenderloin) as
  an oracle (big districts 414, so oracle only where the URL fits).

## 11. Open questions

1. **Payload/CWV mitigation** — is lazy-load-on-scroll + cache-reuse enough, or do we want a slimmer
   markers variant (drop detail fields for this view)? Measure first.
2. **Signal picker in-section** (unhoused has 2) — chips vs a select; default signal?

### Resolved
- **Density encoding** → **hexbin, small cells, clickable corner drill-down** (prototyped vs graduated dots on real per-district data, 2026-07-15; user preference + drill-down recovers the "which corner" need). *(§4c)*
- **District scope** → single district from embedding page, no switcher; citywide exploration-only, not shipped. *(§2)*
- **Top-blocks list** → **fast-follow**, not Phase 0. *(§4c, user)*
- **Heatmap cell metric** → avg reports/week (comparable across recency windows). *(§4b)*
