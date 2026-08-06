# Plan — Theft data-lag research (make the dashboard more current)

## Context

The theft dashboard currently evaluates the **latest settled month = latest complete − 2**
(`SETTLE_LAG_MONTHS = 2` in [build/build.py](build/build.py)), so today it shows **April 2026**
while June is already complete. Leadership wants the dashboard to feel more current. If we can show —
with evidence — that a *consistent* share of each recent month arrives late, we can publish more-recent
months with a research-backed caveat ("this month is ~X% complete; expect the final figure ~Y% higher").

This plan designs the lag study and the document it produces. It does **not** change the dashboard yet;
that's a follow-on once the lag behavior is quantified and the confidence level is known.

## Status — research COMPLETE (data pulled 2026-07-31)

The research pass described below is **done**; deliverables are in the repo. **Do not re-run the study
from scratch** unless refreshing numbers — read the findings first, then pick up the implementation
follow-on in the section at the bottom of this doc.

- **Findings:** [data-lag-findings.md](data-lag-findings.md) — the narrative, curves, and recommendation.
- **Analysis:** [analysis/lag_study.py](analysis/lag_study.py) (stdlib, read-only; re-run with
  `python3 analysis/lag_study.py` from `theft/` to refresh) → [analysis/lag_results.json](analysis/lag_results.json).

**Conclusion (what the numbers said):** the headline metric — victim/merchant *reported* theft
(`resolution='Open or Active'`) — settles fast: **~92% complete at month close, ~98% one month later
(p10–p90 95–100%), ~99% by two**, stable across 2021–2026 and matching citywide → **high confidence**.
The current 2-month buffer is over-conservative because the baked `settling` stat **mixes in arrests**,
whose lag is huge (p90 = **242 days**) — that arrest tail is the only reason the combined p90 is 48 days.
Publication delta (filed→portal) is ~2 days median, so `report_datetime` is a sound proxy.
**Recommendation:** move the reported headline from −2 → **−1 month**, add a "~98% settled, expect ~+2%
(rarely >5%)" caveat, keep arrests on the conservative buffer and flagged. A projected range band is
viable (high confidence) but optional. Do **not** move to −0 (too volatile at ~30 reports/mo).

### What the request informs (the decision)
1. **How many months forward can the headline move** (from "−2" to "−1", "−0", or the partial current month)?
2. **What uplift caveat** accompanies each recent month ("expect ~+Y%, ±z").
3. **Is confidence high enough** to also show a *projected range band* on the chart (user: caveat is
   committed; range band only if we have very high confidence in the lag %).

## Key empirical findings from feasibility probe (already run)

- **`data_loaded_at` is clobbered on full reloads** — every 2023-Q1 row shares the identical stamp
  `2025-06-13T09:52:57`. It is a faithful first-appearance time **only for rows loaded since the last
  full reload (~2025-06-13 → now)**. So it cannot drive a retrospective triangle across all history.
- **`report_datetime` is faithful for all history.** Because the series buckets by `incident_date` and
  every row carries `report_datetime`, we can reconstruct a true **filing reporting-triangle** for all
  ~66 cohorts from a single current pull — no snapshots needed.
- **Volume** (Northern, 2021→now, `resolution='Open or Active'`): shoplifting ~23/mo (workable),
  commercial burglary ~9/mo + commercial robbery ~4/mo (thin — pool categories and borrow strength from
  a citywide merchant curve). Arrests settle near-instantly and are analyzed separately.

## Method

Data source unchanged: SFPD Incident Reports `wg3w-h783` on `data.sfgov.org`, Northern, merchant
subcategories, 2021-01→present, dedup by `incident_id`. Reuse the stdlib HTTP pattern in
[build/httpget.py](build/httpget.py); no new dependencies.

### Step 1 — Pull the raw rows
One paged pull of merchant-theft rows: `incident_id, incident_date, report_datetime, data_loaded_at,
data_as_of, resolution, incident_subcategory, police_district`. Keep citywide (all districts) so we can
estimate a high-power curve and test that Northern conforms. Dedup by `incident_id`.

### Step 2 — Filing reporting-triangle (primary, full history)
For each incident-month cohort **M** and horizon **h** (days after M's month-end; grid
`0,7,14,30,45,60,90` and also whole-month horizons +0/+1/+2/+3):
- `Count(M,h)` = rows with `incident_date` in M **and** `report_datetime ≤ (M month-end + h)`.
- `final(M)` = current observed total for M (treat cohorts ≥6 months old as effectively final).
- `completion f(M,h) = Count(M,h) / final(M)`.

