# Plan — Drug Activity in San Francisco

**Working title:** "Drug activity — community-reported signals, and whether enforcement reaches dealers"
**Owner:** Aaron · **Drafted:** 2026-06-13
**Status:** 🟢 **v1 dashboard shipped** (2026-06-13). Analyses complete; both pending analyses ran against
live data (§4 dealer isolation, §5 needles → excluded). Dashboard built on the `../unhoused/` stack: two
co-headline cards (drug reports ↓ / dealer arrests ↑, D9), the **"what drug arrests are made of"** composition
(the paraphernalia-vs-dealer story), the fixed-Lurie **displacement map** on `cfs_drug`, needles shown
citywide+caveated, and the two required footnotes (excluded arrest types, needle exclusion). See §11.

**Follow-on work (cross-cutting) → [plan-scrubber.md](plan-scrubber.md).** The **time scrubber + validation
hardening** generalized the displacement map into a *parametric* difference-in-differences (any analysis
window vs the fixed pre-Lurie baseline), made the chart the scrubber, extracted the shared `../shared/` lib,
brought the feature to `../unhoused/`, and added a CI validation suite (build invariants, classifier parity,
e2e gate, nightly source↔data trace). **Start at [plan-scrubber.md](plan-scrubber.md) for that chain of work
and its current status.**

> Living document. Keep it current as we build (see Changelog, §9).

---

## 1. Goal

Give a simple, honest read on **how drug activity in San Francisco is changing over time**, using signals
we can **confidently tie to drugs**, and — separately — whether enforcement is actually reaching **dealers**
rather than churning through users. This is a sibling project to `../unhoused/`: same city, same
analysis-first discipline, same stack. It is the **"drug-use" project** that `../unhoused/` explicitly
deferred needles to (`../unhoused/plan.md` D2).

