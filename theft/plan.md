# Plan — Merchant Theft in the Northern SFPD District

**Working title:** "Theft from merchants — Northern district, trends over time"
**Owner:** Aaron · **Drafted:** 2026-06-13
**Status:** 🟡 Planning — analysis-first. Plan + EDA below; dashboard decision deferred.

> Living document. Keep it current as we build (see Changelog, §10).

---

## 1. Goal

Understand **theft targeting merchants in the Northern SFPD district** and how it is changing over
time. Per the brief, we analyze **each theft type individually** (not a blended index) and frame every
number against **seasonality and multi-year history** — month-over-month within the year, the same
month across prior years, and **how the current month compares to a typical month**. Northern is the
focus for now; the design keeps citywide and other districts as easy comparisons later.

This is **analysis-first**: a verified plan + exploratory data analysis (EDA). Whether it grows into a
districts-style dashboard is decided **after** we read the findings (§9, Open questions).

**Companion projects this builds on:**
- **`../districts/`** — the encampment/homelessness district dashboard. We reuse its **methodology
  discipline** (data reality check, locked decisions, seasonality-first framing, provenance.json), its
  **build-pipeline shape** (`build/01_pull → 02_assign → 03_rollup`, Socrata paging, signal registry),
  and its **police-district boundaries** (`qgnn-b9vv`). See `../districts/plan.md`.
- **Root app** (`../`) — design language and Socrata patterns if this becomes a frontend.

---

## 2. Data source — validated live (2026-06-13)

### 2.1 The source is `wg3w-h783`, and it's the right one

**`Police Department Incident Reports: 2018 to Present`** (SFPD, dataset `wg3w-h783`, domain
`data.sfgov.org`). Updated **automatically daily by 10:00 PT**. Reports are filed by officers or
self-reported by the public via SFPD's Coplogic online system, then approved by a supervising
Sergeant/Lieutenant before appearing.

A keyword search of DataSF surfaced **no better alternative** — this is *the* canonical SFPD crime
dataset and it directly answers "theft from merchants." It is **better-suited than the 311 dataset**
the districts project uses, because it carries the fields we need natively:

| Field | Why it matters here |
|---|---|
| `incident_category` → `incident_subcategory` → `incident_description` | Three-level taxonomy that isolates shoplifting, commercial burglary/robbery, and a literal "merchant" theft code (§3). |
| **`police_district`** (text, e.g. `Northern`) | Native district label — **no point-in-polygon needed** (§4). |
| `latitude` / `longitude` / `point` | Real coordinates for mapping (311 only had lat/`long`). |
| `:@computed_region_qgnn_b9vv` | Built-in point-in-polygon district region — lets us **cross-check** the native field for free (§4) and stay consistent with `../districts/`. |
| `incident_date` / `incident_datetime`, `report_datetime` | Occurrence vs. filing date (lag matters — §5). |
| `incident_id` / `incident_number` / `row_id` | Dedup keys. **One incident can span multiple rows** (one per incident code) — dedup by `incident_id` for incident counts. |
| `resolution`, `filed_online` | Enforcement context (arrest vs. open) and self-report flag. |

**Reference:** the Incident Code Crosswalk (`ci9u-8awy`) maps codes ↔ categories if we need it.

### 2.2 The candidate "merchant theft" signals (each analyzed individually, per the brief)

DataSF's `Larceny Theft` category breaks down cleanly; merchant-relevant types also live in `Robbery`
and `Burglary`. Citywide totals (2018–present), with the merchant interpretation:

| Signal key | Filter | Citywide N | What it captures |
|---|---|---|---|
| `shoplifting` | `incident_subcategory = 'Larceny Theft - Shoplifting'` | **23,414** | **Core merchant-theft signal** — theft of goods from a store. Has dollar-band descriptions (`<$50`, `$50–200`, `$200–950`, `>$950`, `Att.`). |
| `commercial` | `incident_subcategory IN ('Burglary - Commercial','Robbery - Commercial')` | 12,789 | **Forcible theft against business premises** — break-ins (burglary, often after-hours) + holdups (robbery, force/threat against staff). Combined into one signal. |

