# Plan — District Encampment Dashboard

**Working title:** "SF Encampment Reports by District — trends over time"
**Owner:** Aaron · **Drafted:** 2026-06-11
**Status:** 🟡 Planning — ready for implementation review.

> Living document. Keep it current as we build (see Changelog, §12).

---

## 1. Goal

Give city leaders a simple, honest read on **how community-reported encampment activity is
changing over time across four police districts** — **Central, Northern, Mission, Tenderloin** —
with **citywide totals as the comparison baseline**.

We roll raw 311 reports up into district- and city-level measures, frame every number against
**seasonality and longer trends** (so a summer peak isn't mistaken for a regression), and show the
reports on a **map (heatmap for clusters + individual dots for the underlying reports)**.

Encampment is the **first and primary** signal. The app is built as a **multi-signal registry**, so
several closely-related signals are each viewable **individually** (not pre-combined) — see §6.

**Companion projects this builds on:**
- **Root app** (`../`, the "Does the data support my hypothesis?" tool) — design language, tech
  stack, Socrata patterns, SVG chart, dark mode, methodology-footnote norm. We reuse its *look* and
  its data-layer conventions. See `../PLAN.md`.
- **`../../emergent-map`** — prior data work on exactly this domain. We reuse its **build-pipeline
  pattern**, its **police-district boundaries** (`data/sidecar/police_districts.geojson`, dataset
  `qgnn-b9vv`) and **point-in-polygon** assignment (`build/03_aggregate_311.py`), its
  **block canonicalization**, and its **schema-migration / data-gotcha catalog** (`SPECIFICATION.md`).

---

## 2. Guiding principles (from the brief)

1. **Roll raw data up** so leaders grasp it fast — district + citywide measures, not raw rows.
2. **Account for history, seasonality, and larger trends** — never present a narrow snapshot. The
   data is visibly seasonal (see §3), so seasonal framing is a first-class feature, not a caveat.
3. **Keep the UI as simple as possible** — charts and a map that are *revelatory but not
   overwhelming*. Default to one signal, four districts, one clear trend read; depth on demand.

---

## 3. Data reality check (verified live, 2026-06-11)

### 3.1 The core finding: a June-2025 reporting reroute we MUST union across

The dedicated 311 **Encampment** category (`service_name IN ('Encampment','Encampments')`) was
**largely retired in June 2025** and folded into a broader homelessness service-request category
(`service_name='General Request'` + `service_subtype='homelessness_and_supportive_housing'`,
~89% the detail `housing_homeless request_for_service`). Querying only the old category **undercounts
by ~2,000–2,600/mo post-June-2025 and masquerades as a decline.** Verified live:

**Encampment-only vs. the rerouted stream, citywide (`vw6y-z8j6`):**

| Month | Encampment-only | Rerouted (`General Request`/homeless) | **Union** |
|---|---|---|---|
| May 2025 | 4,407 | ~98 | 4,505 |
| Jun 2025 | 4,095 | **470** ← ramp begins | 4,565 |
| Aug 2025 | **3,164** | **2,586** | **5,750** |
| Oct 2025 | 3,004 | 2,081 | 5,085 |
| May 2026 | 3,489 | 2,978 | 6,467 |

The rerouted stream was **negligible before June 2025** (~30–100/mo) and is now ~2,000–3,000/mo.

**Why this is decisive — seasonality exposes the artifact.** Summer is peak encampment season, yet
the *encampment-only* series **fell** May→Aug 2025 (4,407 → 3,164) — the opposite of 2024
(3,632 → 5,115, rising). Unioning the rerouted stream **restores the expected seasonal shape**:
Aug 2025 union = **5,750**, right in line with Aug 2024's **5,187**. So the apparent 2025–26
"decline" is **mostly a reporting reroute, not fewer encampments.** A dashboard built on the naive
filter would show districts "improving" when nothing changed on the ground — the same false-success
trap the root app fights (`overflow`/Nordsense, root `PLAN.md` §8.5).

**This corrects an earlier draft of this section** that called the signal "continuous." It isn't —
emergent-map's `SPECIFICATION.md` §3.3 warning was right; the live data confirms it.

### 3.2 Findings that shape the design

- **Core signal = the union** (D12). `Encampment` OR `General Request`+homeless subtype, deduped by
  `service_request_id`, with a **2025-06 break annotation** (the categories aren't perfectly
  equivalent — old = tent/structure sightings; new = broader homelessness service requests). Labeled
  **"Encampment & homelessness reports,"** not pure tent counts. The rerouted records are **99.7%
  geocoded** (23,516 / 23,592 since Aug 2025) → fine for district assignment and the map.
- **Seasonality is real and large** (~1.6–1.7× summer-vs-winter on the union) → YoY/same-season
  framing is the honest default (§7). A raw month-over-month read would call every spring "worsening."
- **The union trend is roughly flat-to-rising into 2026**, not declining — the deseasonalized
  trailing-12-mo line (§7) is what tells the real "larger trend," and it differs sharply from the
  naive filter's false decline.
- **Volume is high** (union ≈ 5,000–6,500/mo citywide) → the map needs a default window + heatmap +
  point-thinning, not tens of thousands of raw dots (§8, §9).

---

## 4. Decisions locked

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Pre-baked static JSON via a small Python build** (emergent-map style), not live browser queries. | Multi-year citywide point data is heavy; point-in-polygon + seasonal baselines are computed **once** at build time → instant loads, full control over rollups. Refresh = rerun build + commit JSON. |
| D2 | **Static frontend, same stack as the root app** — Web Awesome 3.7.0 + Leaflet 1.9.4 + hand-rolled SVG charts, plain CSS reusing root token values. **No build step for the frontend, no framework.** | Consistency with the root app; lean, dependency-free, GitHub-Pages-friendly. |
| D3 | **District assignment by point-in-polygon** against `police_districts.geojson` (dataset `qgnn-b9vv`), reusing emergent-map's ray-casting (`build/03_aggregate_311.py`). 311 has **no reliable server-side police-district field**. | Established, verified method already in the sibling repo; we keep the 4 target districts + an "all SF" citywide aggregate. |
| D4 | **Multi-signal registry; signals viewed *individually*, never pre-combined.** Encampment is the default. | The brief wants to inspect each related signal's own result, not a blended index. One signal selected at a time drives cards + chart + map. |
| D5 | **Seasonally-aware headline** = current vs **same-season prior year (YoY)** + a **trailing-12-mo trend** line. | Matches the visible seasonality (§3); avoids the narrow-snapshot trap (principle 2). |
| D6 | **Citywide total is a permanent comparison baseline** on every KPI and chart (district share of city; district trend vs city trend). | The user's ask; also a lightweight control for citywide secular trends (a local drop that just tracks the city tide isn't a local win — root `PLAN.md` §12.2). |
| D7 | **Map = heatmap (clusters) + toggle to individual dots (popups), with a time-window scrubber.** Default window = recent N months; expandable. District boundaries drawn as overlays. | "See clusters but still have individual reports" (brief). Default window keeps the map fast and legible given volume (§3). |
| D8 | **Data decoupled from rendering** (root `PLAN.md` D5). Build emits plain JSON; charts/map/cards are pure consumers. Adding a signal = a registry entry + a build filter. | Localizes change; mirrors the root app's registry discipline (D9 there). |
| D9 | **Aggregates and points are separate payloads.** A small always-loaded aggregate JSON (monthly counts per district + citywide, per signal) + **per-signal point files lazy-loaded** on selection, as compact `[lat,lng,dayIndex]` tuples with rounded coords. | Keeps first paint tiny; only the active signal's points download. Controls the size problem from §3. |
| D10 | **Normalize the 2024-06-13 taxonomy migration** in every 311 filter via `lower(...) LIKE` (root `PLAN.md` D10) and union both `service_name` spellings. | Otherwise sub-signals (waste, needles) show a fake cliff on that date. |
| D11 | **Lives in `/districts/`**, deployed to GitHub Pages alongside the root app; the build's output JSON is **committed** (like emergent-map's `pivot.json`). | Same hosting as the root app; reproducible, no server. |
| D12 | **The core encampment signal is the UNION** of `service_name IN ('Encampment','Encampments')` **OR** (`service_name='General Request' AND lower(service_subtype) LIKE '%homeless%'`), deduped by `service_request_id`, carrying a **2025-06 break annotation**. Labeled "Encampment & homelessness reports." | Verified live (§3): SF retired the dedicated Encampment category in June 2025: the naive filter undercounts ~2,000–2,600/mo afterward and fakes a decline. The union restores a seasonally-consistent series (Aug 2025 union 5,750 ≈ Aug 2024 5,187). |
| D13 | **Vet each candidate homeless signal by HSOC-routing share; keep clean ones, drop noisy/redundant ones.** Kept Sit/Lie (~87%) and Homeless Complaint (~84%); **dropped Blocked Sidewalk (~50%)**; never added Trespasser (~6%). Added `encampment_only` (the dedicated category on its own). HSOC stays as a clearly-labeled context signal, flagged as overlapping the others (~75% redundant). | §6.1 (verified live 2026-06-11): HSOC routing is the cleanest homeless-relatedness proxy since dispatcher notes are ~6% populated. Blocked Sidewalk's homeless half already lives in HSOC and its other half is non-homeless obstructions, so it's redundant + noisy. |
| D14 | **Global time window drives cards + chart + map together (full sync); a Play button slides it monthly.** Cards total the window and compare to the same window a year earlier; the chart shades the active window; the map filters to it. | User request (2026-06-11): "everything should be synced always unless we start getting performance issues." Lets users scrub/animate a single coherent time machine. |