**TWO co-headline cards** (this project's deliberate departure from the usual signal-not-target rule — see D9):

- **Card 1 — Drug-activity reports (`cfs_drug`), ↓ = good.** Community-reported drug activity (citizen 911
  "suspicious person, drug-noted"). Robust to how hard the city is enforcing. The clean read on the *problem*.
- **Card 2 — Dealer arrests (`dealer_arrests`), ↑ = good — a goal to work toward.** SFPD drug arrests
  narrowed to dealers (§4 filter). **Normally** PD activity is signal-not-success-metric (reflexivity:
  more arrests can mean more enforcement, not fewer drugs — `crime-effectiveness-enforcement-reflexivity`).
  **But given the severity of the fentanyl epidemic, dealer arrests need to rise *massively* to make a dent
  in supply, so here we elevate it to a success target we want up** (D9). Reflexivity caveat retained as a
  footnote, not as a reason to demote the card. (Note: the §4 data shows dealer arrests currently
  **flat-to-down** while paraphernalia churn tripled — i.e. by this goal the city is *not* making the dent;
  that gap is the dashboard's central, honest story.)

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
| `dealer_arrests` *(co-headline, ↑=good — D9)* | **SFPD drug-dealer arrests** | SFPD incidents `wg3w-h783` | `incident_category='Drug Offense' AND report_type_description='Initial' AND resolution!='Unfounded'` **+ a dealer-only narrowing on `incident_description`/`incident_subcategory` + an arrest-confirming `resolution`** (TBD — §4) | **PENDING design (§4).** Must isolate **dealing/sales** from possession / under-the-influence / **paraphernalia**. Paraphernalia & simple-possession arrests are catch-and-release churn and are **explicitly excluded** — the user: *"SFPD does a ton of paraphernalia arrests and those people get let out immediately… not anywhere near a success metric."* Framed as the **enforcement axis — context, not a clean success target** (reflexivity). |
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

## 4. ✅ RESOLVED — isolating dealer arrests

**Run 2026-06-13 against live `wg3w-h783` (17,502 Drug Offense "Initial", non-Unfounded, 2023→2026-06).**

### Result 1 — the resolution field is coarser than hypothesized (Step 3 correction)
`wg3w-h783.resolution` has **only 4 values dataset-wide**: `Open or Active` (813k), `Cite or Arrest Adult`
(217k), `Unfounded` (5k), `Exceptional Adult` (3k). **There is NO `Arrest, Booked` vs `Arrest, Cited`
split** — cite and arrest are lumped into one value. So Step 3 ("confirm a real *booking* via resolution")
**cannot be executed** — the data can't distinguish a booked dealer from a cite-and-release one. The
**description-level filter is the only lever** for isolating dealers; `resolution='Cite or Arrest Adult'`
just confirms an enforcement action occurred (vs `Open or Active` = report only). **D3 amended accordingly.**

### ⚠️ Result 0 — DEDUP BY `incident_id` IS MANDATORY (counts were 2× inflated)
`wg3w-h783` carries **one row per charge/code**, not per arrest: 17,502 Drug-Offense rows = **12,269
distinct incidents** (avg 1.43 rows/incident, max 3). A dealer caught with meth + cocaine + heroin produces
**3** `Possession For Sale` rows. **Row-level dealer counts (5,474) were ~2× the true incident count (2,751)**
— always dedup by `incident_id` ([[sfpd-incident-dataset-wg3w-h783]]). All numbers below are
**incident-level**. Cross-check: only **98 incidents** carry *both* a dealer and a paraphernalia charge, so
the two buckets are essentially disjoint arrests — the paraphernalia surge is **not** dealers being
double-tagged, which strengthens Result 3.

### Result 2 — locked dealer filter (verified against live `incident_description` values)
`incident_category='Drug Offense' AND report_type_description='Initial' AND resolution='Cite or Arrest Adult'`
**AND `incident_description` matches a dealing/distribution pattern:**
- **INCLUDE:** `*Possession For Sale`, `*Sale`/`*Sales`, `*Transportation`/`Transporting`, `Furnishing`,
  `Cultivating/Planting`, `Maintain Premise Where Narcotics Are Sold/used`, `Drug Lab Apparatus`,
  `Money Offense Related to Narcotics Trafficking`, `Sales of Cocaine Base/Schoolyard Trafficking`.
  (LIKE keys: `FOR SALE`, `SALE`, `TRANSPORT`, `FURNISH`, `DELIV`, `MANUFACTUR`, `TRAFFIC`, `CULTIVAT`,
  `MAINTAIN PREMISE`, `MONEY OFFENSE`, `DRUG LAB APPARATUS`.)
- **EXCLUDE:** `Narcotics Paraphernalia, Possession of`, `*, Under the Influence of`, `Loitering Where
  Narcotics are Sold/Used` + `Controlled Substance Violation, Loitering for`, `Presence Where Used`,
  `Narcotics Addict, Failure To Register`, `Hypodermic Needle…Possession`, `Prescription, Forge Or Alter`,
  **and the ambiguous bare `* Offense` buckets** (`Methamphetamine Offense`, `Opiates Offense`,
  `Controlled Substance Offense`, etc. — these don't state sale, so they're excluded from a *dealer* metric).

This yields **2,751 distinct dealer incidents 2023→2026-06** (vs 12,269 all Drug-Offense incidents — 22%),
running **~45–70/mo** in 2025-26.

### Result 3 — the headline finding (validates the whole two-axis thesis, D2/D4)
Composition by year (**incident-level, deduped**; priority dealer > paraphernalia > other):

| Bucket | 2023 | 2024 | 2025–26 (18mo) |
|---|---:|---:|---:|
| **dealer (sale/transport/etc.)** | **972 (42%)** | 797 (31%) | **982 (13%)** |
| paraphernalia | 877 (38%) | 1,031 (41%) | **5,283 (71%)** |
| other "Offense" (poss/use, ambig) | 383 | 340 | 781 |
| loitering / presence | 12 | 337 | 364 |
| under the influence | 54 | 27 | 29 |
| **total drug incidents** | 2,298 | 2,532 | **7,439** |

**Total drug enforcement roughly tripled into 2025-26, but the growth is almost entirely `Narcotics
Paraphernalia, Possession of` (877 → 5,283 — now 71% of all drug incidents). Dealer arrests are flat-to-down**
(~970/yr-rate in 2023 → ~650/yr-rate in 2025-26; ~85/mo → ~55/mo). This is the user's hypothesis confirmed in
the data: the "drug crackdown" headline is catch-and-release churn (paraphernalia), **not** supplier
disruption. Keeping the two axes apart (D2) and isolating dealers (D3) is what makes this visible — a single
`Drug Offense` lump would show enforcement *rising* and hide that dealer disruption is flat-to-down.

### Result 4 — geography (answers the §8 district-scope question)
Dealer incidents by police district (deduped): **Tenderloin 1,919 (70%)**, Southern (SoMa) 302, Northern 163,
Mission 161, Central 92, all others <50. → district set for the build: **Tenderloin, Southern, Mission,
Northern**, citywide baseline (Tenderloin dominant — even more concentrated than unhoused).

> **Settling-lag note (D8):** 2026-06 is a partial + still-settling month (report-approval lag,
> `sfpd-incident-dataset`) — exclude from trend reads. The dealer series needs the theft-style recent-month
> buffer; `cfs_drug` (CFS) does not.

<details><summary>Original PENDING design notes (superseded by the results above)</summary>

## 4-orig. PENDING — isolating dealer arrests (the hard one)

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

**Framing (~~locked regardless of the filter~~ — SUPERSEDED by D9; dealer arrests are now a co-headline
success target we want UP).** Even cleanly isolated, dealer arrests are an **enforcement-activity** measure,
subject to the reflexivity trap (more arrests ≠ fewer drugs; `crime-effectiveness-enforcement-reflexivity`).
~~So: context / enforcement axis, never the standalone success metric.~~ (Reflexivity now kept as a footnote
caveat only — D9.) The headline read on the problem is `cfs_drug` (citizen-reported, enforcement-robust).
Dealer arrests answer a *different, narrower* question the user cares about — "is enforcement hitting
suppliers or just recycling users?" — and that's how they'll be labeled.

</details>

---

## 5. ✅ RESOLVED — needle revisit → EXCLUDED, then REMOVED from the dashboard entirely

**Final disposition (2026-06-13, v1 build):** needles are **not shown on the dashboard at all** — removed,
with a methodology footnote explaining why (+ a runnable query so the claim is verifiable). The citywide
"show it caveated" option was tried first but read as confusing (an "excluded" chart is a mixed message), so
the user called to pull it. Before removing, we ran the **per-district check** that had been left open below —
to see if any district bucked the citywide decline (a Northern *rise* would have been worth showing). It
didn't: every district is flat-to-down, just the route-shift decline at different speeds:

| District | needle-report YoY (trailing-12 vs prior-12, to 2026-05) |
|---|---|
| Northern | **−26%** (fastest decline) |
| Central | −15% |
| Tenderloin | −17% |
| Mission | −2% (slowest, but still not rising) |
| Citywide | −18% |

No district-level signal + high misread risk → **leave needles out**, don't caveat a misleading chart. The
`needles` signal stays in the build for **provenance only** (the footnote links its query); it is never a
chart series, never trended, never summed. (The original pre-registered-rule analysis is retained below.)

---

## 5-orig. ✅ RESOLVED — needle revisit → keep EXCLUDED (failed the pre-registered rule)

**Run 2026-06-13 against live 311 `vw6y-z8j6` (combined-taxonomy monthly, 2022→now).**

Applying the **pre-registered decision rule (D5)** to the complete-month series (last complete = 2026-05):
- **trailing-12 (2025-06 … 2026-05): 2,300** needle reports
- **prior-12 (2024-06 … 2025-05): 2,842**
- **YoY change: −19.1%** — **outside the ±15% band.**

**Decision: keep needles EXCLUDED** from any trend/Lurie-era comparison. emergent-map's verdict stands: the
secular decline (injection→fentanyl-smoking route shift) has **decelerated** (from ~4×/yr historically to
−19%/yr now) but has **not flattened** into the level plateau the inclusion rule required. A −19% drift would
still falsely inflate a "drugs improved" read. Per D5, the monthly chart is **documented publicly with the
route-shift caveat either way** (it's an honest injection-route indicator, just not a trend-comparison input).
Recent monthly range ~150–252 (mean ~200), seasonally noisy.

<details><summary>Original PENDING analysis notes</summary>

## 5-orig. PENDING — needle revisit (annual decline vs recent monthly stability)

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

</details>

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
| D3 | **`dealer_arrests` isolates dealing/sales and EXCLUDES paraphernalia + simple/ambiguous possession + under-the-influence + loitering.** ~~Confirm an actual booking via `resolution`.~~ **AMENDED 2026-06-13:** `wg3w-h783.resolution` has no booked-vs-cited split (only `Cite or Arrest Adult`), so booking can't be confirmed — `resolution='Cite or Arrest Adult'` just gates "enforcement action occurred." Filter **locked** in §4 (5,474 arrests, 31% of Drug Offense). | User: paraphernalia/possession arrests are catch-and-release churn, "not anywhere near a success metric." We only want supplier disruption. |
| D4 | ~~Dealer arrests are enforcement context, never the standalone success target.~~ **SUPERSEDED by D9 (2026-06-13).** | (Original rationale: reflexivity. Now overridden for this project — see D9.) |
| D9 | **Dealer arrests are a co-headline SUCCESS TARGET we want to go UP** (alongside `cfs_drug` ↓). Two top cards: drug-activity reports ↓=good, dealer arrests ↑=good. | User's call: the fentanyl epidemic is severe enough that supply disruption must rise *massively* to make a dent, so — exceptionally — we elevate dealer arrests from context to a goal. Reflexivity caveat kept as a footnote (a spike could be effort not supply), but it no longer demotes the card. The §4 finding (dealers flat-to-down while paraphernalia tripled) makes this the dashboard's central story: the metric we *want* up isn't moving. |
| D5 | ~~Needle inclusion is conditional on the §5 stability test; route-shift caveat shown publicly either way.~~ **AMENDED 2026-06-13:** needles **removed from the dashboard entirely** (not shown caveated). Failed the stability rule (−18% citywide), AND a per-district check found no district rising (Northern −26% … Mission −2%) — so there's nothing to show but the misleading route-shift decline. Kept in the build for provenance only; explained in a footnote. | Decide on data: the per-district analysis closed the last "maybe it's interesting locally" door. A caveated "excluded" chart read as confusing; a footnote is cleaner and less misleadable. |
| D6 | **Reuse `../unhoused/` pipeline + frontend + boundaries**, drug-specific registry. | No new methods; consistency + speed. |
| D7 | **Public "what's included & why" methodology footnote**, generated from `provenance.json`; every signal (and every component of a combined one) names dataset (id+name) + links its exact runnable Socrata query; dealer-arrest inclusion/exclusion logic and the needle route-shift caveat shown openly. | `../unhoused/` D7 / `../theft/` D9 / emergent-map repro convention. Combined/filtered signals are opaque unless their parts + queries are visible. |
| D8 | **Two freshness rules in one project:** `cfs_drug` (CFS, creation-stamped) excludes only the partial current month; `dealer_arrests` (`wg3w-h783` incident reports) carries the theft-style report-approval settling buffer. | `sfpd-incident-dataset` / `../theft/` lag is real and specific to incident reports; CFS has none (`../unhoused/` D13). One blanket buffer would be wrong for one of them. |

---

## 8. Open questions (to resolve before / during build)

- ✅ **Dealer-arrest filter specifics** — RESOLVED §4: filter locked; resolution can't confirm booking.
- ✅ **Needle inclusion** — RESOLVED §5: excluded (−19.1% YoY fails the rule); chart shown with caveat.
- ✅ **Geographic scope** — RESOLVED §4 Result 4: **Tenderloin (72%), Southern, Mission, Northern**,
  citywide baseline. (TL even more dominant than in unhoused.)
- **Extra channels** — add 🟣 Intoxicated Person and/or 🟡 SFFD ME fatal-OD as corroboration, or keep to
  the single citizen Susp-Person headline + dealer-arrest context?
- ✅ **Map** — RESOLVED (2026-06-13): **build the fixed-Lurie hot/cold transition map on `cfs_drug`**
  (the unhoused reference impl, [[transition-map-hot-cold-method]]). User: *the movement of drug users is a
  critical component — the city spends heavily moving people around, so the displacement map matters.*
  Map is built on the **presence** signal only (never enforcement, D2). → base the build on `../unhoused/`
  (has the map + marker drill-down), not the map-less `../theft/`; borrow theft's settling-buffer handling
  for the `wg3w-h783` arrest signals.
- ✅ **Map baseline — keep IDENTICAL to unhoused** (2026-06-13). User noticed the drug map is "all emerged"
  except Tenderloin-persistent and asked whether to switch to a recent rolling baseline. **Reviewed: unhoused
  is emerged-dominant too** (108/48/42 for 911 presence) — same fixed-Lurie d-i-d, same shape; not a bug. The
  emerged-heaviness is the real spread-since-2023 story (a ~2yr baseline + district-tide normalization), and
  the per-district skew (only TL persistent) is because TL's level barely changed (tide ×1.36) while Mission
  grew ×5.7. **Decision: keep drug on the fixed-Lurie baseline, keep the Lurie wording**, and **explain the
  method + the emerged-heaviness clearly in a methodology footnote** ("The hotspot map — how to read it" +
  a "why most blocks read emerged" caveat). No classifier change.
- **Standalone site vs. fold into the constellation** (`sf-civic-dashboard-constellation` convention).
  Default: standalone, mirroring `../unhoused/` D10.
- **httpget hardening** — add retry/backoff (and optionally a Socrata app token) given today's 503; cheap
  insurance, would not have helped today (backend was down) but smooths transient throttles.

---

## 10. Next decision — build

Both analyses are done; the dashboard build (§6) is the open call. Proposed default, mirroring `../unhoused/`:
copy `../unhoused/build`, swap `signals.py` for `cfs_drug` (headline, ↓=good) + `dealer_arrests`
(enforcement context, with the §4 filter) + `needles` (standalone caveated, excluded from trends), run the
5-step pipeline over **Tenderloin/Southern/Mission/Northern + citywide**, port the frontend + chart legend.
**The paraphernalia-vs-dealer split (§4 Result 3) is the story the dashboard should make legible** — likely a
stacked "what the drug-arrest surge is actually made of" view alongside the `cfs_drug` headline. Open sub-q's:
extra corroboration channels (🟣 Intoxicated, 🟡 fatal-OD), transition map vs trend monitor, standalone vs
constellation.

**Build TODOs (carry into the build):** — ✅ all done in v1 (§11).
- [x] **Needle-exclusion footnote.** Public methodology footnote stating *why* needles are excluded from the
  trend read: route shift (injection→fentanyl-smoking), the −19.1% trailing-vs-prior-12 result vs the ±15%
  rule, and that the monthly chart is still shown as a route-specific injection indicator, never summed into
  the headline (D5/D7).
- [ ] **Excluded-arrest-types footnote (on the dealer card).** Public footnote naming the Drug-Offense arrest
  types we **leave out** of `dealer_arrests` and why. Excluded (incident-level 2025-26 share): **paraphernalia
  possession (71%)**, ambiguous `* Offense` possession/use buckets (10%), loitering/presence (5%), under-the-
  influence (0%). Rationale: these are **catch-and-release — they rarely lead to charges/prosecution**, so they
  measure enforcement *churn*, not supply disruption, and would dilute a metric we want to read as dealer
  pressure. **Honesty caveat to include verbatim:** `wg3w-h783` records the *arrest*, not the DA's charging
  outcome — the "doesn't lead to charges" rationale is documented SF declination/diversion practice for these
  offense types, **not** something this dataset proves; we exclude on **charge type**, and the no-charge
  outcome is the policy reality that justifies it. Pairs with the §4-Result-3 composition viz (D3/D7/D9).
- [x] **Dealer pipeline MUST dedup by `incident_id`** — done via SoQL `count(distinct incident_id)` (verified
  = 2,576, matches the client-side dedup).
- [x] **Paraphernalia-vs-dealer split is the centerpiece viz** — the "What drug arrests are made of" stacked
  panel + a live composition lead.

## 11. v1 build (shipped 2026-06-13)

Built on the `../unhoused/` stack (chosen over map-less `../theft/` once the **displacement map** was made a
requirement — user: the city spends heavily moving drug users around, so movement is core). Files:
`drug/build/{signals,01_pull,02_assign,03_rollup,04_transitions,05_markers}.py`, `drug/{index.html,styles.css}`,
`drug/js/{app,chart,rollup,data,transition-map}.js`, data in `drug/data/`.

**Signals (5) + districts (Tenderloin/Southern/Mission/Northern + Citywide):**
- `cfs_drug` — point signal (2zdj-bwza), headline ↓, feeds the map. ~23k events.
- `dealer_arrests` — agg signal (wg3w-h783), headline ↑ (D9). **2,576 incidents** (count(distinct incident_id)).
- `paraphernalia` (7,097) + `other_drug_arrests` (4,008) — agg signals, the composition's churn layers.
- `needles` (vw6y-z8j6) — **removed from the dashboard** (§5); kept in the build for the footnote's query
  link only. Per-district check found no district rising → nothing to show but the route-shift decline.

**Two signal kinds in one pipeline:** "point" (raw pull → point-in-polygon → map) vs "agg_only" (03_rollup
fetches pre-grouped `count(distinct id)` by month×native-`police_district`; casing canonicalized — 2zdj UPPER,
wg3w Title). Composition = `arrest_mix` group (dealer/para/other stacked; ~1% dealer∩para overlap noted).

**Settling correction (supersedes the D8 assumption):** measured wg3w-h783 drug-arrest report lag = **median
0d / p90 0d** — arrests are officer-generated and reported same-day, so they barely settle (unlike theft's
victim reports). Dropped the buffer to a light **1-month** hedge; CFS/311 hold back only the partial month.

**What v1 shows:** the composition lead renders the finding live — e.g. *"In Apr 2026, Tenderloin drug arrests
were 63% paraphernalia and only 13% dealer; over the past year dealer ▼5%, paraphernalia ▲147%."*

**Tunable / follow-ups:** map `HOT_RATE=2.0`/mo gives 12 persistent / 16 cooled / **69 emerged** — emergence
dominates (drug activity spreading; Mission tide ×5.7), honest but worth eyeballing/raising the bar (D12).
Verified headless (no console errors; cards, chart, 126-rect stacked composition, 25 map hotspots, all 4
methodology sections). Not yet wired into the constellation index / deployed.

## 9. Changelog

- **2026-06-13 (map marker fixes)** — Zoom-in markers: (1) surfaced the **drug-match notes**
  (`call_type_original_notes`/`call_type_final_notes`) in the overlay so a "Suspicious Person" call shows WHY
  it counts as drug activity; (2) **grouped co-located reports** into one count marker (CFS snaps coords to the
  intersection, stacking dozens on one point) — overlay now says "N reports here · X recent · most recent
  <date>". Fixes the grey↔red flicker (markers hidden/recolored by draw order at different zooms). Ported the
  same marker fix to `../unhoused/` (same bug). Confirmed individual markers appear at the same zoom (z17) as
  unhoused (identical `transition-map.js`).
- **2026-06-13 (post-ship tweaks)** — District set corrected to **Northern / Mission / Central / Tenderloin**
  (dropped Southern, per user — matches the unhoused set); default district = Northern. **Needles removed
  from the dashboard** (D5 amended): the caveated citywide chart read as confusing, and a per-district check
  (Northern −26%, Central −15%, Tenderloin −17%, Mission −2%, none rising) found no local signal worth showing
  — replaced with a methodology footnote (+ query link); the signal stays in the build for provenance only.
- **2026-06-13 (v1 build shipped)** — Built the dashboard on the `../unhoused/` stack (§11). Two co-headline
  cards (D9), the paraphernalia-vs-dealer composition, the fixed-Lurie displacement map on `cfs_drug`, needles
  citywide+caveated, and both required footnotes. New mixed-kind pipeline (point vs agg_only) with SoQL
  `count(distinct incident_id)`. **Corrected the D8 settling assumption** — measured drug-arrest report lag is
  ~0d (officer-generated), so the theft-style 2-mo buffer was wrong; cut to a 1-mo hedge. Resolved the map
  open-question (build it, on presence). Verified headless, no errors.
- **2026-06-13 (portal restored, same day)** — **Ran both pending analyses.** §4 dealer arrests: pulled the
  live Drug Offense taxonomy; discovered `wg3w-h783.resolution` has **no booked-vs-cited split** (only
  `Cite or Arrest Adult`) so Step-3 booking-confirmation is impossible — **amended D3**, locked the
  description-level dealer filter (5,474 arrests, 31% of 17,502). **Headline finding:** the 2025-26
  drug-enforcement ~tripling is overwhelmingly **`Narcotics Paraphernalia` (885→5,344, now 54%)** while
  **dealer arrests fell** (2,179→~875/yr) — the user's catch-and-release-churn thesis confirmed in data;
  validates the two-axis framing (D2/D4). Geography: **Tenderloin 72%**, then Southern/Northern/Mission →
  district set settled (§8). §5 needles: live monthly pull → trailing-12 vs prior-12 = **−19.1%**, outside
  the ±15% rule → **keep EXCLUDED** (decline decelerated but not flat); chart shown publicly with route-shift
  caveat. Open questions §8 all resolved; **next call is the dashboard build (§10).**
- **2026-06-13 (headline framing — D9, supersedes D4)** — User elevated **dealer arrests to a co-headline
  success target (↑=good)**, alongside `cfs_drug` (↓=good): **two top cards.** Rationale: the fentanyl
  epidemic is severe enough that supply disruption must rise massively to make a dent, so — exceptionally —
  PD activity becomes a goal here rather than mere context. Reflexivity kept as a footnote caveat only.
  Updated §1, §2 label, §4 framing, D4→D9. The §4 finding (dealers flat-to-down, paraphernalia tripled)
  becomes the central honest story: *the metric we want up isn't moving.*
- **2026-06-13 (footnotes)** — Added an **excluded-arrest-types footnote** spec to the dealer card (§10):
  name what's left out of `dealer_arrests` (paraphernalia 71%, ambiguous possession, loitering, under-influence)
  and why — catch-and-release that rarely leads to charges. Honesty caveat: `wg3w-h783` shows the arrest not
  the DA charging outcome, so "doesn't lead to charges" is documented SF declination practice, not dataset-proven.
- **2026-06-13 (scrutiny pass)** — User pushed back that the dealer count looked high. **Found `wg3w-h783`
  rows are per-charge, not per-arrest** — deduping by `incident_id` cut dealer arrests from 5,474 rows to
  **2,751 incidents** (~2×) and all Drug-Offense from 17,502→12,269. **Restated §4 Results 2–4 at incident
  level.** Confirmed the filter is sound: dealer/paraphernalia overlap is only 98 incidents (disjoint
  arrests), so the headline gets *stronger* — paraphernalia is now **71%** of 2025-26 drug incidents, dealers
  ~55/mo and flat-to-down. Added build TODOs (needle-exclusion footnote per user, mandatory incident_id dedup
  in the pipeline, paraphernalia-vs-dealer centerpiece viz).
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
