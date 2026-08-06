# Theft data lag — what's really going on, and can we show more-recent months?

_Findings from [analysis/lag_study.py](analysis/lag_study.py) · data pulled 2026-07-31 ·
source SFPD Incident Reports `wg3w-h783`, Northern, merchant categories, 2021→present._
_Every number below links to a runnable Socrata query; re-run [the script](analysis/lag_study.py)
to regenerate [analysis/lag_results.json](analysis/lag_results.json)._

---

## TL;DR

> **The metric the dashboard shows — victim/merchant _reported_ theft — settles fast and predictably.**
> A month is **~92% complete the moment it closes, ~98% one month later, ~99% by two.**
> The current dashboard holds the headline **2 months back**; the evidence says we can safely move it to
> **1 month back** with a small, research-backed caveat.
>
> | If we show a month… | Typical completeness | Expect the final number to rise | Confidence |
> |---|---|---|---|
> | the moment it closes (**−0**) | ~92% (but 82–100% range) | **~+8%** (occasionally more) | moderate — volatile |
> | **1 month after close (−1)** ✅ recommended | **~98%** (95–100%) | **~+2%** (rarely >5%) | **high** |
> | 2 months after close (−2) — *current* | ~99% | ~+1% | high (but stale) |
>
> **Why the dashboard is currently over-cautious:** the settle buffer was calibrated against a lag
> statistic that **mixes in arrests**, and arrests settle enormously slower (p90 = **242 days**) and
> erratically. The victim-reported series that actually drives the headline does **not** have that tail.

---

## 1. The core finding: reports vs. arrests settle on totally different clocks

The dashboard's headline is **theft reported by businesses** (`resolution = 'Open or Active'`). Arrests
(`Cite or Arrest Adult`) are shown only as context below the chart. Measured over a fully-settled window
(incidents Jul 2024–Jun 2025, so every late report has landed), the two resolutions behave completely
differently:

| Resolution | n | median lag | filed ≤30 days | p90 lag | slowest |
|---|---|---|---|---|---|
| **Open or Active** (reports — the headline) | 424 | 0 d | **94%** | **9 d** | 332 d |
| Cite or Arrest Adult (arrests — context) | 232 | 0 d | 77% | **242 d** | 395 d |
| _Both combined_ (what the old stat measured) | 656 | 0 d | 88% | **48 d** | 395 d |

An arrest can be logged months after the incident (investigation, later apprehension), so it drips into
old months for a long time. A victim report is almost always filed within days. **The baked `settling`
note on the dashboard reports the _combined_ 48-day p90 — which is really the arrest tail — and that is
what justified holding the headline 2 months back.** For the reported metric, that buffer is bigger than
it needs to be.