---

## 5. Architecture & tech stack

```
build/ (Python, run locally; output committed)
  01_pull.py        ← fetch each signal's full-history point records from Socrata (paged)
  02_assign.py      ← point-in-polygon → police district (qgnn-b9vv boundaries); keep 4 + cityid
  03_rollup.py      ← monthly counts per (signal, district) + citywide; YoY + trailing-12mo + rolling avg
  provenance.json   ← dataset ids, exact queries, pull timestamp, row counts, the reroute check (§3)
        │ writes
        ▼
districts/data/
  aggregates.json         ← small: per signal → per district & citywide monthly series + precomputed trend
  points/<signal>.json    ← compact [lat,lng,dayIndex] tuples, per signal, lazy-loaded
  police_districts.geojson← the 4 target district polygons (copied from emergent-map sidecar)

districts/ (static frontend — same stack as root app, no build)
  index.html        ← Web Awesome + Leaflet + Leaflet.heat (CDN) + ES modules
  styles.css        ← reuse root token values (--c-blue, --font-sans, …); plain CSS
  js/
    signals.js      ← REGISTRY: signal metadata (label, description, filterDesc, caveats) [D4/D8]
    data.js         ← load aggregates.json; lazy-load points/<signal>.json
    rollup.js       ← KPI math consumed by cards (YoY %, trend dir, district-vs-city share) [pure]
    chart.js        ← hand-rolled SVG: monthly series + prior-year ghost overlay + citywide line [render]
    map.js          ← Leaflet: district overlays + heatmap layer + dot layer + time scrubber [render]
    app.js          ← orchestration: signal select → cards + chart + map; window scrubber; share-URL
  tests/e2e.spec.js ← Playwright structural e2e (loads JSON, renders cards/chart/map, signal switch)
```