**Decision (D1, revised 2026-06-13): two signals — `shoplifting` and `commercial`.**
- **`shoplifting`** stays its own signal: different crime (in-store theft), highest volume, the only
  enforcement-reflexive type, and trending *opposite* to commercial (§3.6). It carries the full two-axis
  treatment (§3.5).
- **`commercial`** lumps Burglary-Commercial + Robbery-Commercial: both are victim-reported theft against
  business premises, both declining ~60–74% on the honest axis, and individually low-volume/noisy —
  combining improves signal-to-noise and they tell the same story.
- They are **never summed with each other** — shoplifting and commercial stay distinct (they diverge).

> **Caveat on the `commercial` lump:** burglary (unlawful entry, usually no confrontation) and robbery
> (force/threat against a person) differ in severity. We combine them for a cleaner "theft against
> business premises" trend, but keep the build able to **decompose back** to the two subcategories on
> demand (filter retains `incident_subcategory`).

> **Dropped: `Theft from Merchant or Library`** (`incident_description`, in `Larceny Theft - Other`).
> A fading legacy code (~1–6/yr in Northern now, down from ~28/yr in 2018–20), likely absorbed into the
> shoplifting taxonomy. Excluded as a signal (§3.3). **Requires a visible dashboard footnote** stating
> we excluded it and why (D9).

> **Not merchant theft (excluded):** `Larceny - From Vehicle` (156k — auto break-ins, the dominant SF
> larceny but not a merchant crime), `Larceny Theft - From Building` (residential/office), bicycle,
> pickpocket, purse-snatch, auto-parts. Listed here so the exclusion is explicit and auditable.

---

## 3. Data reality check — Northern EDA (verified live, 2026-06-13)

Monthly counts, `police_district = 'Northern'`, by `incident_date`. **The current month (Jun 2026) and
the most recent 1–2 months are under-reported** due to the report-approval lag (§5, caveat 4) — exclude
them from headline comparisons.

### 3.1 Shoplifting (the core signal) — a large 2024 surge, now settled

| Year | Total | Avg/mo | Shape |
|---|---|---|---|
| 2023 | 292 | ~24 | Flat ~15–28, then a Dec jump (63). |
| **2024** | **739** | **~62** | **Feb–Apr spike to 94 / 87 / 101**, easing through the year. |
| 2025 | 411 | ~34 | Settled to ~26–47/mo. |
| 2026 (Jan–May) | 156 | ~31 | Slightly **below** 2025's pace. |

**The headline question this raises:** shoplifting in Northern **roughly tripled** from a ~24/mo
baseline (2023) to a ~90–100/mo peak (Feb–Apr 2024), then fell back to ~31–34/mo (2025–26) — *still
above the 2023 baseline.* Two readings, and separating them is the core analytic task:
- **Enforcement-driven:** shoplifting counts are unusually **sensitive to enforcement intensity**
  (many are officer-initiated / arrest reports, not victim calls). The 2024 spike aligns with SF's
  well-publicized early-2024 retail-theft crackdown and the Prop 36 era. A surge in *reports* can mean
  more *enforcement*, not more *theft* — the classic false-signal trap (`../districts/` §3, root §12).
- **Real fluctuation:** organized retail theft genuinely rose then cooled.
  → **We must not headline the count alone.** Cross-check with `resolution` (arrest share over time) and
  `filed_online` to gauge how much is enforcement vs. victim-reported (§7).

### 3.2 Commercial (burglary + robbery, Northern) — a genuine, enforcement-robust decline

Unlike shoplifting, the combined `commercial` signal is **down substantially on the victim-reported
axis** — and because these crimes are naturally enforcement-robust (§3.5), the decline is real, not an
artifact. Victim-reported (`Open or Active`) per year, Northern:

- **`commercial` (combined):** 253 → 200 → 172 → 127 → 86 (2021→25), 34 YTD 2026 — **down ~66%.**
  - of which Burglary-Commercial: 152 → 139 → 118 → 103 → 60 (down ~60%)
  - of which Robbery-Commercial: 101 → 61 → 54 → 24 → 26 (down ~74%)

Combining the two (D1) smooths the individual low-volume noise; the multi-year direction is clear and
favorable — the opposite of shoplifting. **This is why shoplifting and commercial must be shown
separately** (§3.6).

### 3.3 Theft from Merchant or Library — DROPPED (with a dashboard footnote, D9)

