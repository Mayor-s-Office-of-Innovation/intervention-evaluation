# Plan — Unhoused Presence in San Francisco

**Working title:** "Unhoused presence — community-reported signals, trends over time"
**Owner:** Aaron · **Drafted:** 2026-06-13
**Status:** 🟡 Planning — analysis-first. Signal set scoped; dashboard build deferred to after review.

> Living document. Keep it current as we build (see Changelog, §9).

---

## 1. Goal

Give a simple, honest read on **how community-reported unhoused presence is changing over time in San
Francisco**, using only signals we can **confidently attribute to homelessness**. This is a
**re-scope of `../districts/`** down to a clean, defensible signal set — every signal here is
either *definitionally* about homelessness (encampments, homeless complaints, sit/lie) or a
clearly-labeled city-response context signal (HSOC). Ambiguous co-located proxies are **moved out** to
the projects that own them:

- **Needles / syringes → a separate drug-use project** (the user's call). Needle reports are a
  substance-use signal that happens to co-locate with homelessness; they belong with drug-use analysis,
  not here, and carry their own multi-year citywide secular decline (`../districts/` D6).
- **Human/animal waste → a separate cleanliness project** (decided 2026-06-13 after the attribution
  analysis below, §3). We could **not** confidently isolate the unhoused share, so it's deferred to the
  project that will treat street cleanliness in its own right.

**Companion projects this builds on:**
- **`../districts/`** — the encampment/homelessness district dashboard. We reuse its **build pipeline**
  (`build/01_pull → 02_assign → 03_rollup`, Socrata paging, `signals.py` registry, `httpget.py` SSL
  workaround), its **police-district boundaries** (`qgnn-b9vv`) + point-in-polygon, its **seasonality-first
  methodology**, and its **frontend stack** (Web Awesome + Leaflet + hand-rolled SVG, no framework). See
  `../districts/plan.md`.
- **`../theft/`** — the analysis-first discipline: verify the data, write decisions + caveats, defer the
  dashboard until findings are reviewed. We mirror that here.
- **Root app** (`../`) — design language and Socrata patterns.

---

## 2. Signal set (each viewed individually — `../districts/` D4)

All are **community-reported** except HSOC (a city-response lens). Default = `encampment`.

| Key | Label | Dataset | Filter | Status / why |
|---|---|---|---|---|
| `encampment` | **Encampment & homelessness reports** (core) | 311 `vw6y-z8j6` | `service_name IN ('Encampment','Encampments') OR (service_name='General Request' AND lower(service_subtype) LIKE '%homeless%')`, dedup `service_request_id` | **Keep — the headline.** Union across the **June-2025 reroute** (`../districts/` §3/D12): the dedicated Encampment category was folded into a homelessness service-request category mid-2025; the naive filter undercounts ~2,000–2,600/mo and fakes a decline. Carries a 2025-06 break marker. |
| `encampment_only` | Encampment category only (311) | 311 `vw6y-z8j6` | `service_name IN ('Encampment','Encampments')` | **Keep.** The dedicated category on its own (a component of the union); shows the June-2025 cliff with a break caveat. |
| `cfs_sitlie` | 911 Sit/Lie Enforcement | SFPD CFS `2zdj-bwza` | `call_type_final_desc='SIT/LIE ENFORCEMENT' AND onview_flag IN ('N','HSOC') AND dup_cad_number IS NULL` | **Keep.** ~87% HSOC-routed → strongly homeless (`../districts/` §6.1). |
| `cfs_homeless` | 911 Homeless Complaint | SFPD CFS `2zdj-bwza` | `call_type_final_desc='HOMELESS COMPLAINT' AND onview_flag IN ('N','HSOC') AND dup_cad_number IS NULL` | **Keep.** Direct homeless-presence call; ~84% HSOC-routed. |
| `hsoc` *(context)* | HSOC outreach response (city action) | SFPD CFS `2zdj-bwza` | `onview_flag='HSOC' AND dup_cad_number IS NULL` | **Keep as context only.** A *city-response/program-growth* lens, not need; **overlaps** the other 911 signals (~75% redundant) — never sum it with them (`../districts/` §6.1). |
| ~~`needles`~~ | ~~Needles / syringes~~ | — | — | **MOVED OUT → drug-use project.** A substance-use signal, not a homelessness measure; co-locates with homelessness but isn't homelessness. |
| ~~`waste`~~ | ~~Human/animal waste & urine~~ | — | — | **MOVED OUT → cleanliness project** (§3). Could not confidently attribute to unhoused: the 311 category irreducibly merges human + animal waste, and the temporal coupling to encampments is weak. |

> Inherited curation from `../districts/` §6.1, unchanged: `cfs_blocked` (Blocked Sidewalk) stays
> **dropped** (~50% homeless-related, redundant with HSOC); `Trespasser` never added (~6%).

---

## 3. The waste attribution analysis (verified live, 2026-06-13) — why waste is deferred

The user asked whether human-waste/urine reports can **really be traced to unhoused presence**, with a
high bar: *"we need to be really sure we have an unhoused relation to include it."* We tested it directly
on 311 `vw6y-z8j6`. **Verdict: not confidently — defer to the cleanliness project.**

### 3.1 The category itself cannot separate human from animal
311 has **one** waste category, and it is *definitionally* mixed. The `service_details` value is literally
**`Human or Animal Waste`** (older Title-Case taxonomy, 301k all-time) → renamed **`human_waste_or_urine`**
at the **2024-06-13 migration** (newer snake_case, ~3,300–4,100/mo since). It's the same single DPW
reporting bucket the whole time — there is **no field that distinguishes dog waste from human feces/urine.**
So any "human waste" read is an *assumption*, not data. (The current `../districts/` filter correctly
unions both spellings; the limitation is the source category, not the filter.)

### 3.2 Spatial co-location is real but partly confounded
- **Neighborhood-level (2025+):** waste vs encampment correlate **Pearson 0.89 / Spearman 0.93**. Top-3
  homeless neighborhoods (Tenderloin 22%, Mission 19%, SoMa 14%) hold **~55% of all waste**.
- **But it's not waste-specific:** generic illegal dumping correlates almost as well with encampment
  (litter 0.81, mattress 0.82, shopping carts 0.87) — much of the 0.89 is the shared *"dense,
  high-foot-traffic, high-reporting neighborhood"* pattern, not a waste→homeless link. (Litter is also a
  **contaminated control** — trash accumulates *at* encampments — so it can't cleanly isolate the effect.)
- **Block-level (~111m cells, Aug–Nov 2025), vs a *clean* infrastructure control (`city_garbage_can_overflowing`):**
  waste **is** meaningfully more encampment-concentrated than the control — waste reports sit on heavy-encampment
  blocks (10+ encampment reports) **48.5%** of the time vs **14.5%** for garbage cans, and on
  no-encampment blocks just **13.1%** vs **27.6%**. Mean encampment exposure: waste **19.7** vs garbage-can
  **7.3** vs a uniform baseline **3.2**. This is the strongest pro-association evidence.

### 3.3 …but the temporal coupling is weak — the deal-breaker for the high bar
Within-neighborhood **monthly** waste vs encampment (2024-07 → 2026-04) does **not** co-move:
Tenderloin **0.20**, Mission **−0.09**, Castro 0.10, Bayview 0.06, Haight −0.15 (moderate only in some
mid-volume areas: Hayes Valley 0.59, Nob Hill 0.52, SoMa 0.54). If encampments drove waste, the two
biggest homeless neighborhoods should couple tightly over time — they don't. The cross-sectional
co-location is consistent with *both* "waste is unhoused-driven" **and** "waste + encampments both
concentrate in dense corridors for shared reasons"; the weak temporal link argues against a tight causal tie.

### 3.4 Decision
**Exclude `waste` from the unhoused project; address it in the cleanliness project** (user, 2026-06-13).
The evidence is *suggestive of association* but **not sufficient to confidently call it an unhoused
measure** — the category can't separate human from animal, and it doesn't track encampments over time.
The findings above are recorded so the cleanliness project can reuse them rather than re-derive.

---

## 4. Data reality checks (carry in — inherited & verified)

1. **June-2025 encampment reroute** (`../districts/` §3/D12): the core `encampment` signal **must** union
   the rerouted `General Request`/homelessness stream or it undercounts ~2,000–2,600/mo after mid-2025
   and fakes a decline. 2025-06 break marker.
2. **Seasonality is large** (~1.6–1.7× summer-vs-winter on encampment) → compare same-season / show the
   deseasonalized trailing-12-mo trend; never headline a raw month-over-month delta.
3. **2024-06-13 311 taxonomy migration** (`../districts/` D10): Title Case → snake_case; match both with
   `lower(...) LIKE` and dual `service_name` spellings.
4. **SFPD CFS homeless-relatedness** = `onview_flag` HSOC-routing share (dispatcher notes ~6% populated,
   unusable): Sit/Lie ~87%, Homeless Complaint ~84% (`../districts/` §6.1). **HSOC overlaps** the others —
   never sum.
5. **Two datasets, two geometries:** 311 (`vw6y-z8j6`) plain `lat`/`long`; SFPD CFS (`2zdj-bwza`) coords in
   `intersection_point` GeoJSON. No server-side police district on 311 → point-in-polygon vs `qgnn-b9vv`.
6. **Partial current month** excluded from headline comparisons. But — unlike `../theft/` — **no
   report-approval settling lag** here (D13, verified): 311 + CFS are creation-stamped, so recent *complete*
   months are reliable and need no extra buffer. CFS volumes are small/noisy → prefer multi-month windows.
7. **Reports = observation/reporting rate, not ground truth.** Observational, not causal. Reporting-propensity
   varies by neighborhood (the §3.2 confound).

---

## 5. Method & architecture (reuse `../districts/` wholesale)

The pipeline is the districts pipeline with a **smaller signal registry** (5 signals; needles + waste
removed). No new techniques needed.

```
unhoused/
  plan.md                  ← this file
  build/ (when we proceed — copy ../districts/build, prune signals.py)
    signals.py             ← encampment, encampment_only, cfs_sitlie, cfs_homeless, hsoc
    01_pull.py 02_assign.py 03_rollup.py  ← unchanged from districts
    httpget.py             ← SSL workaround (unchanged)
    provenance.json
  data/
    aggregates.json        ← per-signal monthly series per geo + citywide
    points/<signal>.json   ← compact [latE5,lngE5,dayIndex,distIdx] tuples, lazy-loaded
    police_districts.geojson
  index.html styles.css js/  ← copy districts frontend; drop the dropped signals
  tests/e2e.spec.js
```

- **Rollup** (`../districts/` §7): monthly counts + YoY (same-season) + trailing-12-mo trend + current
  partial-month exclusion, per signal, per geo + citywide baseline.
- **Map** (D11/D12): a per-district, per-intersection **hot/cold transition map** on the fixed Lurie split
  (no history slider). Reuse `../../emergent-map`'s **intersection canonicalization** (`build/03_aggregate_311.py`,
  block-face for 311; intersection for CFS) + hotspot thresholding; classify each intersection
  persistently-hot / cooled / newly-emerged from its pre-Lurie vs trailing "hot now" rate; markers colored
  by category, click → that intersection's monthly trend + pre/post rates. Built on presence signals only.