- **Heatmap:** `Leaflet.heat` (CDN plugin) for the cluster view; toggle to `circleMarker` dots with
  popups (date + place + detail), reusing the root app's `renderEvents` popup pattern.
- **Dark mode:** reuse the root app's `<head>` `prefers-color-scheme` script + CARTO light/dark tile
  swap verbatim.
- **Deploy:** add `districts/` to the existing GitHub Pages workflow (fully static; CDN libs).

---

## 6. Signals (registry — each viewed individually, D4)

All are **community-reported**. Each is a registry entry with a label, user-facing description, the
exact filter (`filterDesc`), and its own caveats. **Default = Encampment.** Per the brief we pull and
display each result on its own; **no combined index in v1.**

| Key | Label | Dataset | Filter (normalized for the 2024-06-13 migration, D10) | Quality / caveat |
|---|---|---|---|---|
| `encampment` | **Encampment & homelessness reports** (core) | 311 `vw6y-z8j6` | `service_name IN ('Encampment','Encampments') OR (service_name='General Request' AND lower(service_subtype) LIKE '%homeless%')`, deduped by `service_request_id` (D12) | The headline. **Union across the June-2025 reroute** (§3): the old dedicated Encampment category was folded into a homelessness service-request category mid-2025; querying only the old name fakes a ~2,000–2,600/mo decline. Carries a **2025-06 break marker**; pre = tent/structure sightings, post = broader homelessness requests (not perfectly equivalent — see caveat 7). |
| `encampment_only` | Encampment category only (311) | 311 `vw6y-z8j6` | `service_name IN ('Encampment','Encampments')` | **Added 2026-06-11.** The dedicated Encampment category *on its own* — a component of the union above, so leaders can see it individually. **Shows the June-2025 cliff** (the reroute) with a break marker + caveat explaining the drop is a reporting change, not fewer encampments. |
| `waste` | Human/animal waste & urine | 311 `vw6y-z8j6` | `service_name='Street and Sidewalk Cleaning' AND (lower(service_details) LIKE '%human%' OR '%urine%' OR '%fece%')` | Co-located proxy for unhoused presence/intensity. Bundles feces w/ urine/animal (root `PLAN.md` §7). |
| `needles` | Needles / syringes | 311 `vw6y-z8j6` | `service_name='Street and Sidewalk Cleaning' AND (lower(service_details) LIKE '%needle%' OR '%syringe%')` | Subject to a **citywide secular decline** (root `PLAN.md` §12.2) — citywide baseline (D6) makes that visible. |
| `cfs_sitlie` | 911 Sit/Lie Enforcement | SFPD CFS `2zdj-bwza` | `call_type_final_desc='SIT/LIE ENFORCEMENT' AND onview_flag IN ('N','HSOC') AND dup_cad_number IS NULL` | Cross-system unhoused-presence signal; geo via `intersection_point`. **~87% HSOC-routed** → strongly homeless (§6.1). |
| `cfs_homeless` | 911 Homeless Complaint | SFPD CFS `2zdj-bwza` | `call_type_final_desc='HOMELESS COMPLAINT' AND onview_flag IN ('N','HSOC') AND dup_cad_number IS NULL` | Direct community homeless-presence call. **~84% HSOC-routed** (§6.1). |
| ~~`cfs_blocked`~~ **DROPPED** | ~~911 Blocked Sidewalk~~ | SFPD CFS `2zdj-bwza` | ~~`call_type_final_desc='BLOCKED SIDEWALK' …`~~ | **Dropped 2026-06-11** (§6.1): only **~50% HSOC-routed** (half are non-homeless obstructions — construction/vehicles/vendors), and that homeless-routed half is already inside the HSOC signal. Too noisy to keep as a standalone homeless signal. |
| `hsoc` *(context only)* | HSOC outreach response (city action) | SFPD CFS `2zdj-bwza` | `onview_flag='HSOC' AND dup_cad_number IS NULL` (city-response routing) | **Caveat-heavy** — a *response/program-growth* indicator, not need (root `PLAN.md` §12.6). **Overlaps the other 911 signals**: ~75% of it is the HSOC-routed portion of Sit/Lie + Homeless Complaint (+ the dropped Blocked Sidewalk); the rest is Trespasser + Meet-w/City-Employee, not surfaced separately (§6.1). Never sum it with the others. |