Verify: [reported rows, incident→report, recent settled window](https://data.sfgov.org/resource/wg3w-h783.json?%24query=SELECT+incident_date%2C+report_datetime+WHERE+%28incident_subcategory+in%28%27Larceny+Theft+-+Shoplifting%27%2C%27Burglary+-+Commercial%27%2C%27Robbery+-+Commercial%27%29%29+AND+police_district%3D%27Northern%27+AND+resolution%3D%27Open+or+Active%27+AND+incident_date+%3E%3D+%272024-07-01%27+AND+incident_date+%3C+%272025-07-01%27+ORDER+BY+incident_date)
(compute `report_datetime − incident_date`; compare to the same query with `resolution='Cite or Arrest Adult'`).

## 2. How complete is a recent month? (the completion curve)

For every mature incident-month (≥6 months old, so effectively final), we ask what share of its eventual
reports had been **filed** by _N days after the month ended_, then average across all 61 mature months
(Jan 2021 – Jan 2026). Reported metric, Northern merchant theft:

```
days after     completion (mean, ██ = filled, ░░ = still missing)
month close
  +0d   92.2%   ██████████████████░░
  +7d   95.3%   ███████████████████░
 +14d   96.4%   ███████████████████░
 +30d   98.2%   ███████████████████▉
 +45d   98.9%   ████████████████████
 +60d   99.1%   ████████████████████
 +90d   99.4%   ████████████████████
```

By **whole months** after a month closes (the unit the dashboard actually steps in), with the spread
across months and the resulting uplift:

```
months after   completion   range (p10–p90)     → expected uplift to final
month close
  k=0   92.2%   ████████████████░░   82.5–100%      ×1.08  (+8%)
  k=1   98.2%   ███████████████████▉ 95.0–100%      ×1.02  (+2%)   ✅ recommended headline
  k=2   99.1%   ████████████████████ 96.7–100%      ×1.01  (+1%)   (current setting)
  k=3   99.4%   ████████████████████ 97.1–100%      ×1.01  (+1%)
```

Source series: [Northern merchant monthly reported counts](https://data.sfgov.org/resource/wg3w-h783.json?%24query=SELECT+date_trunc_ym%28incident_date%29+AS+month%2C+count%28%2A%29+AS+n+WHERE+%28incident_subcategory+in%28%27Larceny+Theft+-+Shoplifting%27%2C%27Burglary+-+Commercial%27%2C%27Robbery+-+Commercial%27%29%29+AND+police_district%3D%27Northern%27+AND+resolution%3D%27Open+or+Active%27+AND+incident_date+%3E%3D+%272021-01-01%27+GROUP+BY+month+ORDER+BY+month).

## 3. The reporting triangle (recent months filling in)

Each row is one incident-month; each column is completeness at that many days after the month closed.
You can watch the recent months finish filling in — nearly all reach ~100% by two weeks:

```
cohort   final  +0d  +7d  +14d  +30d  +60d
2025-06    26    85%  96%  100%  100%  100%
2025-07    45    98%  98%   98%   98%   98%
2025-08    48    98% 100%  100%  100%  100%
2025-09    32    88% 100%  100%  100%  100%
2025-10    37    86%  89%  100%  100%  100%
2025-11    35    91% 100%  100%  100%  100%
2025-12    42    93%  98%  100%  100%  100%
2026-01    45   100% 100%  100%  100%  100%
```

Hand spot-check for **Jan 2025**: [eventual total](https://data.sfgov.org/resource/wg3w-h783.json?%24query=SELECT+count%28%2A%29+AS+n+WHERE+%28incident_subcategory+in%28%27Larceny+Theft+-+Shoplifting%27%2C%27Burglary+-+Commercial%27%2C%27Robbery+-+Commercial%27%29%29+AND+police_district%3D%27Northern%27+AND+resolution%3D%27Open+or+Active%27+AND+incident_date+%3E%3D+%272025-01-01%27+AND+incident_date+%3C+%272025-02-01%27)
= **32**, and [filed within +30 days](https://data.sfgov.org/resource/wg3w-h783.json?%24query=SELECT+count%28%2A%29+AS+n+WHERE+%28incident_subcategory+in%28%27Larceny+Theft+-+Shoplifting%27%2C%27Burglary+-+Commercial%27%2C%27Robbery+-+Commercial%27%29%29+AND+police_district%3D%27Northern%27+AND+resolution%3D%27Open+or+Active%27+AND+incident_date+%3E%3D+%272025-01-01%27+AND+incident_date+%3C+%272025-02-01%27+AND+report_datetime+%3C%3D+%272025-03-02%27)
= **32** → 100% settled within a month. ✔

## 4. Is the lag stable enough to bake a fixed caveat? (yes)

The caveat is only trustworthy if the curve doesn't wander year to year. Mean completion of reported
theft, by cohort year:

```
year   n    at close (k0)   1mo later (k1)
2021   12      94.6%           99.0%   ▇
2022   12      88.2%           96.8%   ▆
2023   12      95.9%           99.1%   ▇
2024   12      91.5%           97.6%   ▇
2025   12      90.2%           98.5%   ▇
```

One month after close, every year lands in a tight **96.8–99.1%** band — no drift, and no visible break
around the Apr-2024 category remap. **Cross-population check:** citywide merchant theft settles almost
identically (k=1 = 98.4% citywide vs 98.2% Northern), so this isn't a Northern small-sample fluke. The
thin commercial signal alone also settles fast (k=1 = 98.4%), so it needs no special handling.

**Confidence verdict (from the script):** at k=1 the p10–p90 spread is 5.0 points (one-sided, since it
caps at 100%) → **high confidence · projected range band viable.**

## 5. Recommendation

1. **Move the headline settle buffer from −2 months to −1 month** (`SETTLE_LAG_MONTHS: 2 → 1`). Today
   that would advance the headline from **April 2026 → May 2026**.
2. **Add the research-backed caveat:** _"May 2026 is ~98% settled; late-filed reports typically add ~2%
   (rarely more than ~5%), so this figure will edge up slightly."_
3. **Because confidence is high, a projected range band is defensible** on the chart for the most recent
   1–2 months (show observed + a thin "expected final" band of roughly +2% at −1, +8% at −0). Optional —
   the caveat alone is sufficient and simpler.
4. **Keep arrests on the −2 (or longer) buffer and flagged as provisional.** Arrests settle slowly and
   erratically (recent-year k=1 completion drops to ~73%), so recent arrest counts should not be read as
   final. This is a context-only series, so it doesn't gate the headline.
5. **Showing the just-closed month (−0) is possible but not recommended** as the headline: at ~92% mean
   with an 82–100% spread it's too volatile at this district's low volume. Fine to display shaded with a
   wider caveat, not as the primary number.

## 6. Method (how we arrived at this)

- **Filing reporting-triangle.** The series buckets by `incident_date`; every row also carries
  `report_datetime` (when the report was filed). For each incident-month cohort we counted the share of
  its eventual reports filed by each horizon, using only **mature cohorts (≥180 days old)** as the
  denominator so "final" is truly final. Aggregated across cohorts → the curves above.
- **Why not `data_loaded_at`?** It's the honest "when did this row appear" field, but it gets
  **overwritten on full reloads** — 19,711 rows share the single stamp `2025-06-13`. So it can't
  reconstruct history. We used `report_datetime` (faithful for all rows) for the triangle instead.
- **Publication delta.** For rows loaded _after_ the last full reload (a faithful window, n=4,855), the
  gap from `report_datetime` to `data_loaded_at` is **median 2 days** (83% within 7). So "filed" ≈ "in
  the portal" within a couple of days — the filing triangle is a sound proxy for true settling.
  Verify: [faithful load-lag window](https://data.sfgov.org/resource/wg3w-h783.json?%24query=SELECT+incident_date%2C+report_datetime%2C+data_loaded_at+WHERE+%28incident_subcategory+in%28%27Larceny+Theft+-+Shoplifting%27%2C%27Burglary+-+Commercial%27%2C%27Robbery+-+Commercial%27%29%29+AND+police_district%3D%27Northern%27+AND+data_loaded_at+%3E+%272025-06-14%27+ORDER+BY+data_loaded_at+DESC).

**Verification performed**
- Reproduced the dashboard's baked lag exactly: all-resolutions p90 = **48 d**, 88% ≤30d, n=656. ✔
- Maturity sanity: completion → 99%+ at long horizons (never a false <100% for old cohorts). ✔
- Hand spot-check of the Jan-2025 cohort matches the script (32/32 by +30d). ✔
- Northern conforms to citywide; thin commercial signal conforms too. ✔

## 7. Caveats & limits

- **`report_datetime` ≈ portal-visible, not identical.** It's a proxy; the measured publication delta
  (~2 days median) is what separates them. Immaterial at monthly resolution, but stated for honesty.
- **Low volume amplifies the just-closed month.** Northern merchant reports run ~30/month, so one or two
  late filings swing the −0 percentage — hence the wide k=0 spread and the recommendation to move only to
  −1, not −0.
- **This is a settling correction, not a truth correction.** It tells us when the _reported_ count is
  complete. It does **not** address the dark figure / reporting fatigue (thefts merchants never report) —
  that's a separate limitation of victim-reported data, unchanged by this analysis.
- **Curve is stable through 2021–2026 but not guaranteed forever.** If SFPD changes reporting workflow or
  reloads behavior, re-run [analysis/lag_study.py](analysis/lag_study.py) to refresh the numbers.

## 8. Follow-on (not done here)

Implementing the recommendation is a separate change to [build/build.py](build/build.py) and the
`settling` callout in [js/app.js](js/app.js): split the lag stat by resolution, drop `SETTLE_LAG_MONTHS`
to 1 for the reported headline, keep arrests conservative, and reword the callout with the ~+2% caveat.
Tracked in [plan-data-lag-research.md](plan-data-lag-research.md) as the follow-on pass.