A literal "merchant" code (`incident_description`, inside `Larceny Theft - Other`, so no overlap with
shoplifting). Cumulatively Northern leads the city (121), **but it's a fading legacy code:** Northern
peaked in 2018–20 (17/24/28/yr) and is now ~1–6/yr — almost certainly being absorbed into the
shoplifting taxonomy. Too small and too declining-for-reporting-reasons to be a trustworthy signal.
**Decision: exclude it** (D9). Because a reader might reasonably expect a "theft from merchant" category
to be included, **the dashboard must carry a visible footnote** naming the excluded code and the reason
(legacy/low-usage, likely reclassified into shoplifting) — mirroring `../districts/`'s discipline of
making every exclusion explicit and auditable.

### 3.4 Seasonality

Tentative on the volume we've pulled: shoplifting shows a **Q4/December uptick** (holiday retail) in
2023; the 2024 surge swamps any clean seasonal read that year. Commercial burglary/robbery show no
strong seasonal shape at these volumes. **Action:** the rollup will compute same-month-prior-year (YoY)
and a trailing-12-month average so seasonality is framed honestly rather than asserted (§7).

### 3.5 The effectiveness metric — victim-reported theft, robust to enforcement (verified)

**The problem to solve:** we want to measure *the city's effectiveness at reducing theft from
businesses*. A naive count (or an arrest count) **fails badly**, because shoplifting reports are
reflexive to enforcement — *less* enforcement would shrink the count and **falsely read as success.**
The §3.1 surge is the proof. Decomposing Northern shoplifting by `resolution` settles it:

| Year | `Open or Active` (victim-reported, no arrest) | `Cite or Arrest Adult` (enforcement) | Total | Arrest share |
|---|---|---|---|---|
| 2021 | 299 | 39 | 338 | 12% |
| 2022 | 239 | 29 | 268 | 11% |
| 2023 | 229 | 63 | 292 | 22% |
| **2024** | 302 | **437** | 739 | **59%** |
| 2025 | 324 | 87 | 411 | 21% |
| 2026 (YTD) | 126 | 32 | 158 | 20% |

**The 2024 "tripling" was almost entirely arrests** (63 → 437 → back to 87) — an enforcement blitz.
The **victim-reported line barely moved and gently *rose*** (229 → 302 → 324). A total-reports or
arrest metric would have shown theft "exploding" then "falling 70%"; the theft businesses actually
experienced was roughly flat. **This is exactly the false-success trap to avoid.**

**The two report channels are cleanly distinct (verified, all-time Northern shoplifting):**
- **`filed_online=TRUE` → 100% `Open or Active`** (381/381, **zero arrests**) — you can't arrest via a
  web form, so online = a pure victim/merchant report.
- All-time split: **~73% victim-reported** (2,107: 1,726 in-person + 381 online) vs **~27%
  enforcement-arrest** (798).

**Commercial burglary & robbery are naturally enforcement-robust** — arrest shares are low and
*stable* (burglary ~18%, 224/1,275; robbery ~23%, 157/674), with **no 2024 blitz**. They're
after-the-fact victim reports by nature, so they don't share shoplifting's reflexivity — but they're
lower-volume and noisier.

**→ Recommended effectiveness metric (D7): a two-axis read, not one number.** "Success" = the city
reducing theft against businesses *while* catching more offenders. We measure both axes separately and
look for a specific **combination**:

- **Axis 1 — business-experienced theft** = victim-reported reports (`resolution = 'Open or Active'`,
  *excluding* `Cite or Arrest`), per signal, monthly. In all our merchant categories the **victim is
  the business**, so this is "theft businesses report experiencing." **Target: ↓.**
- **Axis 2 — enforcement response** = arrest reports (`resolution = 'Cite or Arrest Adult'`). **Target: ↑.**

**Why two axes beat one:** the axes move independently in the data (in 2024 arrests spiked 7× while
victim reports barely moved), so their *combination* can't be faked by dialing enforcement up or down —
which is exactly the failure mode of any single-count metric:

| Axis 1 (victim reports) | Axis 2 (arrests) | Reading |
|---|---|---|
| ↓ | ↑ | **Success** — less theft *and* more offenders caught. The signature we want. |
| ↓ | ↓ | **Ambiguous / suspect** — could be the false-success trap (enforcement pulled back) *or* reporting fatigue (§ caveat). Don't call it a win without the §-caveat checks. |
| ↑ | ↑ | Enforcement responding to rising theft (the 2024 pattern) — not yet winning. |
| ↑ | ↓ | **Worst** — more theft, less enforcement. |

**Northern shoplifting mapped onto it (the honest story the raw count hides):** victim reports have
**gently risen** (229 → 302 → 324, 2023→25) while arrests **spiked once in 2024 then collapsed**
(63 → 437 → 87). 2023 was the best-direction year; **2025 is the worst** (theft at series high,
enforcement down); 2026 YTD stays unfavorable. The 2024 "surge + decline" in the total count was an
enforcement cycle, *not* the city reducing theft.

Publish `filed_online=TRUE` as a zero-enforcement-bias corroborator of Axis 1, **but never trend it
alone** — its share climbed 0% → 50% (2021–26) from *channel adoption*, not rising theft.

**Two honesty caveats on this framework:**
1. **Reporting-fatigue trap on Axis 1.** "Fewer business reports" is only success if businesses are
   *still reporting*. If merchants give up out of futility, Axis 1 falls for the wrong reason — the
   **opposite** of the enforcement bias, and the true "dark figure" limit of any police-report measure.
   **Early-warning check:** if in-person victim reports drop but the lower-friction `filed_online` line
   holds, suspect fatigue, not real improvement. Triangulate with non-police signals for a true measure
   (merchant/retail surveys, storefront vacancy/closure data, BID reports) — outside `wg3w-h783` (§9).
2. **Don't collapse the axes into a ratio.** Arrests ÷ victim-reports is tempting as a "clearance"
   number, but it's confounded: 2024's ratio exceeds 1.0 because the arrests were **proactive on-view
   sweeps**, not clearances of reported thefts. Track the two axes side by side instead.

> Mechanism note: `resolution` is frozen at filing (dataset docs — later updates come via Supplements),
> so `Open or Active` means *no arrest at time of filing* and `Cite or Arrest` means an on-scene/on-view
> arrest. That's the clean split we want: Axis 1 isolates reports that exist **because a business
> reported a theft**; Axis 2 isolates **enforcement actions**.

### 3.6 The two signals tell opposite stories → keep them separate

Victim-reported (enforcement-robust) trend, Northern, by signal:

| Signal | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 YTD | Read |
|---|---|---|---|---|---|---|---|
| Shoplifting | 299 | 239 | 229 | 302 | 324 | 126 | flat → **rising** ⚠ |
| Commercial (burglary + robbery) | 253 | 200 | 172 | 127 | 86 | 34 | **down ~66%** ✓ |

Lumping shoplifting *into* commercial would average these opposing trends and **hide both**. Shoplifting
also dominates by volume *and* is the only enforcement-reflexive signal, so it most needs the two-axis
(victim vs. arrest) treatment (§3.5); commercial is mostly victim-reported already. **Dashboard
implication:** **2 cards** — `shoplifting` and `commercial` — each showing its two axes, + a visible
footnote on the excluded `Theft from Merchant or Library` code (§3.3, D9).

---

## 4. District assignment — `police_district` is reliable for Northern (verified)

The user asked: *how reliable is the `police_district` field — does it miss items?* We tested it
directly against the dataset's built-in point-in-polygon region (`:@computed_region_qgnn_b9vv`, the
same `qgnn-b9vv` boundaries `../districts/` uses).

**Findings (shoplifting, the highest-volume signal):**
- **Completeness:** `police_district` is **100% populated** — 0 nulls across all three subcategory
  signals (23,414 + 7,474 + 5,315 rows). It does **not** drop items.
- **Geocoding:** ~**99.3–99.5%** of rows have `latitude`/`longitude` (shoplifting 23,305/23,414).
  `Out of SF` is tiny (74 shoplifting rows).
- **Native field vs. point-in-polygon agreement:** Northern's native label maps to PIP region `4`.
  **~97% of native-Northern shoplifting falls inside region 4 by point**; conversely **~99% of
  region-4 points are labeled Northern.** The ~2–3% disagreements are **boundary points** spilling to
  adjacent regions (mostly the Central/downtown edge).