> The `cfs_*` call types are listed **separately** (not as the root app's `homeless_presence`
> aggregate) precisely so each can be read on its own (D4). A "show as combined unhoused-presence"
> toggle is a candidate for later, explicitly off by default.
>
> **`waste`/`needles` are co-located proxies, not encampment counts** — surfaced as separate signals
> with that framing in their description, never silently merged into the encampment number.

### 6.1 Signal-quality research (verified live, 2026-06-11)

What fraction of each SFPD CFS call type is routed to Healthy Streets (HSOC) — the cleanest available
proxy for "is this call handled as homeless?" (dispatcher notes are too sparse, ~6% of calls, to use):

| Call type | HSOC-routed (of community-reported N+HSOC) | Verdict |
|---|---|---|
| Sit/Lie Enforcement | ~87% | strongly homeless — keep |
| Homeless Complaint | ~84% (also homeless by definition) | strongly homeless — keep |
| **Blocked Sidewalk** | **~50%** | **moderate/noisy — DROPPED** |
| Trespasser | ~6% | not homeless — never added (matches root `PLAN.md` §8.2) |

**HSOC overlap (the reason Blocked Sidewalk is redundant):** the `hsoc` signal is `onview_flag='HSOC'`
across *all* call types, so it re-includes the HSOC-routed slice of the others. Of its 52,933 calls:
Sit/Lie 22,218 (42%), Homeless Complaint 13,862 (26%), **Blocked Sidewalk 3,813 (7%)**, Trespasser
3,671 (7%), Meet-w/City-Employee 4,547 (9%), other ~9%. So **~75% of HSOC duplicates the other CFS
signals** — it's a cross-cutting *response* lens, not an additive signal. **Decision:** drop
`cfs_blocked` (its homeless half lives in HSOC; its other half is non-homeless noise); keep HSOC as a
clearly-labeled, overlap-flagged context signal.

