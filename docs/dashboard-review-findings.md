# Dashboard-review findings — SF civic OKR constellation

**Scope:** homepage launcher (`index.html` + `js/app.js`) + the drug / unhoused / theft dashboards.
**Pass run:** 2026-07-28, on branch `refresh-data-plus-search-intersections`, before this PR lands.
**Skill:** `dashboard-review` (accuracy > clarity > never drama). Public GitHub Pages static site — XSS/injection/secret findings intentionally excluded (only the Cloudflare Worker is in-scope for those, and it's untouched here).

**Rule for this doc:** findings are gathered, ranked, and discussed — **no fixes applied without confirmation**. Numbers/claims are not silently rewritten. Status column updates as we decide (Open / Agreed / Deferred / Resolved / Done).

---

## Global severity-ranked table

| # | Finding | Surface | Dim | Severity | Status |
|---|---------|---------|-----|----------|--------|
| U1 | District figures are point-in-polygon, not reproducible from the citywide query shown — **investigated, resolved to a verifiability fix** | unhoused | 4 | HIGH | **Done — Option A applied + round-trip verified** |
| U2 | "Reduce encampments" verdict spans the mid-2025 split (~+15–18% capture step) — union headline is valid; self-heals ~Aug 2026 | unhoused | 2/3 | HIGH | **Deferred — no action now (user)** |
| H1 | 2wk chip is not reproducible on any dashboard, yet the footnote says every number is | homepage | 4 | HIGH | **Done (H1-A wording); H1-B link deferred** |
| H2 | 2wk badge tooltip claims "latest settled fortnight" for creation-stamped signals where it's genuinely the last 2 weeks | homepage | 6 | MED | **Done** |
| H3 | 2wk %-change shown with full confidence despite tiny per-district 2-week counts (no min-base guard) | homepage | 5/8 | MED | **Done — disclose, not hide (user)** |
| H4 | Two different "2wk" definitions coexist (baked Monday-week fortnight vs. live trailing-14-day) | homepage | 3 | MED | **Done (H4-B footnote)** |
| U3 | No adjacent source link on district figures (reader can't verify) | unhoused | 4 | MED | **Done — closed with U1 Option A** |
| TEST | 2 unhoused e2e tests asserted the pre-U2 display label "Encampment" (now reworded) — pre-existing drift, blocked CI | unhoused | — | MED | **Done — re-pointed to stable hooks (`data-f`, `test-sig-*`)** |
| U4 | "Aggregate" line sums 311 + 911 undeduped | unhoused | 2 | LOW | **Resolved-as-labeled (chip stays "Aggregate", user)** |
| U5 | Citywide overlay rescaled onto the district axis | unhoused | 5 | MED | Open |
| U6 | "Visible disorder" editorial headline | unhoused | 7 | MED | **Won't fix — OKR title owned by city pod leadership (user)** |
| DR2 | No adjacent source links on drug signals | drug | 4 | MED | **Done — per-district scoped links (arrests exact, cfs ~0.5%); all 16 round-trip Δ0.00%** |
| DR3 | Day/Night windows are unequal length (≈14h day vs ≈10h night) but compared as peers | drug | 2/3 | MED | **Done — footnote (user)** |
| DR4 | "4× lower than 2018" needle claim is not verifiable from any shown query | drug | 1/4 | MED | Open |
| DR5 | "Catch-and-release churn" editorial tone | drug | 7 | MED | **Done — dropped "churn" (user: keep descriptive)** |
| DR1 | Small-N %-change noise shown as confident figures | drug | 5/8 | MED | Open |
| H5 | Emerging endpoint hardcodes `now − 2mo` instead of deriving the settled boundary from data | homepage | 3 | LOW/MED | Open |
| H6 | Emerging "run the monthly series" link doesn't reproduce the 2wk figure | homepage | 4 | LOW | Open |
| H7 | "using live SF OpenData" slightly overstates (some cards are baked) | homepage | 6 | LOW | Open |
| U7 | 2026-07 partial-month inconsistency between `aggregates.json` and `provenance.json` | unhoused | 3 | LOW | Open |
| T* | Theft dashboard findings | theft | — | — | **Pending — audit re-running (agent timed out first pass)** |

Drug numbers tie out exactly (cfs_drug 986, dealer_arrests 69, needles −19% YoY). Unhoused citywide ties out (union 5953). Theft: shoplifting tied out in the partial first pass; commercial signal + citywide denominator were not reached before the timeout — re-verifying now.

---

## ▶ Session handoff — remaining MEDIUM items (start here in a fresh session)

Everything HIGH is Done or Deferred. The `refresh-data-plus-search-intersections` branch has uncommitted edits from this pass across `js/app.js`, `styles.css`, `drug/js/app.js`, `drug/index.html`, `unhoused/build/{signals,03_rollup}.py`, `unhoused/data/{aggregates,provenance}.json`, `unhoused/js/app.js`, `shared/recent-activity.js`, `unhoused/tests/e2e.spec.js`, plus the docs. **Not committed** (user runs all git himself).

**MEDIUMs still Open, roughly cheapest→judgiest:**
1. **DR1** — small-N %-change on drug sub-signals: apply the **same disclose-don't-hide treatment as H3** (low-base `~` marker + tooltip), not suppression. *Reuse H3's pattern.*
2. **U5** — citywide overlay rescaled onto the district axis; clarify it's rescaled (label/secondary axis/separate spark) so no false magnitude read. *Chart change, needs a design call.*
3. **DR4** — "4× lower than 2018" needle claim: either add the query/source that yields the 2018 baseline + ratio, or soften to what the shown data supports. *Needs source hunt; may be a number change → confirm before touching.*
4. **T1** — confirm whether `wg3w-h783` theft filters contain duplicate `incident_id` rows (memory says dedup; `build.py` uses `count(*)`). If dupes exist, counts are slightly inflated. Then finish the theft dim-4/7 sweep (source links, tone) that timed out. *Verification first, possible build change.*

**Resolved in this session (2026-07-28, part 2):**
- **DR2 — Done.** Added per-district reader-clickable verify links to the drug methodology (mirrors the unhoused U1 pattern). Two link kinds by assignment method: arrest signals filter native `police_district` (**exact**); `cfs_drug` scopes by `:@computed_region_qgnn_b9vv` (~0.5%); needles stays citywide. `signals.py` gained `DISTRICT_REGION` + `query_url_by_district()`; `03_rollup.py` bakes it; `drug/js/app.js` `renderMethodology` resolves the district link + a scoping disclosure. Regenerated via a **no-refetch provenance patch** (user chose "patch provenance only") → `aggregates.json` byte-identical, zero metric change. **All 16 links round-trip Δ0.00%.** `validate_build.py` + `trace.py drug` green, full `npm test` 48/48 (1 skipped). See detail section below.
- **DR5 — Done.** Dropped the editorializing word "churn" from the three user-facing drug spots (composition lead `drug/js/app.js:312`; methodology "what we leave out" lead `:470`; paraphernalia row `:473`), keeping the substantiated "catch-and-release" policy term (backed by the Honesty note at `:476`). User chose "drop 'churn', keep descriptive." The baked `paraphernalia`/`other_drug_arrests` caveats still contain "churn" but are **not surfaced on-screen** (only `cfs_drug`/`dealer_arrests` are focusable via `focusInfo`), so no rebuild. `node --check` + drug e2e 9/9 green.
- **U6 — Won't fix.** User: the OKR objective titles ("Reduce visible disorder: unsheltered homelessness") were set by city pod leadership and are not ours to edit. Closed, no change.

LOW/deferred (not in this batch unless asked): H1-B, H5, H6, H7, U2 verdict-guard, U4 (closed), U7.

**Conventions to carry into the fresh session:** accuracy > clarity > never drama; do NOT rewrite any number/claim without confirming; public static site so no XSS/secret findings; user runs all git/gh; keep this doc + any plan doc updated as decisions land. After each fix: rebuild if data touched, `python3 validation/validate_build.py`, and the relevant `npx playwright test --project=<dash>`.

---

## Homepage (`js/app.js`, `index.html`)

### H1 — 2wk chip is not independently reproducible, but the footnote implies it is *(HIGH, dim 4)*
- **Location:** footnote at `js/app.js:830` — "Each objective's Key Results are computed on its own dashboard — open a dashboard to see the dataset and the exact query behind every number." Badge rendered at `js/app.js:247`.
- **Problem:** the 2wk YoY chip is computed from a **weekly** series (`series_weekly` / `weeks[]`) that is baked only for the homepage. No dashboard displays or exposes a 2-week (Monday-fortnight) figure or its query, so a reader who "opens a dashboard" cannot reproduce the 2wk number. (Confirmed earlier: no dashboard consumes `series_weekly`.)
- **Why it misleads:** the footnote makes a blanket verifiability promise the freshest, most eye-catching chip can't meet.
- **Proposed change (to discuss):** either (a) expose the weekly fortnight query somewhere reachable (a methodology link that runs the actual weekly SoQL), or (b) narrow the footnote's promise so it doesn't cover the 2wk chip. Bias is to add verifiability, not cut the chip.
- **Resolved (2026-07-28) — H1-A applied:** narrowed the footnote (`js/app.js:830`) to say the 1mo/3mo monthly figures are reproducible on each dashboard, and that the 2wk chip uses the same dataset/filter rolled up to weekly (Monday-start) buckets, not shown on the dashboards directly. Honest wording, no metric change. **H1-B (deferred):** bake per-signal/per-district weekly `query_url`s into each `aggregates.json` and surface a "run the weekly series ↗" link next to the 2wk chip for true round-trip — optional follow-up.

### H2 — 2wk tooltip says "latest settled fortnight" for signals where it isn't *(MED, dim 6)*
- **Location:** `js/app.js:247` — `renderChangeBadge(data.change2wk, data.goal, '2 weeks vs last year (latest settled fortnight)')`; header col tooltip at `:259`.
- **Problem:** the label is applied to **all** signals, but creation-stamped signals (`settles=false`: all unhoused, drug `cfs_drug`) anchor to `latest_complete_week` — their 2wk chip is genuinely the **last two weeks**, not a "settled fortnight sitting weeks in the past." Only laggy signals (theft `reported`, drug arrests) actually show a settled-back fortnight.
- **Why it misleads:** tells the reader the number is older/lagged than it is for half the cards.
- **Proposed change:** make the label conditional on `settles` (settled-fortnight wording only when true; "last two weeks" otherwise).
- **Resolved (2026-07-28) — applied:** `getKRData` now returns `settles` (`js/app.js:221`; emerging path returns `settles:true` at `:161`), and the 2wk badge (`:247`) picks its tooltip by `settles` — "latest settled fortnight (lags ~weeks)" vs "the latest two weeks". The shared column header (`:259`) was made generic and points to methodology. `node --check` passes.

### H3 — Small-N 2-week counts shown as confident %-changes *(MED, dim 5/8)* — **DONE (disclose, don't hide)**
- **Location:** `pctChange` used for `change2wk` in `getKRData`; no minimum-base guard.
- **Problem:** a single district's two-week count can be very small; YoY % on a base of a handful of reports swings wildly (e.g. 3→6 reads "+100%"). Sampled real magnitudes: theft bases tiny (1–14), drug borderline (32–97), unhoused fine.
- **User decision (2026-07-28):** rejected suppressing/zeroing ("idk about zeroing out the data") — wants a note/hover disclosing that we intentionally discarded the normal floor and that 2wk windows are small.
- **Applied:** kept the % but added a low-base **marker + disclosure** rather than hiding.
  - `const TWO_WK_MIN_BASE = 20` module floor. `getKRData` now returns `base2wk` (the year-ago fortnight count) and `lowBase2wk = base2wk < 20`, for both the baked path and the emerging path (via `cached.prior2`).
  - `renderChangeBadge(change, goal, label, opts)` renders low-base chips with a `~` prefix, a `kr-ticker--lowbase` class (dotted underline + `cursor:help`), and a tooltip: "small window: only N reports in the year-ago fortnight (below our 20 floor), so read as directional."
  - Methodology `<details>` gains a paragraph: two-week windows are small, `~` = below the floor, read as directional.
  - `styles.css`: `.kr-ticker--lowbase` marker (keeps good/bad color). `node --check` passes.

### H4 — Two different "2wk" definitions on screen *(MED, dim 3)* — **DONE (H4-B footnote)**
- **Location:** baked path `getKRData` uses **Monday-week** fortnights via `nearestWeekIndex(..., -364)`; live path `fetchEmergingSignal` uses a **trailing-14-day, day-aligned** window (`daysBack(lastEnd,14)` / `daysBack(lastEnd,364)`).
- **Problem:** two cards can show a "2wk" chip computed over differently-defined fortnights. For a skeptical reader cross-checking, they won't tie out exactly.
- **Decision:** H4-B (footnote the distinction) over re-aligning the live path — the emerging path is a small live approximation and aligning it to baked Monday weeks is disproportionate. The methodology paragraph added for H3 now also notes: emerging-signal 2wk chips use a day-aligned trailing-14-day window and can differ slightly from the baked Monday-aligned fortnights. **H4-A (code re-alignment) not pursued.**

### H5 — Emerging settled boundary is hardcoded *(LOW/MED, dim 3)*
- **Location:** `js/app.js:717` — `const lastEnd = new Date(now.getFullYear(), now.getMonth() - 2, 1);`
- **Problem:** the 2-month settle horizon is hardcoded rather than derived from the dataset's actual settled boundary. If the reporting lag shifts, this silently drifts from the baked cards' data-driven `latest_settled_*`.
- **Proposed change:** derive from the same settled pointer the baked cards use, or document the fixed 2-month assumption next to it.

### H6 — Emerging "monthly series" link doesn't reproduce the 2wk figure *(LOW, dim 4)*
- **Location:** emerging-signal methodology link (monthly series).
- **Problem:** the provided verify link runs a **monthly** series; it cannot reproduce the 2-week fortnight chip.
- **Proposed change:** pair the 2wk chip with a link that runs the actual fortnight query, or note the link is monthly-only.

### H7 — "using live SF OpenData" slightly overstates *(LOW, dim 6)*
- **Problem:** most cards render from **baked** aggregates; only the emerging signals hit the API live. The phrasing implies everything is live.
- **Proposed change:** "from SF OpenData (baked nightly; emerging signals live)" or similar.

---

## Unhoused (`unhoused/`)

### U1 — District figures were point-in-polygon, not reproducible from the shown citywide query — **INVESTIGATED & RESOLVED** *(HIGH, dim 4)*

**Original finding:** the per-district KR figures are produced by a hand-rolled point-in-polygon in `unhoused/build/02_assign.py` (against the `qgnn-b9vv` "Current Police Districts" boundary, from `emergent-map/data/sidecar/police_districts.geojson`). The citywide query shown to the reader can't reproduce a single district's number, so district figures fail round-trip verifiability.

**Investigation (2026-07-28):** we asked whether we should switch to the 311 dataset's native `police_district` field (round-trip trivial). Three-way comparison, encampment signal, `vw6y-z8j6`, 2026-06:

| District | Our polygon (baked) | `:@computed_region_qgnn_b9vv` (Socrata spatial join, *same boundary*) | `police_district` **text** field |
|---|---|---|---|
| Mission | 1267 | 1267 (region 3) | 1315 |
| Northern | 1146 | 1145 (region 4) | 1148 |
| Central | 611 | 610 (region 6) | 618 |
| **Tenderloin** | **642** | **645 (region 5)** | **589** |
| Citywide | 5953 | (identical) | (identical) |

**Conclusions:**
1. **Our polygon is not buggy.** It reproduces the authoritative Socrata spatial join (`:@computed_region_qgnn_b9vv`) to within **1–3 reports (<0.5%) in every district, Tenderloin included.**
2. **The ~10% Tenderloin gap is against the `police_district` *text* field only.** That field is a separate assignment (set at intake/geocode), not the published boundary. ~53 reports that fall geographically inside the Tenderloin boundary carry a *different* district in the text field; they resurface as surplus in Mission (text 1315 vs boundary 1267, +48), Central (+7), and Southern. Tenderloin is small and dense, so ~53 misassigned reports = ~10% of TL but only ~1–4% of the big districts. (Confirmed the pattern across 2026-03 → 2026-06: text field TL runs 8–12% below the boundary every month; Mission ~2–6% above.)
3. **Switching to the text field would make us *less* faithful to the boundary, not more.**

**Resolved decision (recommended, pending user confirm):** keep the boundary-based counts (unchanged displayed numbers) **and gain round-trip verifiability** by exposing the **computed-region** query as the district source link — e.g. Tenderloin = `WHERE :@computed_region_qgnn_b9vv = '5'` on `vw6y-z8j6` returns 645 vs. baked 642 (<0.5%, footnote as "boundary spatial join; ±0.5% vs. our point-in-polygon"). This closes the HIGH verifiability finding with **zero change to any displayed number** and does **not** adopt the divergent text field. Region→district code map (2026-06): 1=Southern, 3=Mission, 4=Northern, 5=Tenderloin, 6=Central (verify the full map before baking links).

**✅ DONE (2026-07-28) — Option A applied (user: "A seems fine and less work").**
- **Region-code map locked** (verified on BOTH datasets, 2026-06): Central=6, Northern=4, Mission=3, Tenderloin=5. `vw6y-z8j6` (311) reproduces our point-in-polygon to <0.5%; `2zdj-bwza` (911) matches **exactly**; the two datasets share the same code map.
- **Build:** `unhoused/build/signals.py` gains `DISTRICT_REGION` + a `region=` param on `query_url` (appends `AND :@computed_region_qgnn_b9vv = '<code>'`, precedence-safe). `03_rollup.py` emits `query_url_by_district` for every signal, each group member, and each union component.
- **UI:** `unhoused/js/app.js` `renderMethodology` now serves the active district's scoped link (falls back to citywide on the Citywide view) and the intro discloses: queries are scoped via the boundary spatial join, returning within **~0.5%** of the shown point-in-polygon figure. No metric change.
- **Verified:** displayed numbers byte-identical (611/1146/1267/642); baked TL link round-trips to 645 vs shown 642 (<0.5%, as disclosed); `validate_build.py` green; unhoused e2e now 12/12 (the 2 pre-existing failures were stale label assertions, since fixed — see TEST row).

### U2 — "Reduce encampments" verdict is computed across the mid-2025 taxonomy split — no valid cross-split trend exists in *either* direction *(HIGH, dim 2/3)*

**Label half — RESOLVED (user, commits `602428b`/`47c405e`/`b0965b5`):** the headline was renamed "Encampment & homelessness reports" → **"311 encampment and unhoused reports"**, a "Why combined? ⓘ" explainer documents the mid-2025 DEM/311 split, the caveat reads "combined report volume, not confirmed encampments," and an "Encampment only" toggle exposes the tents/structures component. Naming/overclaim is now accurate.

**The union headline is VALID and stays (user, agreed).** Showing encampment_only alone is *dishonest* post-split (it sheds the individuals that category used to contain); unioning the two things "Encampment" split into is the correct way to keep a continuous, comparable headline. Not in dispute.

**Narrow remaining issue — the transitional cross-split VERDICT.** The KR "Reduce encampments" headline `verdict()` runs `trend12()` on the union ([unhoused/js/app.js:118](../unhoused/js/app.js#L118)); the per-card `encT` ([:286](../unhoused/js/app.js#L286)) and the "Since Lurie" pre-2024 baseline ([:235](../unhoused/js/app.js#L235), [:252](../unhoused/js/app.js#L252)) compare across the split. The union is only a clean continuity measure if the split were *conserving*; it is **mostly but not fully**. Seasonally-fairer estimate (pre-split avg Jan–Jun 2025 ≈ 4,563/mo vs settled post-split avg Aug 2025–Jun 2026 ≈ 5,310/mo, using encampment_only's own −1,418/mo drop as the conserving control): ~1,418/mo moved over (union-neutral, as designed) **but ~809/mo (≈ +15–18%) is net-new capture** the old taxonomy wasn't recording. That one-time step is enough to flip a flat trend to "Worsening."

**This is transitional and self-heals.** Once both of `trend12`'s 12-mo blocks sit entirely after the split (from **~Aug–Sep 2026**), the union verdict compares like-with-like and is fully valid — the union working as designed. Only the ~1-year window *now* (prev-block still pre-split) is exposed.

**One mitigation already present:** the transition **map** judges each cell vs the district tide recomputed over the same window ([shared/classify.js:10-11](../shared/classify.js#L10-L11)) — a difference-in-differences that absorbs a uniform split lift, so the *map* is partially protected; the headline verdict + momentum chips are not (absolute trends).

**Proposed change (decision needed) — keep the union, guard only the transitional verdict:** until ~Aug 2026, soften/suppress the Worsening/Improving *verdict label* when its window spans the split, or footnote it ("a mid-2025 intake change added ~15–18% capture; year-over-year spanning it overstates growth"). No metric change; no fix needed after the window clears. *(Corrects earlier drafts: not "+28%", and my "encampments down ~49%" framing was the reclassification artifact — dropped.)*

### U3 — No adjacent source link on district figures *(MED, dim 4)*
- **Problem:** district KR figures have no reader-clickable source link. (Fixed jointly with U1's computed-region link.)

### U4 — "Aggregate" line sums 311 + 911 undeduped *(downgraded MED→LOW, dim 2)* — **RESOLVED-AS-LABELED**
- **What it is:** `focus='aggregate'` (`unhoused/js/app.js:129`) = `encampment` union (311, `vw6y-z8j6`) **+** `cfs_presence` group (911 CFS, `2zdj-bwza` = `cfs_sitlie` + `cfs_homeless`, themselves distinct non-overlapping `call_type_final_desc` values). Card label: "All reports — 311 + 911 combined."
- **Can we dedupe? No, and it doesn't matter (2026-07-28, user asked):**
  1. **Not feasible.** 311 and 911 are separate systems with **no shared incident key**. Deduping would need fuzzy space/time matching (same corner within some window) — a modeling choice that manufactures a number, not a clean count. The skill's rule is: don't fake precision.
  2. **Not material.** 311 encampment ≈ 5,000–6,500/mo **dominates**; the 911 pieces (`cfs_sitlie` ≈ 640–1,113 + `cfs_homeless` ≈ 133–180 = ≈ 780–1,290/mo) are only **~13–18%** of the aggregate. Even if a large share of the 911 minority duplicated a 311 report, the maximum possible double-count is bounded to a fraction of that ~1,000/mo against a ~6,500 total — it can't move the headline meaningfully.
  3. **The two channels also capture different acts** (a 311 service request to get conditions addressed vs. a dispatched 911/CFS call), so much of the apparent "overlap" is genuinely distinct demand, not duplication.
- **Already honest:** the aggregate note (`:130-131`) explicitly states "different units," "there is no cross-dataset dedup," "combined report volume, not a count of distinct situations," and "311 dominates the magnitude." That's exactly the label the finding asked for — so the substantive fix is **already in place**; downgraded to LOW.
- **Chip label (decided 2026-07-28):** keep the chip as "Aggregate" (user) — the honest note is one click away. No change. U4 closed.

### U5 — Citywide overlay rescaled onto the district axis *(MED, dim 5)*
- **Problem:** a citywide series is drawn on the same axis as district series after rescaling, which can imply a magnitude relationship that isn't real.
- **Proposed change:** secondary axis clearly labeled, or separate spark.

### U6 — "Visible disorder" editorial headline *(MED, dim 7)* — **WON'T FIX**
- **Location:** `unhoused/index.html:64` `<h1>Reduce visible disorder: unsheltered homelessness</h1>`.
- **Resolved (2026-07-28, user):** the OKR objective titles across the dashboards were set by **city pod leadership** and are not ours to reword. Closed with no change.

### U7 — 2026-07 partial-month inconsistency *(LOW, dim 3)*
- **Problem:** the latest partial month differs between `aggregates.json` and `provenance.json`.
- **Proposed change:** rebuild so both agree, or pin the partial-month boundary in one place.

### TEST — stale e2e label assertions *(MED, done)*
- **What it was:** two unhoused e2e assertions read a segment's **display text** (`toHaveText('Encampment')`) — one on the chart-selector active seg, one on the recent-activity signal picker. The U2 relabel ("Encampment" → "311 encampment & unhoused" / chip reworded) broke both. Pre-existing drift, not caused by this pass, but it blocked CI.
- **Fix (2026-07-28, user: "add a class selector or attribute … you can add a test- prefixed css class"):** re-pointed the assertions at stable, copy-independent hooks instead of the wording. Chart-selector already exposes `data-f="<key>"`, so the assertions now use `toHaveAttribute('data-f', 'aggregate'|'encampment')`. The recent-activity picker had no hook, so added a `test-sig-<key>` class in `shared/recent-activity.js` (guarded on `s.key`); assertions use `toHaveClass(/test-sig-encampment/)` / click `.test-sig-cfs_presence`. Display text can now be reworded without breaking tests. Both tests green.

---

## Drug (`drug/`)

Baked numbers tie out exactly: `cfs_drug` = 986, `dealer_arrests` = 69, needles −19% YoY.

### DR1 — Small-N %-change noise shown as confident figures *(MED, dim 5/8)*
- Same class as H3: some drug sub-signals have small bases where YoY % swings are noise. Consider min-base suppression.

### DR2 — No adjacent source links on drug signals *(MED, dim 4)* — **DONE**
- Displayed figures lacked reader-clickable *district-scoped* queries — the methodology `row()` served each signal's **citywide** `query_url`, so on a district page it didn't reproduce the shown number.
- **Applied (2026-07-28), mirroring the unhoused U1 pattern; two link kinds by assignment method:**
  - `signals.py`: added `DISTRICT_REGION` + `region=`/`district=` params on `query_url`, and a `query_url_by_district(sig)` helper.
  - `03_rollup.py`: stores `query_url_by_district` in each signal's provenance (imports the helper from `signals.py`).
  - **Arrest signals** (`dealer_arrests`/`paraphernalia`/`other_drug_arrests`, `wg3w-h783`, grouped on native `police_district`) → link filters `police_district = '<Title>'` → **exact** round-trip.
  - **cfs_drug** (`2zdj-bwza`, point-in-polygon) → link scopes by `:@computed_region_qgnn_b9vv = '<code>'` → ~0.5% (region map: N=4, M=3, C=6, TL=5).
  - **needles** — citywide-only, `query_url_by_district=None`, link stays citywide.
  - `drug/js/app.js`: `scoped(p)` helper in `renderMethodology` (page is per-district, so it always resolves to the district link; needles falls back to citywide) + a disclosure paragraph explaining exact-vs-~0.5% scoping.
- **Regenerated via a no-refetch patch** (`/tmp/patch_provenance_dr2.py`, per user's "patch provenance only"): injected `query_url_by_district` into `provenance.json`; **`aggregates.json` byte-identical (sha-verified) → zero metric change.**
- **Verified:** all **16** district links (4 signals × 4 districts) round-trip against the baked per-district series at **worst Δ 0.00%** over the last 6 settled months (arrests exact; cfs_drug computed-region tied exactly too, within the ~0.5% disclosed bound). `validate_build.py` green, `trace.py drug` all Δ0.00%, `node --check` OK, drug e2e 9/9.

### DR3 — Day/Night windows are unequal length *(MED, dim 2/3)* — **DONE (footnote, keep the signal)**
- The Day/Night filter compares a ≈14-hour "day" window (6am–8pm) against a ≈10-hour "night" window (8pm–6am) as if peers; counts aren't normalized for window length.
- **User decision (2026-07-28):** "dr3 is fine as long as we explain the windows in the footnotes." Keep the signal; do **not** normalize to per-hour rates.
- **Applied:**
  - The always-visible filter hint now shows the hour counts: `Day 6am–8pm (14h) · Night 8pm–6am (10h)` (in `drug/js/app.js` `applyTod` and the static `drug/index.html` hint), so the inequality is legible without opening methodology.
  - Added a methodology section ("The Day / Night filter — read shares and trends, not raw day-vs-night totals") explaining the windows mark daylight vs. overnight (not equal halves), that the day bucket spans 4 more hours so a higher raw day count is partly just window length, and that readers should compare shares/trends — noting the map's difference-in-differences still scores each block against its own district tide within the selected slice, so the map verdict isn't distorted. `node --check` passes.

### DR4 — "4× lower than 2018" needle claim not verifiable *(MED, dim 1/4)*
- A needle-cleanup claim ("~4× lower than 2018") has no shown query or source that reproduces it.
- **Proposed change:** add the query/source that yields the 2018 baseline and the ratio, or soften to what the shown data supports.

### DR5 — "Catch-and-release churn" editorial tone *(MED, dim 7)* — **DONE**
- Editorial framing on the arrests signal. The dim-7 issue was the dismissive word **"churn"** — "catch-and-release" itself is a substantiated policy claim (documented SF declination practice, per the Honesty note at `drug/js/app.js:476`), so it stays.
- **User decision (2026-07-28):** "drop 'churn', keep descriptive."
- **Applied:** three user-facing spots softened —
  - composition lead `drug/js/app.js:312`: "…catch-and-release churn, not supply disruption" → "…most of the enforcement volume is **low-level possession and paraphernalia arrests**, not supply disruption."
  - methodology "what we leave out" lead `:470`: "they measure enforcement **churn**" → "they measure enforcement **volume**."
  - paraphernalia row `:473`: "user-level **churn**, not dealing" → "**user-level**, not dealing."
- Comments at `:42`/`:285` (not user-facing) left as-is. Baked `paraphernalia`/`other_drug_arrests` caveats still say "churn" but are never rendered (only `cfs_drug`/`dealer_arrests` are focusable), so no rebuild. `node --check` + drug e2e 9/9 green.

> Note: the drug pass surfaced additional smaller tone/earn-its-place items; the above are the concrete, verified ones. Re-expand if we want the full list before applying.

---

## Theft (`theft/`)

**Status: mostly verified, one open question.** Second audit agent confirmed **all four headline figures tie out exactly**: shoplifting Northern reported 13=13 / arrests 11=11; commercial Northern reported 7=7 / arrests 1=1; citywide shoplifting 122=122; citywide commercial 50=50. Agent was stopped (laptop break) mid-way through one check:

- **T1 (open, verify next):** memory says `wg3w-h783` should be **deduped by `incident_id`**, but `theft/build/build.py` uses `count(*)`. Need to confirm whether duplicate incident rows exist in the theft filters (they may not, given the numbers tie out) — if they do, counts are slightly inflated. Re-run a short theft agent to finish this + a full dimension 4/7 sweep (source links, tone) which wasn't reached.

---

## Notes / conventions
- Per standing convention, all git/gh mutations are run by the user; this doc records findings only.
- After decisions: apply confirmed fixes, then **re-verify** (rebuild, re-run each signal's query, re-read copy) before the PR lands.
- Follow-up: review the updated `dashboard-review` skill at `/Users/aaron.hans/dev/skills` (recent "more emphasis on the footnote point" change) and note whether it would have altered this pass — the footnote-verifiability findings (H1, H6, U3) are exactly that theme, so it likely reinforces rather than changes them.