---

## 6. Decisions locked

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Signal set = `encampment` (core), `encampment_only`, `cfs_sitlie`, `cfs_homeless`, `hsoc` (context).** | Every signal is definitionally homeless or a labeled city-response lens. Re-scope of `../districts/`. |
| D2 | **Drop `needles` → drug-use project.** | A substance-use signal that co-locates with homelessness but isn't a homelessness measure; owns its own secular decline. |
| D3 | **Drop `waste` → cleanliness project** (§3). | Can't confidently attribute to unhoused: category merges human + animal; weak temporal coupling to encampments despite cross-sectional co-location. High bar set by the user (2026-06-13). |
| D4 | **Core `encampment` = the June-2025-reroute union, deduped, 2025-06 break marker.** | Inherited from `../districts/` D12 — the naive filter fakes a decline. |
| D5 | **Reuse `../districts/` pipeline + frontend + boundaries verbatim**, minus the dropped signals. | No new methods needed; consistency + speed. |
| D6 | **Seasonality-first, citywide baseline, observational-not-causal framing.** | Inherited methodology (`../districts/` §7, §11). |
| D7 | **Visible "what's included & why" methodology footnote on the dashboard**, with the **waste-exclusion analysis (§3) shown publicly** — not buried. Plain-language, with the key numbers + a per-signal "why it's here / why it's homeless-related" line, generated from `provenance.json` so the page and queries can't drift. **Every signal — and every *component* of a combined signal — names its dataset (id + name) and links its exact, runnable Socrata query.** Combinations must show their parts, not just the rolled-up number: (a) **encampment union** → the dedicated-category query **+** the rerouted `General Request`/homeless query, with the dedup key; (b) **"911 calls" group** → the Sit/Lie query **+** the Homeless Complaint query separately; (c) **HSOC** → its query **+** a note that it overlaps (a) and (b) so it's never summed. Field/stat labels say what they tie back to (e.g. "= Sit/Lie + Homeless Complaint, deduped per call"). | User request (2026-06-13): be clear about data sources in footnotes + field descriptions so we know what queries each thing ties back to — *especially when combining*. Mirrors `../theft/` D9 (auditable exclusion footnote); a reader expects "waste/needles" covered, and a combined stat is opaque unless its parts + queries are shown. |
| D9 | **Scope = 4 districts — Northern, Mission, Tenderloin, Central — each with its own page + district-specific stats.** Citywide kept as a comparison baseline. | User decision (2026-06-13). Per-district pages give each district its own headline/trend/map; the 4 match `../districts/`'s target set and `qgnn-b9vv` boundaries. |
| D10 | **Standalone site — do NOT fold into `../districts/`.** | User decision (2026-06-13): a clean, homeless-specific dashboard; `../districts/` keeps its fuller caveat-heavy registry. |
| D11 | **Map = a per-intersection hot/cold *transition* map on a FIXED Lurie-inauguration (Jan 8, 2025) split — no history slider.** Reuses `../../emergent-map`'s intersection canonicalization + hotspot machinery. Three categories: **persistently hot** (hot pre & post), **cooled** (hot pre, not now — *includes* emerged-then-cooled), **newly emerged** (cold pre, hot now). Built **on the presence signals** (encampment + 911 homeless complaints), not enforcement. Adjacent cooled+emerged is surfaced as a likely **displacement** read. | User decision (2026-06-13): chose the refined transition typology over a heatmap (it tells the change story this project cares about), and **explicitly dropped the movable history-from slider** — the Lurie split is fixed, so the map is a clean static classification. |
| D12 | **Classification windows & guardrails:** pre-Lurie baseline = **2023-01 → 2024-12** (24 mo, 2 summers); **"hot now" = the 3 most recent *complete* months**. **Exclude only the in-progress current month — NO theft-style settling buffer** (D13). Classification is **difference-in-differences**: a ~110 m block (`CELL_DECIMALS=3`) is judged against **its district's overall pre→now "tide"** (which absorbs the June-2025 reroute, secular growth, and seasonality), with a **±35% dead-band** (`BAND`) → *emerged* = rose faster than its district, *cooled* = fell relative to it, *persistent* = stayed hot & roughly tracked it. Guardrails: a **minimum-event floor** (`FLOOR=6`) so a lone spike can't fake a hotspot, and a **per-signal "hot" threshold** — **encampment ≥3/mo, 911 ≥1.25/mo** (`HOT_RATE`) — because the two signals are on very different scales (encampment cells ~1.3/mo median, 911 ~0.7/mo); a single bar left the 911 map nearly all-"emerged" with no persistent/cooled. All knobs are **tunable** and were set by eyeballing the live per-district maps. | User questions (2026-06-13): "hot now" 6 mo felt too laggy → 3 complete months (no settling buffer needed, D13). Tuning the live maps (2026-06-13): a global hot bar made the low-volume 911 map one-note → split to per-signal thresholds (encampment 3.0, 911 1.25); raising encampment's bar from 2→3 also thinned dense overlap (totals 94/121/265 → 57/84/197) while keeping the spatial story. |
| D14 | **Three-tier stat layout** (per district page): **(1)** **Encampment & homelessness reports** as a *standalone headline* — the critical presence metric (`encampment_only` is a sub-view exposing the June-2025 reroute, not its own card); **(2)** a grouped **"911 calls about unhoused presence"** = `cfs_sitlie` **+** `cfs_homeless` summed (clean — distinct call types, no overlap), with a toggle to decompose to the two; **(3)** **HSOC outreach response** as clearly-labeled city-response **context, explicitly NOT a success metric** (D8). | User decision (2026-06-13): keep encampment separate as a critical metric on its own; HSOC available but not a success measure; the other (non-encampment) signals grouped. The two CFS call types are individually low-volume/noisy and don't overlap, so summing improves signal (cf. `../theft/`'s commercial lump). |
| D16 | **Map drill-down for specific intersections:** (a) each block's popup carries a **monthly sparkline** (2023→now, Lurie marker) so leadership can read a known corner's *trajectory* at a glance; (b) **zooming past z16 swaps the block cells for individual report markers**, period-colored (before-Lurie faded vs since solid), with a **hover overlay of the report's detail fields** (311: address, type, status, handled-by, reported-via; 911: intersection, call type, disposition, priority). Markers are a lean coded file (`build/05_markers.py` → `data/markers/<signal>.json`, ~1 MB gz encampment), lazy-loaded on first zoom-in, viewport-bounded + capped at 1500 with a "zoom in" hint. | User request (2026-06-13): leadership tracks specific problematic intersections. Kept *in* the tool (not a separate link-out) so the Lurie framing carries down to the corner level; the sparkline answers "how is it *doing*" directly, the markers answer "show me the actual reports." Period-coloring keeps even the raw-report view on the "what changed" message. |
| D15 | **Consolidated low-cognitive-load layout (supersedes D14's *presentation*, not its signal logic).** Top row = **two compact success cards** — *Encampments* and *911 unhoused calls* — each just a number + a plain-language 12-mo verdict (down = good). Then a **single chart** with a segmented selector — **Aggregate · Encampment · 911 unhoused calls** — where **Aggregate = the summed total** (encampment union + 911 group; clean, no overlap; encampment dominates the magnitude); a **detail strip** under the chart carries the vs-last-month / vs-a-year-ago / vs-typical + SF-context comparisons for whatever's focused (so the cards stay scannable); the **encampment-only reroute view** becomes a small toggle shown only when Encampment is focused (fixes its prior hidden-ness). **HSOC drops out of the top metrics** and sits **below the success metrics as a response signal — the direct analog to arrests in `../theft/` D11**: flagged as *appropriate to rise while presence is high, but ultimately should fall as the problem improves* — never a standalone success target (D8). Map + methodology unchanged. | User decision (2026-06-13): reduce cognitive load — two big headline cards + two charts + an HSOC tier was too much parallel detail. Summarize at top, one focused chart, response signal demoted below. Encampment-only stops being a buried toggle and becomes a clear chart option. |
| D13 | **No report-approval settling lag in these datasets — verified live (2026-06-13).** 311 (`vw6y-z8j6`) and SFPD CFS (`2zdj-bwza`) are **creation-stamped** (`requested_datetime` / `received_datetime`) with no supervisor-approval gate, so recent complete months do **not** backfill the way `../theft/`'s `wg3w-h783` incident reports did. Both datasets were fresh to **2026-06-12**; 311 encampment's latest complete month (May 2026 = 6,467) was the recent *peak*, not depressed. Exclude only the partial current month. The build should still **measure freshness live** (cheap insurance) but must NOT pre-bake theft's 2-month buffer. | The theft lag was specific to police incident reports needing approval (median 0d, p90 ~48d). Verified that mechanism is absent here, so importing the buffer would needlessly lag the "hot now" window. CFS counts are low/noisy → lean on multi-month windows regardless. |
| D8 | **HSOC = the city-response/enforcement axis — context, never a success target** (the direct analog to arrests in `../theft/` D11). Success/need is read off the **community-reported presence signals** (encampment + 911 homeless complaints), which are robust to outreach activity; HSOC is shown *beside* them as "how much the city routed to homeless outreach," demoted (e.g. a context block, like theft's arrests). | User insight (2026-06-13). HSOC routing rises with **program scaling**, not need — same reflexivity trap as enforcement counts (`crime-effectiveness-enforcement-reflexivity`): "more response" isn't unconditionally good. And unlike an arrest, an outreach contact doesn't remove the underlying need (displacement / balloon effect, `../districts/` caveat 4) — so HSOC is *even less* a success metric than theft arrests were. |

---

## 7. Analysis findings so far (2026-06-13)

- **Waste attribution (§3):** deferred — recorded above. *Strongest single result:* waste sits on
  heavy-encampment blocks 48.5% vs 14.5% for a clean infrastructure control, but doesn't co-move with
  encampments over time (TL 0.20, Mission −0.09) and can't be separated from animal waste.
- **Encampment (core)** remains the headline; reuse the verified districts series + reroute union.
- **Citywide waste trend** (recorded for the cleanliness project): rising — 36k (2023) → 39k (2024) →
  47k (2025) → 22k YTD (2026, on pace ~48k).

---

## 7.5 Public methodology footnote (D7) — what the dashboard must show

A visible footnote/section on the page, in plain language, generated from `provenance.json`:

**Signals included — and why each is homeless-related**
- *Encampment & homelessness reports* — the dedicated 311 encampment category, unioned with the
  homelessness service-requests it was rerouted into in June 2025 (so the trend stays continuous).
- *Encampment category only* — the original category on its own, for transparency about that reroute.
- *911 Sit/Lie Enforcement* (~87% routed to homeless outreach) and *911 Homeless Complaint* (~84%) —
  community 911 calls overwhelmingly handled as homeless-related.
- *HSOC outreach response* — shown as **city-response context only**, not a measure of need; overlaps the
  911 signals (never summed).

**What we left out — and why (with the analysis)**
- *Needles / syringes — excluded.* A drug-use signal that co-locates with homelessness but isn't a
  measure of it. Covered in a dedicated drug-use project.
- *Human/animal waste — excluded after analysis.* Show the §3 finding publicly: 311 records this as a
  single **"human or animal waste"** category that **cannot separate dog waste from human waste**. It does
  cluster near encampments (≈49% of waste reports sit on heavy-encampment blocks vs ≈15% for ordinary
  overflowing-trash-can reports), **but** it does **not** rise and fall with encampments month to month in
  the highest-homeless neighborhoods — so we can't confidently call it an unhoused measure. It's covered in
  a dedicated street-cleanliness project instead.

Each signal — **and each component of a combined signal** — names its **dataset (id + name)** and links its
**exact, runnable Socrata query**, generated into `provenance.json` so the numbers can't drift from the page
(`../theft/`/`../districts/` discipline). **Combinations show their parts, not just the total** (D7):
- *Encampment* → dedicated-category query **+** rerouted `General Request`/homeless query, deduped on
  `service_request_id` (both from 311 `vw6y-z8j6`).
- *911 calls about unhoused presence* → the Sit/Lie query **+** the Homeless Complaint query, shown
  separately (both from SFPD CFS `2zdj-bwza`, deduped per `cad_number`).
- *HSOC* → its query **+** an explicit "overlaps the above, never summed" note.

Field and stat labels state what they tie back to (dataset + how it's combined), e.g. *"911 calls about
unhoused presence = Sit/Lie Enforcement + Homeless Complaint (SFPD CFS 2zdj-bwza), deduped per call."*

---

## 8. Open questions (to discuss before building)

- ~~**Geographic scope.**~~ **Resolved (D9):** 4 districts (Northern, Mission, Tenderloin, Central), each
  its own page + district-specific stats, citywide as baseline.
- ~~**New site vs. fold in.**~~ **Resolved (D10):** standalone site.
- ~~**Map design.**~~ **Resolved (D11/D12):** per-intersection hot/cold transition map, fixed Lurie split,
  no history slider; 3 categories; presence signals only; displacement read. **"Hot now" window (3 mo default)
  is tunable** — confirm empirically once the data's built.
- ~~**Effectiveness scorecard vs trend monitor.**~~ **Resolved (D14):** trend monitor, not a theft-style
  success quadrant. Three tiers — encampment standalone headline; Sit/Lie + Homeless Complaint grouped;
  HSOC as context, never a success metric.
- **Effectiveness framing — partly resolved (D8).** Like `../theft/`, the two axes are **presence/need**
  (community-reported encampment + 911 homeless complaints, want ↓ — robust to outreach activity) vs.
  **city response** (HSOC routing — context, *not* a success target). Open: do we build the full
  side-by-side two-axis scorecard (theft style), or start as a trend monitor with HSOC as a context block?
  Note a key difference from theft: an outreach contact doesn't remove need the way an arrest removes an
  offender (displacement), so we should **not** imply "presence ↓ + HSOC ↑ = success" as cleanly as theft did.
- **CFS signal combine toggle** — keep separate (inherited D4) or offer a combined unhoused-presence view?

---

## 9. Changelog

- **2026-06-13** — Project kicked off as a clean re-scope of `../districts/`. **Ran the waste attribution
  analysis (§3):** established that 311's waste category irreducibly merges human + animal (one bucket,
  renamed `Human or Animal Waste` → `human_waste_or_urine` at the 2024-06-13 migration); waste co-locates
  with encampments cross-sectionally (block-level 48.5% on heavy-encampment blocks vs 14.5% for a clean
  garbage-can control) but **does not co-move over time** (Tenderloin 0.20, Mission −0.09). **Decided to
  defer waste to a cleanliness project and needles to a drug-use project** (D2/D3), leaving a clean
  5-signal homeless-specific set (D1). Dashboard scope + standalone-vs-fold-in left as open questions (§8).
- **2026-06-13** — Added **D7** (a public "what's in/out & why" methodology footnote with the waste analysis
  shown openly, §7.5) and **D8** (treat **HSOC as the city-response/enforcement axis — context, never a
  success target**, the direct analog to arrests in `../theft/` D11; presence/need is read off the
  community-reported signals). Both per user direction.
- **2026-06-13** — **Scope + map locked.** **D9** (4 districts — Northern, Mission, Tenderloin, Central —
  each its own page + stats, citywide baseline), **D10** (standalone site). **D11** map = per-intersection
  hot/cold **transition map** on a fixed Lurie-inauguration (Jan 8, 2025) split — *no history slider* —
  reusing `../../emergent-map`'s intersection machinery; 3 categories (persistently hot / cooled / newly
  emerged), presence signals only, with a displacement read. **D12** classification windows: pre-Lurie
  baseline 2023-01→2024-12, "hot now" = trailing ~3 complete months (tunable) excluding unsettled recent
  months, seasonally-fair comparison, with a min-event floor + magnitude-based cooled/emerged rule.
- **2026-06-13** — **D14: three-tier stat layout.** Encampment kept as a *standalone headline* (critical
  metric); the two non-overlapping CFS call types (Sit/Lie + Homeless Complaint) **grouped** into one "911
  calls about unhoused presence" stat (decompose on toggle); HSOC available as **context, not a success
  metric**. Dropped the theft-style success-quadrant framing (an outreach contact ≠ removing need).
- **2026-06-13** — **Built the frontend (Stages 1–2).** Standalone static site reusing the districts stack
  (Web Awesome + Leaflet + hand-rolled SVG, no framework): per-district hash-routed pages (Northern /
  Mission / Tenderloin / Central) with the **three-tier layout** (D14) — encampment headline + seasonal
  chart (with the dedicated-category sub-view toggle and 2025-06 break marker), the grouped 911 card +
  chart (decompose toggle), and the HSOC context card; the **fixed-Lurie transition map** (D11/D12) with a
  **difference-in-differences** classifier (`build/04_transitions.py`) that normalizes each ~block cell
  against its district's pre→now tide so the June-2025 reroute / secular growth don't read as local change
  (the reroute-free 911 view corroborates the broad post-Lurie emergence); and the **public methodology
  footnote** (D7) with per-component runnable Socrata queries + the waste/needles exclusions shown openly.
  4 Playwright smoke tests pass; no console errors. Map signal toggle restyled as a segmented control.
- **2026-06-13** — **Added map drill-down (D16).** Block popups now carry a **monthly sparkline**
  (per-block series added in `04_transitions.py`, aligned to `_meta.months`). New **`05_markers.py`** emits
  lean coded per-signal marker files (`data/markers/*.json`; categorical fields dictionary-coded, coords as
  int E5 → encampment 4.8 MB / ~1.1 MB gz, 911 1.4 MB / ~0.2 MB gz). Enriched the pull (`signals.py` adds a
  per-signal `detail` field set; `02_assign.py` carries it through). Frontend: **zoom past z16 swaps block
  cells → individual report markers**, period-colored, with a hover overlay of the detail fields; lazy-loaded,
  viewport-bounded, capped at 1500 with a hint. New e2e test covers it.
- **2026-06-13** — **Tuned the transition map on the live maps (D12).** Split the "hot" threshold to
  **per-signal** (encampment ≥3/mo, 911 ≥1.25/mo): a single 2/mo bar left the lower-volume 911 map almost
  entirely "emerged" (≈3 persistent / 5 cooled per district) — the lower 911 bar restores real
  persistent/cooled (now 42/48/108 across the 4 districts), and raising encampment's bar to 3 thinned dense
  overlap (57/84/197, was 94/121/265) without losing the spatial story. Map footnote now states the
  per-signal hotspot threshold; `_meta.json` carries `hot_rate_per_month_by_signal`. The emerged-lean is
  real (the reroute-free 911 signal shows the same broad post-Lurie emergence).
- **2026-06-13** — **Marker-overlay polish (user nits).** Fixed the hover overlay overflowing its card
  (Leaflet tooltips default to `white-space:nowrap`; gave `.marker-overlay` a fixed `width:250px` +
  `overflow-wrap:anywhere` so long values wrap — a plain `max-width` collapses because tooltips are
  shrink-to-fit). And made the tiny report dots easy to trigger: each dot now sits under a larger
  **invisible hover halo** (radius-11 circle, `fillOpacity:0` + `pointer-events:all` via `.mk-halo`, since
  Leaflet only hit-tests painted pixels), with the visible dot drawn `interactive:false` on top.
- **2026-06-13** — **Cell popups name their intersection; individual dots recolored by recency.** Each
  hotspot cell now carries a representative location label — the most-reported `intersection_name` (911) /
  `address` (encampment) among its reports, computed in `04_transitions.py` (`name` field) — shown bold at
  the top of the cell popup so a shared link reads as a real place (e.g. "GEARY BLVD / VAN NESS AVE",
  "299 FRANKLIN ST"). Individual report markers are **no longer colored before/since-Lurie** — they're now
  colored by whether the report falls in the **trailing-3-month "now" window** (the same cutoff the
  clustering uses): recent = solid red, older = faded. `05_markers.py` emits `now_start_day`; the frontend
  colors `day >= now_start_day`. Builds re-ran from cache offline (portal down) and reproduced the exact
  cluster counts (57/84/197, 42/48/108) plus the new fields. e2e adds a cell-name assertion; all 7 pass.
- **2026-06-13** — **Shareable map deep-links on the block/intersection cells.** The transition map mirrors
  its state into the URL via `history.replaceState` (no Back-button history pollution): **clicking a
  classified block cell pins its popup** (the monthly-sparkline trend) and records zoom + center + active
  signal + a stable `cl` cell id (`lat_lng` of the cell center, rebuild-stable). Loading a shared link
  scrolls to the map, restores the zoom/center, and re-opens that cell's popup. State is tied to a *pinned
  cell* — plain loads, district switches, closing the popup, or zooming into the individual-marker view all
  leave a clean URL. **Individual report markers are deliberately NOT deep-linked** (hover-only, per user).
  Also bumped the cell→individual-marker zoom threshold 16→17 (user). New e2e test covers the pin →
  deep-link (asserts `replaceState`, not `pushState`) → shared-link restore round-trip; all 7 pass.
- **2026-06-13** — **Chart legend for the overlay lines (user nit).** The "Reports over time" chart drew
  orange monthly bars plus up to three overlay lines (ink solid = 12-mo trailing average/trend, teal dashed
  = a year earlier, blue dashed = citywide scaled-to-shape) with **no key** — readers couldn't tell the
  lines apart. Added a legend under the SVG in `chart.js`: each swatch is a tiny inline SVG that **reuses
  the chart's own stroke/fill classes** (`line-trend`/`line-prioryear`/`line-citywide`/`chart-bar`), so
  colour + dash pattern stay in sync with the lines automatically and can never drift. Built
  **conditionally** — only lists overlays actually present in the model. CSS (`.chart-legend`/`.cl-item`/
  `.cl-sw`) includes a width override so the `100%`-width chart-svg rule doesn't stretch the swatches. e2e:
  the swatch SVGs made `#chart svg` ambiguous, so the chart-visibility assertion now targets `#chart > svg`
  (legend swatches are nested) plus a new legend-renders check; all 7 pass.
- **2026-06-13** — **D13: verified no settling lag** (the theft 2-month buffer does NOT apply). 311
  (`vw6y-z8j6`) + CFS (`2zdj-bwza`) are creation-stamped, no approval gate; both fresh to 2026-06-12 and the
  latest complete 311 month (May 2026) was the recent peak, not depressed. So "hot now" excludes only the
  in-progress current month and can run right up to the last complete month — keeping the map current.
