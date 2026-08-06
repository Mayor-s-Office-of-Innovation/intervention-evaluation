# Settle rule v2 — completeness-estimated settled month

**Status:** ✅ SHIPPED 2026-08-06. Supersedes the fixed `REPORTED_SETTLE_LAG = 1` selection for the
reported headline. Builds on [plan-property-crime-expansion.md](plan-property-crime-expansion.md)
Workstream F (per-*resolution* settling) — this adds per-*age* completeness estimation.

**As-built (today):** rule yields **June** — July's latest-complete month estimates **95.8%** complete
(below the 98.5% bar), June estimates **98.1%** complete (~1.9% still to arrive). Settled month
unchanged vs the fixed −1, so `trace.py theft` stays 0.00% and the baked series are identical; the only
change users see is the new completeness sentence on the reporting-note card. July auto-promotes once it
clears 98.5% (~late Aug). Theft e2e 9/9. Note: the completeness uses the **Northern reported** lag curve
(same axis as the caveat stat), which runs a touch slower than the citywide/all-merchant figures in the
table below (June ≈1.9% missing Northern vs ≈1.3% citywide) — both sit at the mature floor.

## Question
Production shipped April as the settled month; the current build shows June (reported, −1). The user
asked whether shoplifting vs commercial burglary settle differently, whether we can **estimate the
missing % of a recent month's reports**, and use that to pick **when a month's data is solid**.

## What the data says (analysis/ scripts, reproducible)
- **Shoplifting vs commercial settle nearly identically** on the reported axis — both ~98% of reports
  filed within 30 days of the incident; commercial is marginally *faster* (p90 2d vs shoplifting 6d).
  So there is **no basis for a per-category settled month**. (`analysis/settle_by_category.py`)
- **The dataset is truncate-and-reload daily** — Socrata `:created_at` is identical for every row (one
  reload timestamp), so we can't measure appearance lag from metadata. But a report filed yesterday is
  already present today, so **appearance lag ≈ reporting lag + <1 day** — the incident→report CDF is a
  sound completeness model. (`analysis/appearance_probe.py`)
- **Completeness model** (`analysis/completeness_model.py`): convolving the reporting-lag CDF over a
  month's incident dates gives the estimated missing % of a month by age:

  | days after month-end | all-merchant missing % |
  |---|---|
  | 0 | 6.6% |
  | 6 | 3.7% |
  | 12 | 2.7% |
  | **21** | 2.0% |
  | 30 | 1.5% |
  | 37 | 1.3% |

  - The curve **flattens ~day 21** toward a ~1% long-tail floor. Absolute 99% isn't reached until
    ~day 55 (a slow >30-day tail), so "solid" must be defined against the **mature floor**, not 100%.
  - **June today (37d): ~1.3% missing** — at the mature floor. **July today (6d): ~3.7% missing** — would
    still revise up ~2–2.5%. This *sharpens* the eyeball "July ≥ June" (July only looked high because it
    was a bigger month; it's still short of its own eventual total).

## Decision
Replace the fixed −1 with a **completeness-threshold rule** and **surface the estimate on the card**:

- Estimate completeness of the **latest complete month** from the baked reporting-lag CDF and its age
  (days since month-end, using `TODAY`).
- If completeness ≥ **`SOLID_COMPLETENESS = 0.985`** → evaluate that month; else fall back one month
  (always ≥31 days old ⇒ always mature ⇒ always safe). Never go below −1 for reported.
- Arrests unchanged: still −2 (genuine long enforcement tail, p90 ≈ 242d).
- Threshold rationale: the −1 months we already trust sit at ~98.7% complete, so 98.5% means "as solid
  as the months we already publish." Today the rule yields **June** (July is only ~96.4%); it will
  auto-promote **July ~Aug 30** once July clears 98.5%.

## Implementation
1. **`build/build.py`**
   - `reporting_lag()` also returns a `cdf` list (`F(k)` for k = 0..120).
   - Add `SOLID_COMPLETENESS`, `month_last_day()`, `month_completeness(cdf, delta, D)` helpers.
   - Selection: compute `latest_complete` completeness at its current age; pick settled month by the
     threshold rule; compute the **effective** lag and bake it as `settle_lag_months`.
   - Bake new fields: `settled_completeness_pct`, `settled_missing_pct`, and
     `latest_complete_completeness_pct` (for the "why not the newest month yet" story).
   - Extend the provenance `settle_note` with the completeness estimate.
2. **`js/app.js`** `renderReportingNote()`
   - Add one sentence: the evaluated month is ~X% complete (≈Y% of reports still to arrive), from the
     measured reporting-lag curve. When settled ≠ latest-complete, explain the newest month is only
     ~Z% complete so the headline holds back until it firms up.
   - **Card "newest-month peek" (chosen 2026-08-06 — "June headline + July peek"):** the headline
     number + verdict stay on the solid settled month; each card adds a small secondary line
     `<div class="primary__peek">{Mon} so far <strong>N</strong> · ~Z% complete</div>` for the
     held-back newest complete month. Rendered only when `latest_complete_month !== latest_settled_month`
     (so it disappears once July promotes and there's nothing to hold back). Rejected: making July the
     evaluated headline (its ~4% undercount biases a down-is-good metric and skews the vs-last/vs-year
     chips) and a grossed-up estimate (puts a modeled number in the headline).
3. **Tests / validation**
   - `tests/e2e.spec.js`: keep existing assertions; add a check that the note surfaces a completeness /
     missing-% figure. Selection is date-dependent → assert on the *presence/shape* of the estimate,
     not a hard-coded month.
   - Run `build.py`, `npm test` (theft e2e), `validation/trace.py theft` — baked series unchanged today
     (settled month stays June), so trace must remain 0.00%.

## Out of scope
- Per-category settled months (data shows no difference).
- Two-snapshot backfill measurement (no historical snapshots; daily-reload wipes `:created_at`).
