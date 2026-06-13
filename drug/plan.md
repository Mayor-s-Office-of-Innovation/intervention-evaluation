# Plan — Drug Activity in San Francisco

**Working title:** "Drug activity — community-reported signals, and whether enforcement reaches dealers"
**Owner:** Aaron · **Drafted:** 2026-06-13
**Status:** 🟡 Planning — analysis-first. Headline signal locked; two data analyses (needles revisit,
dealer-arrest isolation) **pending the SF open-data portal** (`data.sfgov.org` was 503 portal-wide on
2026-06-13 — see §3). Dashboard build deferred until findings are reviewed.

> Living document. Keep it current as we build (see Changelog, §9).

---

## 1. Goal

Give a simple, honest read on **how drug activity in San Francisco is changing over time**, using signals
we can **confidently tie to drugs**, and — separately — whether enforcement is actually reaching **dealers**
rather than churning through users. This is a sibling project to `../unhoused/`: same city, same
analysis-first discipline, same stack. It is the **"drug-use" project** that `../unhoused/` explicitly
deferred needles to (`../unhoused/plan.md` D2).

Two axes, deliberately kept apart (the `../unhoused/` D8 / `../theft/` D11 pattern):

- **Need / presence** — community-reported drug activity (citizen 911 "suspicious person, drug-noted").
  Robust to how hard the city is enforcing. **This is the headline; down = good.**
- **Enforcement / response** — SFPD drug arrests, *narrowed to dealers*. Context, not a clean success
  target (reflexivity: more arrests can mean more enforcement, not less drugs —
  `crime-effectiveness-enforcement-reflexivity`). But a **dealer** arrest is a far more meaningful
  disruption than a user/paraphernalia arrest, so isolating it is the whole point (§ below).

**Companion projects this builds on:**
- **`../../emergent-map/`** — owns the **drug-activity channel definitions** we're reusing (the
  4-channel stack; notebooks `data_sources_drug_activity`, `lurie_drug_activity_shift`,
  `sf_drug_disorder_3d`, `sf311_needle_secular_decline`). The headline signal here is their
  **🔴 CFS Suspicious Person, drug-noted** channel, verbatim.
- **`../unhoused/` / `../districts/`** — the **build pipeline** (`01_pull → 02_assign → 03_rollup →
  04_transitions → 05_markers`, `signals.py` registry, `httpget.py` SSL/503-tolerant fetch,
  point-in-polygon vs `qgnn-b9vv`), the **seasonality-first methodology**, the **fixed-Lurie
  transition map**, and the **frontend stack** (Web Awesome + Leaflet + hand-rolled SVG, no framework).
- **`../theft/`** — the analysis-first discipline + the need-vs-enforcement two-axis framing.

---

## 2. Signal set (proposed — each viewed individually, `../districts/` D4)