- **Citywide caveat (not a Northern problem):** the only messy border is **Tenderloin/Central** —
  native-Tenderloin splits across PIP regions 5 (1,761) and 6 (673), and Central is region 6.
  **Northern's polygon (region 4) is clean.**

**Decision (D2): use the native `police_district = 'Northern'` field.** It's complete, officer-assigned
per the report, and ~97–99% consistent with point-in-polygon for Northern. Note the dataset docs say
the field is "entered by officers and not based on the point," but our cross-check shows that doesn't
materially hurt Northern. **Optional:** for any map, we can PIP the points against `qgnn-b9vv` for
pixel-accurate placement and to stay consistent with `../districts/`; for *counts*, the native field is
fine.

---

## 5. Known data breaks & caveats (carry into every analysis)

1. **⚠ April 24, 2024 intersection remap (dataset-documented).** Incident locations *before* 4/24/2024
   are mapped to a **different set of anonymizing intersections** than those on/after — "slight
   reporting irregularities for analyses that span this date." This **overlaps the 2024 shoplifting
   spike window** (§3.1), so the spike must be examined with this in mind. It affects *geography*
   (which intersection/CNN, possibly near-boundary district assignment), not the category counts.
2. **Enforcement sensitivity (the big one for shoplifting).** Shoplifting reports track **enforcement
   intensity**, not just underlying theft — a crackdown raises counts. Always read alongside
   `resolution` (arrest share) and `filed_online` (§7). Framing is **observational, not causal.**
3. **One incident, multiple rows.** A report with multiple incident codes appears as multiple rows.
   **Dedup by `incident_id`** when counting incidents (vs. counting code occurrences).
4. **Recent-month under-reporting.** Reports appear only after supervisor approval, so the **current and
   most-recent 1–2 months undercount** and will recover. Exclude the partial current month from
   headline comparisons (e.g. Jun 2026 = 2 is not a real crash); flag recent months as provisional.
5. **Low-volume noise.** `commercial_robbery` (and `theft_from_merchant`) run at single digits/month in
   Northern — month-to-month deltas are mostly noise. Prefer rolling averages / YoY over MoM for these.
6. **Reports ≠ ground truth.** Counts measure *reported & approved* incidents; merchant willingness to
   report, store policy, and SFPD reporting changes all move the number independent of real theft.
7. **Records can be removed** (court seal / active investigation), so history is mildly mutable.

---

## 6. Method (analysis-first)

Reuse `../districts/`'s pipeline shape; this phase can run as **ad-hoc Socrata queries → a notebook /
small Python build → committed JSON + provenance**, scoped to Northern.

```
theft/
  plan.md                 ← this file (plan + EDA findings + decisions + caveats)
  build/ (if we proceed)
    signals.py            ← REGISTRY: the 4 merchant-theft signals, filters, labels, caveats
    01_pull.py            ← fetch each signal's Northern rows from wg3w-h783 (Socrata paging $order=:id + $offset)
    03_rollup.py          ← per-signal monthly counts + YoY + trailing-12mo + current-vs-typical
    provenance.json       ← dataset id, exact filters, pull timestamp, row counts, the breaks (§5)
  data/ (if we proceed)
    aggregates.json       ← per-signal monthly series for Northern (+ citywide baseline)
    points/<signal>.json  ← only if we build a map
```

- **Dedup by `incident_id`** in the pull (caveat 3).
- **Pull the full taxonomy fields** (`incident_category/subcategory/description`, `resolution`,
  `filed_online`, `report_datetime`, `incident_date`, lat/long, `police_district`,
  `:@computed_region_qgnn_b9vv`) so the enforcement cross-check (§7) and the PIP cross-check (§4) are
  possible without re-pulling.
- **Reuse `../districts/build/httpget.py`** (handles the macOS python.org SSL `CERTIFICATE_VERIFY_FAILED`
  fallback) if we write Python.

---

## 7. Rollup & analytic core (per the brief)

Per signal, for Northern (with a citywide baseline for context):
- **Monthly counts**, full history (2018→latest complete month), current partial month flagged/excluded.
- **Month-over-month within the year** and **same-month-prior-year (YoY)** — the seasonality-honest read.
- **"Typical month" vs. now:** trailing-12-month average (and/or same-month historical mean) so we can
  say "this month is running X% above/below a typical month."