Aggregate `f(h)` across **mature, fully-observable** cohorts → **mean, sd, p10/p50/p90**. The key
decision numbers are completion at whole-month recencies (how complete is a month 0/1/2 months after it
ends) → **uplift = 1/f** per recency, with a CI.

### Step 3 — Publication delta (validation of the report_datetime proxy)
For rows loaded after the last full reload (detect it as the dominant early `data_loaded_at` cluster),
compute `data_loaded_at − report_datetime` and `− incident_date`. This quantifies the extra
filing→portal delay (the probe suggests only a few days) and confirms the filing triangle ≈ true
settling. If the median delta is material, shift the triangle horizons by it.

### Step 4 — Consistency / stationarity tests (the crux)
The whole strategy hinges on the curve being *stable*, so a fixed uplift is trustworthy:
- Overlay `f(h)` by cohort **year** (2021–2025); report the spread of completion-at-target-recency.
- Check for a discontinuity around the **2024-04-24 category remap** (plan §5.1).
- Split **by signal** (shoplifting vs commercial-pooled) and **by resolution** (reported vs arrests).
- Test **Northern conforms to citywide** shape (simple deviation / KS-style check); if Northern is too
  thin per cohort, apply the citywide/pooled curve and state the assumption.

### Step 5 — Decision & confidence verdict
- Recommend the furthest-forward headline month whose expected completion is high and **tightly bounded**.
- Emit per-recency **uplift factors + CI** and the caveat text.
- **Confidence gate:** if the p10–p90 completion band at the target recency is tight (curve stable
  across years, signals, and vs citywide), mark **high confidence → projected range band viable**;
  otherwise **caveat-only**. This gate is the explicit output that decides the stretch goal.

## Deliverables

- **`analysis/lag_study.py`** — stdlib-only, read-only analysis; reuses the `get_json` pattern. Also
  emits a runnable Socrata `$query` URL for every stat it computes (reuse the `query_url()` urlencode
  helper in [build/build.py](build/build.py)). Writes results; makes no dashboard changes.
- **`analysis/lag_results.json`** — completion curves, per-recency uplift factors + CIs, by-year /
  by-signal / by-resolution breakdowns, publication-delta stats, the confidence verdict, **and a
  `queries` block** (label → runnable URL) so the doc and the live data can't drift — same pattern as
  `data/provenance.json`.
- **`data-lag-findings.md`** — the narrative document the user asked for: *what is really going on
  with the lag and how we arrived at it* — plain-language finding, method, the recommended new timeframe
  and caveat wording, the confidence verdict, and a candid **caveats** section (report_datetime≠portal
  proxy, `data_loaded_at` clobbering, low commercial volume, remap discontinuity, and that
  dark-figure/reporting-fatigue is a separate non-settling limit). Carries the review assets below.

## Review & reproducibility assets (embedded in the findings doc)

So the author and others can audit the work without running anything, the findings doc includes:

- **Runnable query URLs for every number.** Each headline stat, curve point, and breakdown links to the
  exact Socrata `$query` URL that produces it (click → JSON). Mirrors the
  [[dashboard-source-provenance-footnotes]] convention; URLs are generated by the build (not hand-typed)
  and stored in `lag_results.json`'s `queries` block so they stay in sync.
- **Easily-viewable stats, inline.** Pure-markdown tables + **Unicode/ASCII bar charts** (no image
  hosting, render anywhere GitHub markdown does):
  - *Completion curve* — one horizontal bar per horizon (e.g. `+0d ████████░░ 82%`), with mean and
    p10–p90 band.
  - *Reporting triangle* — a cohort-month × horizon table of completion %, lightly shaded with block
    glyphs, so the "recent months fill in over time" story is visible at a glance.
  - *Stability check* — a compact per-year row per horizon (sparkline-style) showing the curve barely
    moves across 2021–2025, which is the evidence the fixed uplift is trustworthy.
  - *Headline stats callout* — recommended latest month, its expected completion %, the uplift caveat
    (`+Y% ± z`), and the confidence verdict, up top.
