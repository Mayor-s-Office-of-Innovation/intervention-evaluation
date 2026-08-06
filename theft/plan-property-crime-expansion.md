# Plan — Property & street crime dashboard expansion

## Context

The theft dashboard ([theft/index.html](index.html) + [theft/js/app.js](js/app.js)) today renders two
signal cards (shoplifting; commercial burglary & robbery) with trend chips, a line chart, SF-context and
arrests context, then methodology/footnotes. It has **no map, no day/night filter, no time scrubber, and no
vehicle-theft category** — it's the one dashboard in the [[sf-civic-dashboard-constellation]] that lags the
drug/unhoused feature set.

Designer mockups (2026-07-31, `~/Downloads/Screenshot 2026-07-31 at 11.2*.png`) propose bringing it to
parity plus adding vehicle theft. Two go/no-go research questions were answered first — see
[map-and-vehicle-findings.md](map-and-vehicle-findings.md). Headline conclusions that shape this plan:

- **Shoplifting clusters emphatically** (one dominant store-corner per district, 34–60% of the district) →
  a shoplifting concentration map is worth building. *(Later scrutiny — [map-hotspot-findings.md](map-hotspot-findings.md)
  — downgraded it from a "what moved" transition map to a static concentration map; see decision #2 / Workstream C.)*
- **Commercial does not cluster** (max 7/yr at the hottest corner) → trend card only, no map layer.
- **Vehicle theft is high-volume and falling fast** (citywide 8,985 in 2023 → 4,140 in 2025; Northern 419/yr
  ≈ shoplifting) but **spatially diffuse** → add as a category + rich detail section, but keep it off the
  recent-vs-prior map. Type parse from `incident_description` is clean (auto ≈ 68% of typed).

A third go/no-go check was run before building the Day/Night toggle — see
[day-night-findings.md](day-night-findings.md). Conclusion: **Day/Night is not illuminative for theft**
(shoplifting is ~90% daytime by store hours; commercial/vehicle "night" is contaminated by
reported-hour ≠ occurrence-hour plus a midnight artifact), so **Workstream D is dropped** and the honest
hour histogram moves into the vehicle detail section (B).

This plan also **folds in the not-yet-started data-lag follow-on** (Workstream F), whose research is complete
in [plan-data-lag-research.md](plan-data-lag-research.md) / [data-lag-findings.md](data-lag-findings.md).

> Note: an earlier research-design version lives at `~/.claude/plans/squishy-kindling-garden.md` (no
> implementation section). The in-repo [plan-data-lag-research.md](plan-data-lag-research.md) supersedes it —
> its **Follow-on** section is the current source for Workstream F below.

## Scope decisions (LOCKED 2026-08-05)

1. **Vehicle theft = context, not a KR.** ✅ Keep the two committed merchant KRs; add vehicle theft as a
   prominent **context** card + detail. Do **not** badge it KR3 (mockup's "KR3" badge is dropped). Avoids
   over-claiming a citywide decline as this team's result. Promoting to a formal KR later is a one-line
   header change ([[okr-candidate-header-convention]]).
2. **Map = shoplifting only, and STATIC concentration — not "what moved".** ✅ Shoplifting is the sole
   category (commercial/vehicle too sparse — the mockup's 3-way filter is dropped). **Scrutiny then
   downgraded the map itself** ([map-hotspot-findings.md](map-hotspot-findings.md)): the recent-vs-prior
   transition classification is dropped because corner movement is single-store reporting-regime churn,
   not crime moving. Ship an absolute current-window concentration map only. (Also dropped after scrutiny:
   **Day/Night toggle**, Workstream D — see [day-night-findings.md](day-night-findings.md).)
3. **Detail section is vehicle-only.** Justified because MVT's type/hour/all-time-location data supports a
   detail the merchant categories can't. Call that out in copy so it doesn't read as inverted priority.
4. **Aggregation source = native `intersection` field.** Research confirmed it's populated and reproduces the
   mockup's exact numbers, so we do **not** need to snap points to the baked cross-street index for the theft
   map. (Cross-street *search* can still reuse [[baked-cross-street-index]] / [[cross-street-search-expansion]].)

## Workstreams

Independent unless noted. A–E are the dashboard expansion; F is the data-lag follow-on (can land in parallel
or first — it's isolated to the settling logic).

### A. Vehicle theft as a category (build pipeline) — foundational — ✅ DONE
Everything else in the vehicle work hangs off this.

> **Presentation update (2026-08-06):** vehicle theft must render **after** all KR components (the two
> merchant cards *and* the shoplifting concentration map), never beside the KRs. It now lives in a
> `#vehicle-context` section below the map as a **full-width editorial "context band"** — flat, tinted,
> left-railed, with a quiet uppercase "VEHICLE THEFT · Context" kicker, a de-emphasised figure, and a
> wide chart on the right — deliberately **not** the bordered scorecard chrome, so it never reads as a
> co-equal OKR. Implemented via `renderCard`'s `sig.context_only` → `.scorecard--wide` branch (no header
> slot; title becomes an in-band kicker) + `.ctx-band__*` / `.scorecard--wide::part(base|body)` CSS. The
> section heading was thinned to a quiet "Also tracked" divider to avoid a double "Vehicle theft" headline.
> (Rejected alternatives: a width-capped scorecard, and a two-card stat|chart split — both read as *more*
> OKR-like, the opposite of the goal.)

- [build/signals.py](build/signals.py): add a `vehicle` signal, `incident_category='Motor Vehicle Theft'`.
  Note it has **no meaningful arrests axis** (MVT arrests are near-zero) — the card should suppress or
  de-emphasize the arrests context block rather than show a misleading "0".
- Add an `incident_description` → type map (auto / truck / motorcycle / other; recovered+attempted = untyped)
  for the detail section (Workstream B). Bake the type counts (all-time, per district) into `aggregates.json`.
- [js/app.js](js/app.js) `renderCard`: the loop already iterates `AGG.signals`, so a third card renders for
  free once the signal exists — but audit the arrests block and the "share of SF" line for the MVT case.
- Provenance/footnote for the new category ([[dashboard-source-provenance-footnotes]]): runnable query +
  the type-parse method + the ~18% untyped caveat.

### B. Vehicle theft detail section (mockup screenshot 3)
- New section below the cards: **type mix** (horizontal bars, all-time), **hour-of-day** histogram
  (reported hour — label it as such), **top intersections all-time** (bar list, 2018→present so the
  multi-year accumulation is legible). Method note mirroring the mockup.
- All numbers baked at build time into `aggregates.json`; no live client queries for the detail.

### C. Shoplifting concentration map (mockup screenshot 2) — STATIC, not "what moved" — ✅ DONE (2026-08-06)
**Shipped together with E** (the scrubber drives the map's window). New files/artifacts:
- `theft/build/build.py` — `LURIE_MONTH`, `shoplifting_map(district)` + `shoplifting_map_query(district)`
  bake `theft/data/shoplifting-map.json` (51 KB, 342 placed corners across 4 districts): per-district
  arrays of `{i:intersection, lat, lng, m:{ym:count}}`, reported axis, 2021+ floor, sorted by all-time
  volume. Provenance gains `shoplifting_map` (caveat note + per-district runnable query).
- `theft/js/shoplifting-map.js` — self-contained module (`initShopliftingMap`/`setShopliftingDistrict`).
  Leaflet circle markers **area-scaled** by absolute windowed count, a ranked top-12 side list
  (click → zoom+pin), CARTO Voyager/dark tiles theme-swapped on `themechange`, and the shared
  cross-street search (`shared/cross-street-search.js`, `inDistrict` = a district-bbox check). **No
  hot/cold/DiD/baseline** — absolute concentration only.
- `theft/index.html` — Leaflet + `shared/map-search.css` CDN links; a `#shoplifting-map-section` with
  the **mandatory single-store reporting caveat** baked into static HTML (present pre-JS).
- `theft/js/app.js` — `initShopliftingMap(active)` after first render (deferred via IntersectionObserver
  → zero first-paint cost); a new `hashchange` listener re-renders + `setShopliftingDistrict` (in-page
  district switching, previously reload-only).
- **Decisions this build:** ① markers/list use area∝count (`r = 4 + 20·√(n/max)`); ② display corners
  title-cased with `&` (stored `UPPERCASE \ UPPERCASE`); ③ `inDistrict` is a loose bbox (no polygon —
  decision #4 stands); ④ deferred data load keeps it off the CLS budget (reserved map height 460px).
- **Verification:** all 102 Northern corners reconcile **exactly** vs the map's own declared live
  Socrata query; the only 2 deltas are +1 in the **excluded partial month (2026-08)**, never displayed.
  California/Polk (headline corner) = 139 baked = 139 live. Theft e2e now 9/9 (added a map/scrubber test);
  `trace.py theft` still 0.00%.

<details><summary>original C plan (for reference)</summary>

**Scope changed after scrutiny** — see [map-hotspot-findings.md](map-hotspot-findings.md). The
recent-vs-prior "what moved / since Lurie" transition classification is **dropped**: corner-level movement
for shoplifting is reporting-regime churn (a single store's loss-prevention paperwork switching on/off —
Ellis/Webster 0→378→0, California/Polk 0→134), not crime relocating. The [[transition-map-hotcold-method]]
transfers to drug/unhoused only because those aggregate many independent 311/CFS reporters per corner; a
shoplifting corner ≈ one retailer (observer denominator ≈ 1), so no min-count floor rescues it.
- Ship a **static current-window concentration map**: markers sized by absolute report count for the
  scrubber-selected window (Workstream E), plus the ranked top-corners side list. **No hot/cold/emerged
  classification, no DiD, no pre-Lurie baseline comparison.** The scrubber's "Since Lurie" pill shows
  *concentration since Lurie* (absolute), never a vs-before delta.
- Aggregate by the native `intersection` field; coordinates are one-per-corner and clean, so **no
  geocoding / no baked cross-street index needed for placement** (findings confirmed). District-scoped,
  pin/marker only. Shoplifting only (decision #2).
- **Mandatory reporting caveat** in the map copy: "a hot corner ≈ a single store; counts reflect that
  store's reporting, which can switch on/off." Keep neutral, intersection-level tone
  ([[public-github-pages-no-security]]).
- Cross-street search via the shared [[cross-street-search-expansion]] widget (inject resolve/onLocate).
- Note (decision, low marginal value): the ranked list already lives in the findings; the map's added
  value over that list is orientation, not new analysis. Build it lean.
</details>

### D. Day / Night toggle — ❌ DROPPED (see [day-night-findings.md](day-night-findings.md))
Analysis before building it (2026-08-05) showed the toggle is **not illuminative for theft and would be
quietly misleading**: shoplifting (the KR) is ~90% daytime *by definition* (store hours), and the two
categories where "night" would be interesting — commercial & vehicle — are exactly the ones where
**reported hour ≠ occurrence hour** (burglaries discovered next morning; cars noticed whenever the owner
returns), so the split measures reporting behavior, not crime timing. A midnight (hh-0) "unknown time"
artifact further inflates the night side. Day/night works on drug/unhoused only because those are
direct-observation signals (reported ≈ occurrence); theft breaks that assumption.
**Instead:** keep the honest **hour-of-day histogram in the vehicle detail section** (Workstream B),
labeled "reported hour." No toggle, no binary. Net: less code, one fewer misleading affordance.

### E. "Reports over time" scrubber (mockup screenshots 1–2) — ✅ DONE (2026-08-06, with C)
**Shipped in `theft/js/shoplifting-map.js`.** Five preset pills (Last month · Last 3 mo · Last 12 mo ·
Since Lurie · All time, anchored on `lurie_month`) + a **brushable month strip** (pointer-drag to set a
custom window; "Custom window" chip when off-preset). The window drives the static map's aggregation as
an **absolute** "where reports concentrated" view — no pre-Lurie baseline / vs-before delta (that map is
gone). Tuned to theft's fast reported settling per **F**: exactly **one** shaded still-settling month
(the latest complete-but-unsettled month, hatched), plus a Lurie-term-start tick. Default window = Since
Lurie. Presets top out at `latest_complete_month`; the partial month is excluded entirely.

<details><summary>original E plan (for reference)</summary>
- Port [[scrubber-feature-plan]] (built on drug): range pills (Last 1/3/12mo · Since Lurie · All time) +
  brushable custom window. **Reconciled with C's scope change:** the window now drives *which period the
  static concentration map (C) aggregates* — an absolute "where reports concentrated in this window" view.
  There is **no fixed pre-Lurie baseline comparison** anymore (the transition map that needed it is gone);
  "Since Lurie" is just an absolute window preset.
- **Tune the shaded "still settling" tail to theft's fast settling** — reported theft is ~98% at 1 month
  ([[theft-lag-reported-vs-arrests]]), so shade **one** month, not the two copied from CFS/drug. This
  overlaps Workstream F — do F's settling decision first, then wire the shading to it.
</details>

### F. Data-lag follow-on (fold-in from plan-data-lag-research.md) — ✅ DONE (2026-08-05)
**Shipped.** User confirmed the **per-resolution settle** option. Reported headline now evaluates the
latest settled month at **−1** (2026-06); arrests context stays at **−2** (2026-05). Rebuilt stats confirm
the split rationale: REPORTED settles fast (median 0d same-day, **97% ≤30d, p90 6d**, n=408) while ARRESTS
carry the long tail (**p90 242d**, only 78% ≤30d) — exactly why the old mixed p90≈48d over-buffered reports.
- `build/build.py` — `reporting_lag(resolution, …)` now takes a resolution; two constants
  `REPORTED_SETTLE_LAG=1` / `ARREST_SETTLE_LAG=2`; emits `latest_settled_month` (reported),
  `latest_settled_month_arrests`, `settle_lag_months(_arrests)`, `settling` (reported) + `settling_arrests`;
  provenance `settle_note` rewritten to the reported-vs-arrests split.
- `js/app.js` — the arrests context block evaluates at its own settled idx (`latest_settled_month_arrests`),
  so a more-current reported headline never marks provisional arrests as settled (Risk #4). Callout reworded
  to reported-only numbers + an explicit "arrests are different / hold back further" paragraph. Chart shaded
  region auto-follows the reported settled month (now 1 shaded month, not 2).
- **Bonus (not in original plan): E2E trace now covers theft.** The [[e2e-data-trace-harness]] previously
  *skipped* every theft signal ("no Citywide series" — theft stores citywide under `signals[k].citywide.reported`,
  not a `Citywide` district). The plan's Verification claim assumed it reconciled theft, so it now does: build
  bakes a `citywide_query_url` + `dataset_id` per signal, and `validation/trace.py` grew a theft-shape branch.
  Result: shoplifting/commercial/**vehicle** all reconcile against live Socrata at **0.00%** through 2026-06;
  drug/unhoused unchanged; districts still cleanly skips (no query_url).

<details><summary>original F plan (for reference)</summary>

Advance the reported headline one month more current (−2 → −1) with a research-backed caveat, keeping the
slow arrest series conservative. Confirm with user before editing (changes the public site).
- **Root cause:** [build/build.py](build/build.py) `reporting_lag()` computes the baked `settling` stat with
  **no resolution filter**, so its p90≈48d is really the arrest tail (arrests p90=242d), not reported
  (p90=9d). That mixed stat is what justified the 2-month buffer.
- **Changes** (per plan-data-lag-research.md §Follow-on):
  1. `build/build.py` — add `resolution='Open or Active'` to `reporting_lag()` (or return reported + arrests
     separately); the reported-only stat feeds the caveat.
  2. `build/build.py` — `SETTLE_LAG_MONTHS: 2 → 1`. **Decision:** the one global constant also gates the
     shaded chart region, the 2-week anchor, and the arrests context — moving it makes recent arrests look
     settled when they aren't. Lean **(b) a second constant / per-resolution settle** so arrests stay on −2;
     confirm.
  3. `js/app.js` — reword the settling callout with reported-only numbers: *"~98% settled; late-filed reports
     typically add ~2% (rarely >5%)."* Verify the as-of line and "latest settled month" tooltip still read.
  4. Shaded region (`unsettledFromIdx`) auto-follows the new settled month — confirm placement.
  5. `build/build.py` provenance `settle_note` — rewrite to the reported-vs-arrests split.
  6. Optional stretch: projected range band on recent months (confidence gate passed, p10–p90=5.0pts at k=1);
     caveat alone is simpler and sufficient. **(Not shipped — caveat alone deemed sufficient.)**
</details>

## Sequencing

1. **F (data-lag)** — isolated; unblocks E's shading and makes the whole board more current. Do first or parallel.
2. **A (vehicle category)** — foundational for the vehicle card + detail.
3. **B (vehicle detail)** — after A.
4. **C (static concentration map)** + **E (scrubber)** — the scrubber drives the map's aggregation window;
   build together. Lighter than the original transition port (no DiD/baseline/classification), but still
   needs a new baked artifact: per-intersection **monthly** shoplifting counts + one-per-corner coords
   (client sums over the scrubber window), per district. No point-in-polygon, no geojson required.
5. ~~**D (day/night)**~~ — **dropped**; the hour histogram lives in B instead (see Workstream D above).
Header/KR framing (decision #1) is a small edit gated on user sign-off, do once decided.

## Risks & caveats

- **Over-claiming vehicle theft** as a team result (decision #1) — the citywide decline predates and exceeds
  any single team's effort. Frame as context.
- **Single-store reporting regimes** (C) — the reason the transition map was dropped; even the static map
  must caveat that a hot corner ≈ one store whose reporting can switch on/off ([map-hotspot-findings.md](map-hotspot-findings.md)).
- **Hot corner = a named store** — keep intersection-level aggregation + neutral tone ([[public-github-pages-no-security]]).
- **Global settle constant** (F) — don't let a −1 headline silently mark provisional arrests as settled.

## Verification

- `npm test` — theft e2e + the [[e2e-data-trace-harness]] validation. The trace harness reconciles every baked
  number against its declared Socrata query, so the new vehicle signal, detail counts, and changed settle stat
  must all tie out exactly.
- Re-run `python3 analysis/lag_study.py` if the lag pull is stale before shipping F.
- Cross-check the map's baked per-intersection concentration counts against the findings-doc queries.
- CLS: new sections must not regress the homepage/dashboard layout-shift budget ([[layout-shift-plan]]).

## Out of scope

- Snapping SFPD points to the baked intersection index (native field suffices — decision #4).
- Commercial and vehicle theft as recent-vs-prior map layers (data too sparse/diffuse — findings Q1).
- Make/model vehicle detail (SFPD public data stops at type).
- Promoting vehicle theft to a formal KR (leadership call; header stub only).