---

## 7. Rollup & seasonality (the analytic core)

Computed at **build time** (`03_rollup.py`), consumed by `rollup.js`/`chart.js`:

- **Per (signal, district) and citywide:** monthly counts, full history (2023-01 → latest complete
  month). The **current partial month is flagged** and excluded from headline comparisons (§3 shows
  why — Jun 2026 would read as a 60% crash).
- **Headline KPI per district card (D5):**
  - Latest complete month's count.
  - **YoY (same-season):** vs the same month one year prior, as a % (e.g. "▼ 8% vs Jun 2025").
  - **Trailing-12-mo trend:** direction + magnitude of the 12-mo rolling average (the "larger trend"
    that strips seasonality entirely).
- **Citywide comparison (D6) on every card + chart:**
  - District's **share of citywide** this month (e.g. "Tenderloin = 14% of SF encampment reports").
  - **District trend vs citywide trend** — is this district improving *faster or slower than the
    city overall*? (a lightweight difference-in-differences read; flags local change that's really
    just the citywide tide, root `PLAN.md` §12.2).
- **Chart:** monthly bars/line for the selected district with a **prior-year ghost overlay** (the
  seasonal comparison made visual) and a **citywide line** (scaled or on a secondary axis) for
  context. Optional **trailing-12-mo rolling-average** line toggle.

**Layout intent:** five rollup cards (Central · Northern · Mission · Tenderloin · **Citywide**), then
one trend chart driven by the selected district, then the map. Simple, scannable, depth on demand.

---

## 8. Map (D7)

- **Leaflet + CARTO tiles** (light/dark per OS), reusing the root app's tile setup.
- **District boundaries** for the 4 districts drawn as labeled polygon overlays (from the geojson).
- **Heatmap layer** (`Leaflet.heat`) — the default; clusters jump out immediately.
- **Individual-dots toggle** — `circleMarker` per report with a popup (date + address + detail),
  reusing the root app's `renderEvents` popup format. **Point-thinning / a count cap** when a window
  is dense (root `PLAN.md` §10 "marker clustering" note) so the dot view stays usable.