- **Optional committed SVG(s).** If an inline chart isn't clear enough, generate a small hand-rolled SVG
  (stdlib string templating, matching the repo's [js/chart.js](js/chart.js) ethos) under `analysis/` and
  reference it by relative path — the repo is a static site, so committed SVG/PNG render on GitHub and on
  Pages. Kept optional to avoid over-engineering; ASCII/tables are the committed baseline.

## Verification

- **Maturity sanity:** old cohorts (e.g. 2024) must show `f(h) → ~1.0` at large `h`.
- **Cross-check the baked numbers:** the triangle's within-30-days share should reconcile with the
  existing `reporting_lag()` output (currently ~88% within 30d, p90≈48d).
- **Spot-check by hand:** reproduce `Count(M,h)` for 1–2 cohorts via a direct Socrata query
  (`incident_date` in M `AND report_datetime <= …`) and confirm the script matches.
- **Reconcile the recommendation** against today's `SETTLE_LAG_MONTHS = 2` — the study should either
  justify shrinking it or explain why 2 stays.

## Follow-on: implement the recommendation (the remaining work)

This is the part a fresh session should pick up. The research above is done; what's left is wiring the
finding into the dashboard. **Confirm with the user before editing** — this changes what the public site
shows.

**Goal:** advance the reported headline one month more current (−2 → −1), with a research-backed caveat,
while keeping the slow-settling arrest series conservative and flagged.

**Root cause to fix first:** [build/build.py](build/build.py) `reporting_lag()` (currently ~line 47)
computes the baked `settling` stat with **no `resolution` filter** — so its p90≈48 d is really the arrest
tail (`Cite or Arrest Adult`, p90 = 242 d), not the reported metric (p90 = 9 d). That mixed stat is what
justified the 2-month buffer.

**Concrete changes:**
1. **`build/build.py` — split the lag stat by resolution.** Add `AND resolution='Open or Active'` to
   `reporting_lag()` (or have it return reported + arrests separately). The reported-only stat is what the
   headline caveat should cite (~98% at 1 month).
2. **`build/build.py` — advance the headline.** `SETTLE_LAG_MONTHS: 2 → 1` (build.py ~line 29).
   `latest_settled = months[-2 - SETTLE_LAG_MONTHS]` (~line 186) already parametrizes on the constant, so
   this shifts the headline forward exactly one month. **Design decision to raise with the user:** one
   global `SETTLE_LAG_MONTHS` currently gates the headline month, the shaded chart region, the 2-week week
   anchor, *and* the arrests context. Moving it to 1 also makes recent arrests look "settled" when they
   aren't. Options: (a) keep it global and rely on an arrests-are-provisional caveat, or (b) introduce a
   second constant / per-resolution settle so arrests stay on the −2 buffer. The findings recommend
   keeping arrests conservative → lean (b), but confirm.
3. **`js/app.js` — reword the settling callout** (~lines 185–198, `agg.settling`) with the reported-only
   numbers and the caveat: *"~98% settled; late-filed reports typically add ~2% (rarely >5%)."* Also the
   as-of line (~line 44) and the "latest settled month" tooltip (~line 109) follow `latest_settled_month`
   automatically — verify they read correctly after the shift.
4. **`js/app.js` / `js/chart.js` — shaded region.** `unsettledFromIdx: settledIdx + 1` (app.js ~line 173)
   auto-follows the new settled month; one fewer month will be shaded. Confirm the "still settling" band
   (chart.js ~line 33) still lands where intended.
5. **`build/build.py` provenance `settle_note`** (~line 225) — rewrite to describe the reported vs arrests
   split rather than a flat "2 most recent months still accruing."
6. **Optional (high-confidence stretch):** a projected range band on the chart for the most recent 1–2
   months (~+2% at −1, ~+8% at −0). The confidence gate passed (p10–p90 = 5.0 pts at k=1), so it's
   defensible; the caveat alone is sufficient and simpler.

**Note on month labels:** the findings doc's specific months ("April→May") are as-of the 2026-07-31 pull;
the formula is relative, so the actual months advance with the calendar. Cite the formula, not the labels.

**Verify after implementing:**
- Re-run `python3 analysis/lag_study.py` to refresh numbers if the pull is stale.
- Run the theft e2e + the [[e2e-data-trace-harness]] validation (`npm test`) — the trace harness reconciles
  baked numbers against each signal's declared Socrata query, so a changed settle stat must still tie out.
- Confirm the reported headline moved one month, arrests handling matches the chosen option (2b vs 2a), and
  the callout/provenance copy reflects the reported-only ~98%/+2% story.

## Out of scope (research pass — now superseded by the follow-on above)
- No prospective snapshot harness (user chose retrospective-only).
- Dark-figure / reporting-fatigue is a data-interpretation limit, not a settling artifact — noted in the
  findings caveats, not corrected here.