| Key | Label | Dataset | Filter | Status / why |
|---|---|---|---|---|
| `cfs_drug` | **Drug activity reports (911, citizen)** — core/headline | SFPD CFS `2zdj-bwza` | `call_type_final_desc='SUSPICIOUS PERSON' AND onview_flag IN ('N','HSOC') AND (upper(call_type_original_notes) LIKE '%DRUG%' OR upper(call_type_final_notes) LIKE '%DRUG%' OR …'%DEALER%' … '%SALES%' … '%METH%')` | **LOCKED — the headline.** emergent-map's 🔴 channel verbatim (`data_sources_drug_activity.md`). ~95% drug-confidence; ~22k events 2023→2026-05; TL/SoMa-concentrated. On-view exclusion keeps it a clean **citizen-perception** signal (officer-initiated calls reflect patrol density, not citizen concern, and double-count into the arrest dataset). DRUG is the workhorse; DEALER+SALES add ~1k marginal (~5%); METH ~redundant but kept. |
| `dealer_arrests` *(enforcement context)* | **SFPD drug-dealer arrests** | SFPD incidents `wg3w-h783` | `incident_category='Drug Offense' AND report_type_description='Initial' AND resolution!='Unfounded'` **+ a dealer-only narrowing on `incident_description`/`incident_subcategory` + an arrest-confirming `resolution`** (TBD — §4) | **PENDING design (§4).** Must isolate **dealing/sales** from possession / under-the-influence / **paraphernalia**. Paraphernalia & simple-possession arrests are catch-and-release churn and are **explicitly excluded** — the user: *"SFPD does a ton of paraphernalia arrests and those people get let out immediately… not anywhere near a success metric."* Framed as the **enforcement axis — context, not a clean success target** (reflexivity). |
| `needles` *(revisit)* | Needle / syringe reports (311) | 311 `vw6y-z8j6` | `service_name='Street and Sidewalk Cleaning' AND ((service_subtype='garbage_and_debris' AND service_details IN ('needles_less_than_20','needles_20_or_more')) OR (service_subtype='Medical Waste' AND service_details='Needles'))` | **PENDING revisit (§5).** emergent-map excluded it from drug-activity proxies because of a ~4× **annual** secular decline (2018→2025, injection→fentanyl-smoking route shift). User's question: is it **stable enough month-to-month over the recent ~2 years** to include as a (caveated) injection-drug indicator? Decide after the live monthly pull. |

**Candidate additional channels (from emergent-map, not yet decided):** 🟣 CFS Intoxicated Person
(`2zdj-bwza`, ~50–60% drug-confidence, small), 🟡 SFFD Medical Examiner fatal-OD (`nuek-vuh3`, the
OD-outcome signal). Held as open questions (§8) — the user named the Susp-Person channel specifically;
these are optional corroboration.

---

## 3. Why the two analyses are pending — the 2026-06-13 portal outage

`data.sfgov.org` returned **HTTP 503 portal-wide** (Tyler "Site Currently Unavailable") on 2026-06-13,
across **every** access path (`/resource/` SoQL, `/api/views/`, `.csv` export) and the portal root,
regardless of User-Agent or dataset. Origin-level nginx 503, no CDN, no `Retry-After` → the Socrata
backend itself was down, not a throttle (a throttle is 429/403 on *our* requests, not a site-wide 503)
and not anything our request could route around. Other SF-open-data apps kept working because they serve
**pre-built/cached** data, not novel live SoQL — same reason our own dashboards would still render.

**Cause confirmed (user, 2026-06-13 ~15:00):** this is a **scheduled Socrata maintenance window**, expected
to last a **few more hours** (back later on 2026-06-13) — not an unplanned outage. Nothing to fix or work
around on our side; just retry after the window. Work resumes in a **new session**.

The headline `cfs_drug` definition needs no live data. The two analyses below (§4 dealer arrests, §5
needles) each need one live pull and are blocked until the window closes. **Their exact runnable queries
are written below so they can be run the moment the portal is back** — first check `wg3w-h783` with a
`$limit=1` to confirm it's up.

---

## 4. PENDING — isolating dealer arrests (the hard one)

**The problem.** emergent-map only ever used `incident_category='Drug Offense'` as a single lump (~17k
events, 2023→2026-05) — it never split **dealing** from **possession / use / paraphernalia**. The user
wants *only* dealer arrests, and **explicitly not** paraphernalia or simple-possession arrests (those are
catch-and-release and worthless as a success metric). So we need a sub-classification emergent-map never
built. We also need to confirm the record is an **actual booking**, not a citation.

**Step 1 — get the taxonomy (run when portal is up).** Break Drug Offense down by description × resolution:

```
# subcategory × description counts, 2023+
https://data.sfgov.org/resource/wg3w-h783.json?$select=incident_subcategory,incident_description,count(*) AS n
  &$where=incident_category='Drug Offense' AND report_type_description='Initial'
          AND resolution!='Unfounded' AND incident_datetime >= '2023-01-01T00:00:00'
  &$group=incident_subcategory,incident_description &$order=n DESC &$limit=200

# how each description resolves (booked vs cited vs none) — cross-tab
https://data.sfgov.org/resource/wg3w-h783.json?$select=incident_description,resolution,count(*) AS n
  &$where=incident_category='Drug Offense' AND report_type_description='Initial'
          AND resolution!='Unfounded' AND incident_datetime >= '2023-01-01T00:00:00'
  &$group=incident_description,resolution &$order=n DESC &$limit=400
```