- **Trailing-12-month trend line** — the deseasonalized "larger trend."
- **The two-axis effectiveness read (§3.5, the headline output):** per signal, two side-by-side monthly
  series — **Axis 1** victim-reported (`Open or Active`, want ↓) and **Axis 2** arrests
  (`Cite or Arrest`, want ↑) — plus the `filed_online` corroborator on Axis 1. Surface the quadrant
  reading, not a single blended number.
- **Northern's share of citywide** per signal (is Northern over/under-represented for merchant theft?).

### 7.1 Dashboard v1 — headline metric & layout (D10, as built)

Two per-signal cards. The **primary stat is theft reported by businesses** (the enforcement-robust
success metric, §3.5); **arrests are demoted to a clearly-framed context block below the chart**
(D11) — because the reported metric already excludes arrests, it is robust on its own, and "more
arrests" isn't unconditionally good (if deterrence works, arrests should fall *with* reports).

```
┌── SHOPLIFTING ─────────────────────────── Worsening ──┐
│  Theft reported by businesses · Mar 2026              │
│  29 reports                       12-mo trend ▲ 11%   │
│  → More thefts reported over the past year.           │
│  ┌ vs last month ┐ ┌ vs a year ago ┐ ┌ vs typical ┐  │
│  │ ▼15% Feb:34    │ │ ▲16% Mar25:25  │ │ ▲38% avg21 │  │
│  └────────────────┘ └────────────────┘ └────────────┘  │
│  [ chart: monthly reported (orange) + 12-mo avg       │
│    (slate) + arrests (blue); recent months shaded ]   │
│  ── Enforcement — context, not a success target ──    │
│  5 SFPD arrests in Mar · vs a year ago ▼…             │
└───────────────────────────────────────────────────────┘
```

- **Primary = business reports, latest *settled* month** (D12): the big number is the most recent month
  that has finished accruing late-approved reports — **not** the latest calendar month, which keeps
  climbing for weeks (§5.4) and would always look like a fake drop. Build picks it as
  `latest_complete − SETTLE_LAG_MONTHS` (=2); the still-settling months are **shaded** on the chart.
- **Three reference comparisons** answer "down compared to *what*": vs **last month**, vs the **same
  month a year ago** (seasonality), and vs the **typical month** (all-time monthly average) — each with
  the reference value shown. Colored good/bad (down = good for reports).
- **A de-noised 12-month-trend badge** (`Improving`/`Worsening`/`Little change`) drives the headline
  verdict, so a single noisy month doesn't decide the story.
- **Per-signal chart:** monthly reported (orange, the prominent line) + its 12-mo average (slate) +
  arrests (blue) over full history; CSS-variable colors so contrast holds in light/dark.
- **Arrests = context block below the chart** (D11): latest-month count + YoY, with a note that it's
  read *beside* the trend, not as a target.