- **Time-window scrubber** — a date-range slider (reusing the root app's range-slider pattern) that
  re-filters both heatmap and dots; **default = recent N months** (proposed 6) to keep first paint
  fast, expandable to full history.
- Points are the lazy-loaded `points/<signal>.json` tuples (D9), decoded to `{lat,lng,day}`.

---

## 9. Data-size strategy (D9)

- **`aggregates.json`** (always loaded): just monthly integers per (signal × {4 districts + city}).
  Tiny (kilobytes) even with all signals.
- **`points/<signal>.json`** (lazy, on signal select): compact `[lat, lng, dayIndex]` tuples, coords
  rounded to 5 decimals, restricted to the 4 districts. `dayIndex` = days since an epoch in the
  manifest. Estimate for encampment in-district ≈ tens of thousands of points → a few hundred KB
  gzipped; only the active signal downloads.
- If any single signal's point file is still too large, fall back to emergent-map's **100-block
  canonicalization** for the heatmap (weighted points) while keeping raw dots for the recent window.

---

## 10. Stages

- **Stage 0 — Data pipeline.** `01_pull` → `02_assign` (point-in-polygon, reuse emergent-map) →
  `03_rollup` (monthly + YoY + trailing-12mo) → emit `aggregates.json` + `points/encampment.json` +
  `provenance.json`. Encampment uses the **union filter (D12)** from the start; record the
  encampment-only vs. union vs. rerouted-stream monthly series in `provenance.json` so the break is
  auditable. *Encampment only to start.*
- **Stage 1 — Rollup view.** Five cards (4 districts + citywide), seasonally-aware KPIs (D5/D6), and
  the trend chart with prior-year ghost + citywide overlay. Encampment only. **This is the MVP.**
- **Stage 2 — Map.** District overlays + heatmap + dot toggle + time scrubber (D7/D8).
- **Stage 3 — Multi-signal.** Add `waste`, `needles`, the three `cfs_*`, and `hsoc` to the build +
  registry; signal selector switches cards/chart/map. Each vetted and described individually (D4).
- **Stage 4 — Polish.** Methodology footnote (per-signal filter + live query links + caveats +
  build/provenance date), dark mode, **share-via-URL** (signal + district + window, mirroring root
  `PLAN.md` §8.4), Playwright e2e.

---

## 11. Methodology caveats (carry into every stage)

Inherited from the root app's catalog (`../PLAN.md` §12), with seasonality promoted to first-class:

1. **Seasonality** — encampment reports swing ~1.7× summer-vs-winter (§3). Always compare
   same-season / show the deseasonalized trend; never headline a raw month-over-month delta.
2. **Citywide secular trends** — a district drop may just track the city (esp. `needles`). The
   citywide baseline (D6) and district-vs-city trend make this visible.
3. **Reporting bias** — reports measure *observation/reporting rate*, not ground truth; visibility,
   outreach campaigns, and 311 UX changes move counts.
4. **Displacement / balloon effect** — removal scatters people into nearby blocks and other call
   types; encampment counts alone undercount unhoused presence (DPW notes, root `PLAN.md` §2). The
   separate `cfs_*` signals (D4) let leaders see displacement instead of hiding it in one index.
5. **Taxonomy migration (2024-06-13)** — normalized via `lower(...) LIKE` + dual `service_name`
   spellings (D10).
6. **Program-growth artifacts** — `hsoc` reflects Healthy Streets *scaling*, not need; flagged as a
   response signal and shown apart (§6).
7. **Provenance / reporting breaks** — vet each signal as human- vs machine-reported, and for
   category reroutes. **Encampment has a confirmed June-2025 reroute** (§3, D12): SF retired the
   dedicated Encampment 311 category and folded it into a homelessness service-request category. We
   union across it, but the pre/post categories aren't perfectly equivalent (old = tent/structure
   sightings; new = broader homelessness requests) — surfaced via a chart break marker at 2025-06 and
   a note, never silently spliced. All signals are resident-reported (no Nordsense-style sensor feeds).
8. **Partial current month** — excluded from headline comparisons; flagged on the chart.

Framing everywhere: **observational, not causal.**

---

## 12. Open questions

- ~~**Map default window**~~ **Resolved 2026-06-11:** last **6 complete months** (D14).
- **Refresh cadence** — pre-baked JSON goes stale; currently **manual rebuild**. A scheduled GitHub
  Action that commits fresh JSON is a noted later option.
- ~~**`cfs_*` "combine" toggle**~~ **Resolved 2026-06-11:** signals stay separate (D4); Blocked Sidewalk
  dropped (§6.1, D13); no combined view. An HSOC-only "homeless-routed" variant of a CFS signal remains
  an option if a purer cut is wanted later.