(SoQL note: send these via `../unhoused/build/httpget.py`; URL-encode in code. Avoid the Socrata MCP for
literals containing "from" — `socrata-mcp-from-parsing-bug`.)

**Step 2 — design the filter (hypothesis to verify against Step 1's actual values).** SFPD drug
descriptions typically distinguish sale/dealing from possession/use. Expected split:

- **INCLUDE (dealer):** descriptions containing `SALE` / `SALES`, `POSSESSION … FOR SALE`,
  `DELIV`(ery), `FURNISH`, `TRANSPORT`, `MANUFACTUR`, `TRAFFIC`(king). These are intent-to-distribute.
- **EXCLUDE (user / churn — NOT dealers):** `PARAPHERNALIA`, `UNDER THE INFLUENCE`, simple
  `POSSESSION OF CONTROLLED SUBSTANCE` / `POSSESSION OF NARCOTIC` **without** "for sale",
  marijuana-personal, `PRESENCE WHERE … USED`.
- ⚠️ Verify the **exact strings** against Step 1 — SFPD's `incident_description` wording is idiosyncratic
  and these LIKE patterns are a hypothesis, not confirmed values.

**Step 3 — confirm it's a real arrest.** Cross with `resolution`. Candidate stance: count
`resolution='Arrest, Booked'` as the dealer-arrest metric and treat `'Cite or Arrest Adult'` /
`'Arrest, Cited'` (cite-and-release) separately or excluded — a booked dealer is the meaningful
disruption; a cited one is the churn the user is dismissing. Confirm which resolution values actually
co-occur with sale descriptions in Step 1's cross-tab before locking this.

**Framing (locked regardless of the filter).** Even cleanly isolated, dealer arrests are an
**enforcement-activity** measure, subject to the reflexivity trap (more arrests ≠ fewer drugs;
`crime-effectiveness-enforcement-reflexivity`). So: **context / enforcement axis, never the standalone
success metric.** The headline read on the problem is `cfs_drug` (citizen-reported, enforcement-robust).
Dealer arrests answer a *different, narrower* question the user cares about — "is enforcement hitting
suppliers or just recycling users?" — and that's how they'll be labeled.

---

## 5. PENDING — needle revisit (annual decline vs recent monthly stability)

emergent-map excluded needles from drug-activity proxies (`sf311_needle_secular_decline.md`): a ~4×
decline 2018→2025 driven by the **injection→fentanyl-smoking route shift**, so using them in pre/post
policy comparisons falsely inflates "improved." **That verdict was about the multi-year annual trend.**

The user's question is different and sharper: *over the recent ~2 years, monthly needle reports look
relatively stable — stable enough to include (caveated)?* If the secular cliff has flattened into a
roughly level recent plateau, needles could serve as a **standalone injection-drug indicator** (clearly
labeled as route-specific, never summed into the headline) without distorting a Lurie-era read.

**Run when portal is up** (continuous combined-taxonomy series, monthly, 2022→now):

```
https://data.sfgov.org/resource/vw6y-z8j6.json?$select=date_trunc_ym(requested_datetime) AS ym,count(*) AS n
  &$where=service_name='Street and Sidewalk Cleaning'
     AND ((service_subtype='garbage_and_debris' AND service_details IN ('needles_less_than_20','needles_20_or_more'))
          OR (service_subtype='Medical Waste' AND service_details='Needles'))
     AND requested_datetime >= '2022-01-01T00:00:00'
  &$group=date_trunc_ym(requested_datetime) &$order=ym &$limit=200
```

**Decision rule (set in advance to avoid post-hoc rationalizing):** compute the trailing-24-month
monthly series; if the **slope is shallow** (e.g. trailing-12-mo vs prior-12-mo change within ±~15%,
no sustained YoY cliff) **and** the within-year seasonal pattern is the dominant variation, then needles
qualify as a caveated standalone indicator. If a steep YoY decline persists into the recent window, keep
them **excluded** from any trend comparison (emergent-map's verdict stands). Either way, document the
monthly chart publicly with the route-shift caveat (D7). *Per-neighborhood (TL/Mission/SoMa) check
optional once citywide is decided.*

---

## 6. Method & architecture (reuse `../unhoused/` / `../districts/` wholesale)

Same pipeline, a drug-specific signal registry. No new techniques.

```
drug/
  plan.md                  ← this file
  build/ (when we proceed — copy ../unhoused/build, swap signals.py)
    signals.py             ← cfs_drug (headline) + dealer_arrests + needles (if §5 passes)
    01_pull.py 02_assign.py 03_rollup.py 04_transitions.py 05_markers.py  ← ~unchanged
    httpget.py             ← SSL + 503-tolerant fetch (unchanged; consider adding retry/backoff)
    provenance.json
  data/
    aggregates.json        ← per-signal monthly series per geo + citywide
    points/<signal>.json   ← compact coded tuples, lazy-loaded
    markers/<signal>.json  ← zoom-in individual report markers w/ detail fields
    police_districts.geojson
  index.html styles.css js/  ← copy frontend; relabel for drug
  tests/e2e.spec.js
```

- **Geometry:** CFS (`2zdj-bwza`) coords in `intersection_point`; SFPD incidents (`wg3w-h783`) have
  `intersection` text + `latitude`/`longitude` (verify on pull); 311 (`vw6y-z8j6`) plain `lat`/`long`.
  Point-in-polygon vs `qgnn-b9vv` for police district (CFS also carries a native `police_district`).
- **Rollup:** monthly counts + same-season YoY + trailing-12-mo trend + partial-current-month excluded,
  per signal, per geo + citywide.
- **Transition map (if built):** the fixed-Lurie (2025-01-08) hot/cold transition map from `../unhoused/`
  D11/D12 — built on the **presence** signal (`cfs_drug`), not enforcement.
- **Settling lag:** CFS + 311 are creation-stamped (no lag — `../unhoused/` D13). But `wg3w-h783`
  **incident reports DO settle** (report-approval lag, median 0d / p90 ~48d — `sfpd-incident-dataset`,
  `../theft/`). So `dealer_arrests` needs the theft-style recent-month buffer; `cfs_drug` does not. **Two
  different freshness rules in one project** — don't apply one blanket buffer.

---

## 7. Decisions locked

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Headline signal = `cfs_drug` (CFS Suspicious Person, drug-noted), emergent-map's 🔴 channel verbatim.** | User's explicit ask. ~95% drug-confidence, citizen-perception, enforcement-robust. The clean measure of the *problem*. |
| D2 | **Need vs. enforcement kept on separate axes** (`../theft/` D11 / `../unhoused/` D8). Presence (`cfs_drug`, ↓=good) is the headline; dealer arrests are enforcement *context*. | Arrest counts are reflexive (`crime-effectiveness-enforcement-reflexivity`); the robust read is citizen-reported. |
| D3 | **`dealer_arrests` must isolate dealing/sales and EXCLUDE paraphernalia + simple possession + under-the-influence.** Confirm an actual booking via `resolution`. | User: paraphernalia/possession arrests are catch-and-release churn, "not anywhere near a success metric." We only want supplier disruption. Filter pending live taxonomy (§4). |
| D4 | **Dealer arrests are enforcement context, never the standalone success target** — even cleanly isolated. | Reflexivity. They answer "is enforcement hitting suppliers vs recycling users," a narrower question than "is the drug problem improving." |
| D5 | **Needle inclusion is conditional on the §5 recent-monthly-stability test**, with a pre-registered decision rule; route-shift caveat shown publicly either way. | The user flagged that the annual-decline verdict may not hold at recent monthly resolution. Decide on data, not vibes. |
| D6 | **Reuse `../unhoused/` pipeline + frontend + boundaries**, drug-specific registry. | No new methods; consistency + speed. |
| D7 | **Public "what's included & why" methodology footnote**, generated from `provenance.json`; every signal (and every component of a combined one) names dataset (id+name) + links its exact runnable Socrata query; dealer-arrest inclusion/exclusion logic and the needle route-shift caveat shown openly. | `../unhoused/` D7 / `../theft/` D9 / emergent-map repro convention. Combined/filtered signals are opaque unless their parts + queries are visible. |
| D8 | **Two freshness rules in one project:** `cfs_drug` (CFS, creation-stamped) excludes only the partial current month; `dealer_arrests` (`wg3w-h783` incident reports) carries the theft-style report-approval settling buffer. | `sfpd-incident-dataset` / `../theft/` lag is real and specific to incident reports; CFS has none (`../unhoused/` D13). One blanket buffer would be wrong for one of them. |

---

## 8. Open questions (to resolve before / during build)

- **Dealer-arrest filter specifics** — exact `incident_description` strings + which `resolution` values
  count (booked-only vs include cite). Pending §4 Step-1 taxonomy.
- **Needle inclusion** — pending the §5 monthly pull + decision rule.
- **Geographic scope.** `../unhoused/` used 4 police districts (Central, Northern, Mission, Tenderloin).
  Drug activity is most concentrated in **Tenderloin + SoMa (Southern district)** + Mission, with the
  Hayes Valley/Koshland corridor (Northern). Confirm the district set — likely **Tenderloin, Southern,
  Mission, (Northern)** — differs from unhoused's. Citywide as baseline.
- **Extra channels** — add 🟣 Intoxicated Person and/or 🟡 SFFD ME fatal-OD as corroboration, or keep to
  the single citizen Susp-Person headline + dealer-arrest context?
- **Map** — build the fixed-Lurie transition map on `cfs_drug`, or start as a trend monitor only?
- **Standalone site vs. fold into the constellation** (`sf-civic-dashboard-constellation` convention).
  Default: standalone, mirroring `../unhoused/` D10.
- **httpget hardening** — add retry/backoff (and optionally a Socrata app token) given today's 503; cheap
  insurance, would not have helped today (backend was down) but smooths transient throttles.

---

## 9. Changelog

- **2026-06-13** — Project kicked off as the **drug-activity sibling** of `../unhoused/` (which deferred
  needles here, its D2). **Locked the headline signal** = emergent-map's 🔴 CFS Suspicious Person
  drug-noted channel verbatim (D1), and the **need-vs-enforcement two-axis framing** (D2/D4). Scoped two
  analyses to run when the portal recovers: **(§4) isolate dealer arrests** from possession/use/
  **paraphernalia** in `wg3w-h783` (exact taxonomy/cross-tab queries written; filter is a hypothesis
  pending the live values; paraphernalia & simple-possession explicitly excluded per the user — D3), and
  **(§5) revisit needles** at recent monthly resolution against a pre-registered stability rule (D5).
  Noted the **two-freshness-rules** subtlety (CFS none, incidents settle — D8). **Blocked on a
  portal-wide `data.sfgov.org` 503 outage** (§3) — diagnosed as origin-level, not throttling/our request;
  headline needs no live data, the two analyses do. Wrote this scaffold; live pulls deferred to next
  session at the user's request.
- **2026-06-13** — **Inherit the unhoused chart legend.** `../unhoused/` added a legend under its
  "Reports over time" chart keying the overlay lines (12-mo trend / a-year-earlier / citywide-scaled) —
  swatches reuse the chart's stroke/fill classes so they stay in sync. When this project builds its
  `cfs_drug` trend chart (same hand-rolled `chart.js`), **port that legend with it** — any chart carrying
  >1 overlaid line needs the key, or readers can't decode the lines.
</content>
</invoke>
