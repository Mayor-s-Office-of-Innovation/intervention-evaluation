# Theft dashboard — data availability & settling

_What is trustworthy right now vs. what is present but still filling in. Snapshot of the baked
data as of build **2026-07-28** (provenance `generated`); today is 2026-07-31._

## Source & scope

| | |
|---|---|
| Dataset | **SFPD Incident Reports** `wg3w-h783` on `data.sfgov.org` |
| District | **Northern** (native `police_district` field — no point-in-polygon) |
| History window | **2021-01** → present (2018–2020 dropped: pandemic distortion, D13) |
| Occurrence basis | `incident_date` (when it happened), not filing date |
| Two axes | **reported** = `resolution='Open or Active'` (victim/merchant reports, want ↓) · **arrests** = `resolution='Cite or Arrest Adult'` (context, not a target) |
| Signals | **Shoplifting** · **Commercial burglary & robbery** (lumped). Excluded: `Theft from Merchant or Library` (fading legacy code) |

## Why recent data isn't final

SFPD reports enter `wg3w-h783` **only after a supervisor approves them**, so a calendar month keeps
filling in for weeks after it ends. The most recent month or two therefore under-report and would read
as a false drop if trusted. The build guards against this with **`SETTLE_LAG_MONTHS = 2`**: the headline
evaluates the latest month that is `latest_complete − 2`.

### Reporting-lag profile
Measured over a fully-settled 12-month window (**Jul 2024–Jun 2025, n=656** merchant-theft reports in Northern):

| Metric | Value |
|---|---|
| Median incident→report-filed lag | **0 days** (most filed same day) |
| Filed within 7 days | 83% |
| Filed within 30 days | **88%** |
| Filed within 60 days | 92% |
| p90 (long tail) | **48 days** — ~10% take 48+ days |

That long tail is why two full months, not just the current partial one, are treated as unsettled.

## What's available now vs. what's still settling

### Monthly (drives the headline + charts)

| State | Month(s) | Status |
|---|---|---|
| ✅ **Settled — headline uses this** | **2026-04** (`latest_settled_month`) | Trustworthy; evaluate here |
| 🟡 **Complete calendar month, still accruing** | **2026-05, 2026-06** | Present but **shaded "still settling"** on charts — do not read as a trend |
| ⚪ **Current partial month** | **2026-07** (`current_partial_month`) | Excluded from evaluation entirely |
| `latest_complete_month` | 2026-06 | Last month with a finished calendar, but not yet settled |

So: **monthly data is trustworthy through April 2026**; May/June 2026 exist but are incomplete; July 2026 is partial.

### Weekly (homepage 2-week YoY chip)

| State | Week (Mon start) | Status |
|---|---|---|
| ✅ **Settled fortnight anchor** | **2026-04-20** (`latest_settled_week`) | What the 2wk chip reports against |
| 🟡 Complete but settling | up to **2026-07-20** (`latest_complete_week`) | Filling in |
| ⚪ Current partial week | **2026-07-27** (`current_partial_week`) | Partial |
| Settle lag | **~13 weeks** (`settle_lag_weeks`) | The settled week sits ~2 months back, matching the monthly buffer |

## How this surfaces to viewers

- Still-settling months are **shaded with a "still settling" label** on every chart (`chart.js`).
- A callout ("Recent months aren't final — that's why we evaluate April 2026") explains the approval
  lag and cites the median / 30-day / p90 numbers above (`app.js`).
- The Improving / Worsening badge follows the **de-noised 12-month trend**, not any single month, so a
  noisy or half-settled month can't flip the verdict.
- The as-of line reads: _"latest settled month April 2026 · built 2026-07-28."_

## Where these values live

- **Baked outputs:** `theft/data/aggregates.json` (keys: `latest_settled_month`,
  `latest_complete_month`, `settle_lag_months`, `current_partial_month`, weekly equivalents, and the
  `settling` lag profile) and `theft/data/provenance.json` (`settle_note`, axis/signal definitions).
- **Logic:** `theft/build/build.py` (`SETTLE_LAG_MONTHS`, `reporting_lag()`, `settled_week()`).
- **Rationale:** `theft/plan.md` §5.4 and decisions D5 / D12.
- **Refresh:** `cd theft && python3 build/build.py` (recomputes all settle anchors from live Socrata).