- ~~**Citywide on the chart**~~ **Resolved:** scaled overlay line (shape comparison), toggle off by default.
- **Block canonicalization for the map** — only if a signal's point file proves too large (§9). `waste`
  is the largest at ~2.6 MB (~600 KB gzipped), lazy-loaded — acceptable so far.
- **Resident-facing framing?** — the root app noted a possible resident audience (its §2); out of
  scope here unless raised.

---

## 13. Next steps

**Status (2026-06-12):** Stages 0–3 shipped and **deployed to GitHub Pages at `/districts/`** (cards +
seasonal chart + heatmap/dots map, 7 signals, full-sync time window + Play). Remaining work:

- **Refresh the data (manual cadence).** Rerun `build/01_pull.py → 02_assign.py → 03_rollup.py` and
  commit the updated `data/` JSON — no frontend change needed. A **scheduled GitHub Action** that
  rebuilds + commits fresh JSON is the not-yet-built automation option (§12).
- **⚠ Cross-project fix — root hypothesis-tool `homeless_presence` reroute (TODO).** Its 311 source
  still filters the naive `service_name IN ('Encampment','Encampments')`, so it **undercounts
  ~2,000–2,600/mo after June 2025** (same bug we fixed here via D12). Fix: union the reroute path
  (`OR (service_name='General Request' AND lower(service_subtype) LIKE '%homeless%')`), dedup by
  `service_request_id`. Flagged as a TODO in root `../PLAN.md` §12 (caveat 8).
- **Stage 4 polish (not yet done).** Methodology footnote with per-signal **live Socrata query links**
  + build/provenance date; **share-via-URL** (signal + district + window, mirroring root `PLAN.md`
  §8.4). Dark mode is already inherited.
- **Optional / on request:**
  - **HSOC-only "homeless-routed" variant** of a CFS signal — a purer cut (§6.1, §12).
  - **Force heatmap during Play** for smoothness if dots-mode playback ever feels janky (D14).
  - **Resident-facing view** (§12) — only if that audience is pursued.

---

## 14. Changelog

- **2026-06-11** — **Built Stages 0–3 + full sync.** Pipeline (pull → point-in-polygon assign → rollup)
  emits committed JSON; frontend (cards + seasonal SVG chart + Leaflet heatmap/dots) reuses the root
  app's look. **Full sync (D14):** one global time window drives cards, chart highlight, and map, with
  a **Play** button that slides it month-by-month. Map: scroll-zoom on, taller; chart overlay lines
  given high-contrast colors + white casings. 5 Playwright smoke tests.
- **2026-06-11** — **Signal-quality research + curation (§6.1, D13).** Verified each SFPD CFS call
  type's HSOC-routing share (dispatcher notes too sparse, ~6%, to use): Sit/Lie ~87%, Homeless
  Complaint ~84%, **Blocked Sidewalk ~50%**, Trespasser ~6%. Found the **HSOC signal overlaps the
  others** — ~75% of it re-counts the HSOC-routed slice of Sit/Lie + Homeless Complaint + Blocked
  Sidewalk. **Dropped `cfs_blocked`** (half non-homeless noise; its homeless half already in HSOC);
  updated the HSOC caveat to flag the overlap ("never sum it with the others"). **Added
  `encampment_only`** — the dedicated Encampment category on its own (shows the June-2025 cliff with a
  break caveat), alongside the continuous union. Registry now 7 signals.
- **2026-06-11** — **Researched the June-2025 reroute (§3) — it's real and material; reversed the
  earlier "continuous" read.** Live queries: a new `General Request`/`homelessness_and_supportive_housing`
  stream switches on June 2025 (~0 → ~2,000–3,000/mo) while `service_name='Encampment'` drops
  anomalously *into* summer 2025. Unioning restores the seasonal shape (Aug 2025 union 5,750 ≈ Aug
  2024 5,187), so the naive filter's 2025–26 "decline" is mostly a reporting artifact. Added **D12**
  (core signal = union, deduped, with a 2025-06 break marker), relabeled the signal "Encampment &
  homelessness reports," updated §6 filter, caveat 7, and Stage 0. Rerouted records are 99.7% geocoded.