- **Exclusion footnote (D9)** + **source footnotes**: per-signal and per-axis rationale ("why we look at
  this") plus the **exact, runnable Socrata query link** for each, generated by the build into
  `provenance.json` so the page and the queries can't drift.

**Stack (reuse `../districts/`):** pre-baked static JSON from a small Python build + a static Web
Awesome frontend, no framework. The build is *simpler* than districts — native `police_district` means
**no point-in-polygon**, and v1 needs **no map**, so `build/build.py` fetches pre-aggregated monthly
counts straight from Socrata (`date_trunc_ym` + `count`, grouped by resolution) rather than paging raw
rows. 5 Playwright smoke tests.

---

## 8. Decisions locked

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Two signals — `shoplifting` and `commercial`** (= Burglary-Commercial + Robbery-Commercial), never summed with each other. | They trend opposite (shoplifting flat/rising; commercial down ~66%) so must stay separate (§3.6); the two commercial types share a story and are individually noisy, so they lump (§3.2). Build keeps `incident_subcategory` so commercial can decompose on demand (§2.2). |
| D2 | **District = native `police_district='Northern'`** field (optionally PIP-cross-checked for maps). | Verified 100% populated and ~97–99% consistent with point-in-polygon for Northern (§4). |
| D3 | **Source = `wg3w-h783`**, dedup by `incident_id`, occurrence date = `incident_date`. | Canonical SFPD incidents; no better source exists (§2). Dedup avoids multi-code row inflation (§5.3). |
| D4 | **Seasonality-first framing; observational, not causal.** Compare YoY / vs-typical-month; flag enforcement sensitivity on shoplifting. | The 2024 surge is plausibly enforcement-driven (§3.1, §5.2) — naive MoM would mislead. |
| D5 | **Exclude the partial current month + flag recent 1–2 months as provisional.** | Approval lag undercounts recent months (§5.4). |
| D6 | **Analysis-first; dashboard decision deferred** to after findings. | User: "Plan + analysis doc first." |
| D7 | **Effectiveness = a two-axis read, not one number:** Axis 1 victim-reported theft (`resolution='Open or Active'`, want ↓) + Axis 2 arrests (`resolution='Cite or Arrest'`, want ↑). Success = victim reports ↓ **and** arrests ↑. | Single counts are reflexive to enforcement — the 2024 surge was 7× arrests, not more theft (§3.5). Two axes can't be faked by dialing enforcement up/down. User's framing (2026-06-13). |
| D8 | **Carry the reporting-fatigue caveat on Axis 1** + watch `filed_online` as the early-warning check; never collapse the axes into an arrests/reports ratio. | Victim reports falling can mean merchants gave up, not less theft — the dark-figure limit (§3.5). The ratio is confounded by proactive on-view sweeps (2024 ratio >1.0). |
| D9 | **Drop `Theft from Merchant or Library`; show a visible dashboard footnote** naming the excluded code and why (fading legacy code, ~1–6/yr, likely reclassified into shoplifting). | Too small/declining-for-reporting-reasons to trust; but a reader expects "theft from merchant" to be covered, so the exclusion must be explicit & auditable (§3.3), mirroring `../districts/`. |
| D10 | **Headline = a reported-vs-enforced read per signal**, colored by good/bad with a plain-language verdict; not raw month-over-month. | Directly expresses the effectiveness definition (D7); the de-noised 12-mo trend drives the verdict so low-count noise + recent-month lag don't (§7.1, §5.4). |
| D11 | **Arrests are secondary context (below the chart), not a co-headline.** Primary stat = theft reported by businesses. | The reported metric already excludes arrests, so it's enforcement-robust on its own; and "more arrests" isn't unconditionally good — if deterrence works arrests should fall *with* reports (user, 2026-06-13). |
| D12 | **Headline number = the latest *settled* month** (`latest_complete − 2`), with still-settling recent months shaded on the chart; plus three reference comparisons (last month / a year ago / typical month). | The most recent calendar months under-report until late approvals land (§5.4), so they fake a drop. The settled month + explicit comparisons make "down compared to what?" unambiguous (user, 2026-06-13). |

---

## 9. Open questions

- ~~**Is the 2024 shoplifting surge real theft or an enforcement/reporting artifact?**~~ **Resolved
  (§3.5):** mostly an **enforcement artifact** — arrests jumped 7× (63→437) in 2024 then collapsed,
  while victim-reported theft barely moved. Hence the two-axis metric (D7). *Still worth checking
  whether the 4/24/2024 remap (§5.1) nudged any near-boundary district assignment.*
- **Building the two-axis metric out:** monthly Axis-1/Axis-2 series for all 4 signals, citywide
  baseline, and a reporting-fatigue check (in-person vs `filed_online` divergence). Next analysis step
  if we proceed.
- **Dashboard or stay analytical?** If we proceed, mirror `../districts/`'s static build + frontend, or
  fold a "merchant theft" signal group into the existing districts app instead of a new site?
- **Citywide / other-district comparison.** Northern is the focus, but is Northern *high* for merchant
  theft? Add a citywide baseline + a district ranking (cheap with the native field).
- **History window.** Full 2018→present (captures pre-pandemic + the surge), or 2021→present (cleaner,
  post-pandemic baseline)? EDA above used 2021/2023 starts.
- **Time basis.** `incident_date` (when it happened) vs. `report_datetime` (when filed) — occurrence is
  the default; filing date matters for the lag caveat.

---

## 10. Changelog

- **2026-06-13** — Plan drafted. **Validated `wg3w-h783`** as the source (no better alternative on
  DataSF). Identified **4 individual merchant-theft signals** (D1). **Verified `police_district` is
  reliable for Northern** — 100% populated, ~97–99% consistent with point-in-polygon (D2, §4).
  Ran **Northern EDA (§3):** shoplifting tripled to a Feb–Apr 2024 peak (~90–100/mo) then settled to
  ~31–34/mo (2025–26); commercial burglary/robbery drifting down; "Theft from Merchant or Library" is
  Northern-concentrated. Flagged the **4/24/2024 intersection remap**, **shoplifting's enforcement
  sensitivity**, **multi-row dedup**, and **recent-month under-reporting** as the key caveats (§5).
  Dashboard decision deferred (D6).
- **2026-06-13** — **Defined the effectiveness metric (§3.5, D7/D8).** Decomposed Northern shoplifting
  by `resolution`: the 2024 "surge" was **almost entirely arrests** (63→437→87), while victim-reported
  theft (`Open or Active`) stayed flat-to-rising (229→302→324) — confirming the enforcement-artifact
  read and the false-success risk. Verified the channels are distinct (`filed_online=TRUE` → 100%
  non-arrest). Adopted a **two-axis metric**: victim-reported theft (↓) + arrests (↑), with a
  reporting-fatigue caveat and the `filed_online` early-warning check. Commercial burglary/robbery are
  naturally enforcement-robust (stable ~18–23% arrest share, no 2024 blitz).
- **2026-06-13** — **Reporting-lag transparency.** Added a build step that measures the incident→report
  lag over a fully-settled 12-mo window (median 0d, ~88% ≤30d, p90 ~48d; stored in `aggregates.settling`)
  and a **prominent note above the footnotes** that explains, with those live numbers, why the most
  recent 1–2 months are incomplete and which settled month is being evaluated. Each card now shows the
  evaluated month prominently ("Evaluating March 2026 · latest settled month"). Corrected an earlier
  over-attribution: the lag removes only ~10–15% from recent months — the rest of the recent dip is
  ordinary small-count noise, which is why the verdict follows the 12-mo trend. Tests now 6.
- **2026-06-13** — **v1 refinements (D11/D12).** Made **business reports the primary stat** and demoted
  **arrests to a context block below the chart** (D11) — arrests aren't a standalone success target.
  Switched the headline to the **latest settled month** (lag 2; recent months shaded "still settling")
  with **three labeled comparisons** (last month / a year ago / typical month) + a de-noised 12-mo-trend
  badge (D12), fixing the reporting-lag distortion where May 2026 read as −62% (10 reports) vs a settled
  Mar 2026 (29). Recolored the chart to three distinct, light/dark-aware hues (orange monthly, slate
  12-mo avg, blue arrests). Added **source footnotes** with per-signal/per-axis rationale + runnable
  Socrata query links (generated into `provenance.json`). Tests now 5.
- **2026-06-13** — **Built dashboard v1 (D10).** Wrote the headline-metric spec (§7.1): a
  reported-vs-enforced scorecard per signal on a trailing-12-mo / YoY basis, colored good/bad with a
  plain-language pair verdict. Shipped a working static site reusing `../districts/`'s stack:
  `build/build.py` (aggregated SoQL from `wg3w-h783`, no point-in-polygon/no raw paging) → committed
  `data/aggregates.json` (~5 KB); a Web Awesome frontend with 2 scorecards + hand-rolled SVG charts +
  the D9 exclusion footnote + methodology; 3 passing Playwright smoke tests. Live reads (trailing-12mo
  vs prior): shoplifting reported ▲2% / arrests ▼70%; commercial reported ▼8% / arrests ▼27%.
- **2026-06-13** — **Restructured to 2 signals (D1 revised).** **Lumped** Burglary-Commercial +
  Robbery-Commercial into one `commercial` signal (both victim-reported, both down ~60–74%, individually
  noisy → combined down ~66%; build can still decompose). **Dropped `Theft from Merchant or Library`**
  (D9) — fading legacy code (~1–6/yr, down from ~28/yr in 2018–20, likely reclassified into shoplifting)
  — with a required **visible dashboard footnote** naming the exclusion and why. Dashboard = 2 per-signal
  two-axis cards + the exclusion footnote (§3.6).