- **2026-06-11** — Plan drafted from the brief. Locked: pre-baked static JSON build (D1), reuse of
  emergent-map's district point-in-polygon + boundaries (D3), a multi-signal registry viewed
  individually (D4), seasonally-aware headline (D5), citywide comparison baseline everywhere (D6),
  heatmap+dots+scrubber map (D7). Staged the build (§10).

---

## 15. Reusable lessons & data-source notes (for next time)

Things we learned the hard way this build — skim before extending this dashboard or starting a sibling
SF-civic project.

**Data & methodology**
- **HSOC routing is the best homeless-relatedness proxy for SFPD CFS (`2zdj-bwza`).** Dispatcher notes
  (`call_type_original_notes` / `call_type_final_notes`) are only **~6% populated**, so keyword
  classification doesn't work for these calls. Use **`onview_flag`** instead: `HSOC` = routed to the
  Healthy Streets Operation Center (homeless ops), `N` = community-reported, `Y` = officer on-view.
  HSOC share of community-reported (N+HSOC) ranks homeless-relatedness: **Sit/Lie ~87%, Homeless
  Complaint ~84%, Blocked Sidewalk ~50%, Trespasser ~6%** (§6.1).
- **The `hsoc` signal overlaps the call-type signals** (`onview_flag='HSOC'` spans *all* call types):
  ~75% of it re-counts Sit/Lie + Homeless Complaint (+ the dropped Blocked Sidewalk). **Never sum HSOC
  with the call-type signals.** It's a cross-cutting *response* lens, not an additive need signal.
- **June-2025 encampment reroute** (D12/§3): `service_name='Encampment'` → `General Request` /
  `homelessness_and_supportive_housing`. Any encampment query must **union both** or it undercounts
  ~2,000–2,600/mo after mid-2025 and fakes a decline. Verify with a seasonal cross-check: encampment
  reports should *rise* into summer; if the naive filter falls, suspect a reroute.
- **2024-06-13 311 taxonomy migration** (D10): Title Case → snake_case `service_details`; always match
  both with `lower(...) LIKE`.
- **District concentration:** the 4 districts hold ~56% of citywide encampment reports (Northern &
  Mission dominate; Central & Tenderloin smaller). Citywide is the right denominator (D6).
- **⚠ Cross-project bug — the root hypothesis-tool has the same reroute undercount.** Its
  `homeless_presence` signal (`../PLAN.md` §7) uses 311 `service_name IN ('Encampment','Encampments')`
  for its 311 source, so it under-reports encampments after June 2025 just like our naive filter did.
  It should union the reroute path too. (Flagged in the root `PLAN.md`.)

**Build & engineering**
- **macOS Python.org SSL:** `CERTIFICATE_VERIFY_FAILED` (the python.org build ships no system CAs).
  `build/httpget.py` falls back to an unverified context — safe here (read-only public GET, no auth).
  The error arrives **wrapped in `urllib.error.URLError`**, so catch that, not just `ssl.SSLError`.
- **Two datasets, two geometries:** 311 (`vw6y-z8j6`) has plain `lat` / `long` columns (note: `long`,
  not `lng`); SFPD CFS (`2zdj-bwza`) stores coords in the **`intersection_point`** GeoJSON point
  (`coordinates` = `[lng, lat]`). Handled via `geo_kind` in `build/signals.py`.
- **No server-side police district on 311** → point-in-polygon against `qgnn-b9vv` (district names are
  **UPPERCASE**: `CENTRAL`, `NORTHERN`, `MISSION`, `TENDERLOIN`). Boundaries + ray-casting reused from
  emergent-map.
- **Socrata paging:** `$order=:id` + `$offset` in 50k-row pages for stable pagination.
- **Point-file size:** compact `[latE5, lngE5, dayIndex, distIdx]` tuples, per-signal, lazy-loaded;
  `waste` is the largest at ~2.6 MB (~600 KB gzipped) — acceptable, block-aggregation fallback (§9)
  unused so far.
