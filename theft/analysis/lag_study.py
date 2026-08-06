"""Theft data-lag study — how late do merchant-theft reports settle, and is that lag stable
enough to publish more-recent months with a research-backed caveat?

Read-only. Stdlib only. Makes NO dashboard/build changes. See ../plan-data-lag-research.md.

Method (recap):
  • report_datetime is faithful for all history; data_loaded_at is clobbered on full reloads
    (every pre-2025-06-13 row shares one stamp), so we reconstruct a FILING reporting-triangle
    from report_datetime and only use data_loaded_at (post-reload) to measure the extra
    filing→portal publication delta.
  • For each incident-month cohort M we ask: what fraction of the cohort's eventual reports had
    been FILED by k months after M ended? Aggregated over mature cohorts → completion curve,
    per-recency uplift (=1/completion), a stability check across years, and a confidence verdict.

Run:  python3 analysis/lag_study.py   (from theft/)  → analysis/lag_results.json
"""
import datetime
import json
import os
import statistics
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "build"))
from httpget import get_json                                    # noqa: E402
from signals import DATASET, DOMAIN, HISTORY_START             # noqa: E402

TODAY = datetime.date.today()
MERCHANT_WHERE = ("incident_subcategory in('Larceny Theft - Shoplifting',"
                  "'Burglary - Commercial','Robbery - Commercial')")
RES_REPORTED = "Open or Active"
RES_ARREST = "Cite or Arrest Adult"

# Cohorts younger than this many days aren't "final" yet, so they can't anchor the curve.
MATURITY_DAYS = 180
# Day-grid (days after month-end) for the curve SHAPE; whole-month recencies for the DECISION.
DAY_GRID = [0, 7, 14, 30, 45, 60, 90]
MONTH_GRID = [0, 1, 2, 3]
TARGET_K = 1          # the recency the "move one month more current" decision hinges on
CONF_BAND = 0.05      # high confidence if p10–p90 completion spread at TARGET_K ≤ 5 points


# ── Socrata helpers (mirror build/build.py) ──────────────────────────────────────────────
def soql_url(select, where, group=None, order=None, limit=50000, offset=0):
    params = {"$select": select, "$where": where, "$limit": str(limit)}
    if group:
        params["$group"] = group
    if order:
        params["$order"] = order
    if offset:
        params["$offset"] = str(offset)
    return f"https://{DOMAIN}/resource/{DATASET}.json?" + urllib.parse.urlencode(params)


def query_url(soql_query):
    """A runnable Socrata JSON link for an exact $query string (for doc footnotes)."""
    return f"https://{DOMAIN}/resource/{DATASET}.json?" + urllib.parse.urlencode({"$query": soql_query})


def fetch_rows():
    """Page every merchant-theft row citywide (Northern is derived in-memory)."""
    select = ("incident_id, incident_date, report_datetime, data_loaded_at, "
              "resolution, incident_subcategory, police_district")
    where = f"({MERCHANT_WHERE}) AND incident_date >= '{HISTORY_START}'"
    rows, offset, page = [], 0, 50000
    while True:
        batch = get_json(soql_url(select, where, order="incident_id", limit=page, offset=offset))
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


# ── date utilities ───────────────────────────────────────────────────────────────────────
def d(iso):
    return datetime.date.fromisoformat(iso[:10]) if iso else None


def ym_of(dt):
    return f"{dt.year:04d}-{dt.month:02d}"


def month_end(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return (datetime.date(y + 1, 1, 1) if m == 12 else datetime.date(y, m + 1, 1)) - datetime.timedelta(days=1)


def add_months_end(ym, k):
    """month-end of the cohort k whole months later (k=0 → M's own month-end)."""
    y, m = int(ym[:4]), int(ym[5:7])
    total = y * 12 + (m - 1) + k
    return month_end(f"{total // 12:04d}-{total % 12 + 1:02d}")


def pct(sorted_vals, p):
    if not sorted_vals:
        return None
    i = min(len(sorted_vals) - 1, int(p / 100 * len(sorted_vals)))
    return sorted_vals[i]


# ── the reporting triangle ─────────────────────────────────────────────────────────────────
def build_cohorts(rows):
    """{ym: [report_date, ...]} — dedup by incident_id, keyed by incident-month."""
    seen, cohorts = set(), {}
    dupes = 0
    for r in rows:
        iid = r.get("incident_id")
        if iid in seen:
            dupes += 1
            continue
        seen.add(iid)
        inc, rep = d(r.get("incident_date")), d(r.get("report_datetime"))
        if not inc or not rep:
            continue
        cohorts.setdefault(ym_of(inc), []).append(rep)
    return cohorts, dupes


def completion_curve(cohorts):
    """For mature cohorts, completion = (#reports filed by horizon) / (cohort final total).
    Returns day-grid curve (shape), month-grid curve (decision), and per-year month curve."""
    mature = {m: reps for m, reps in cohorts.items()
              if (TODAY - month_end(m)).days >= MATURITY_DAYS and m >= HISTORY_START[:7]}

    def frac_by(reps, horizon_date):
        final = len(reps)
        return sum(1 for rp in reps if rp <= horizon_date) / final if final else None

    day_curve = []
    for h in DAY_GRID:
        vals = sorted(f for m, reps in mature.items()
                      if (f := frac_by(reps, month_end(m) + datetime.timedelta(days=h))) is not None)
        day_curve.append(_summ(h, vals))

    month_curve = []
    for k in MONTH_GRID:
        vals = sorted(f for m, reps in mature.items()
                      if (f := frac_by(reps, add_months_end(m, k))) is not None)
        month_curve.append(_summ(k, vals))

    by_year = {}
    years = sorted({m[:4] for m in mature})
    for yr in years:
        ycoh = {m: reps for m, reps in mature.items() if m[:4] == yr}
        row = {}
        for k in MONTH_GRID:
            vals = [f for m, reps in ycoh.items()
                    if (f := frac_by(reps, add_months_end(m, k))) is not None]
            row[str(k)] = round(statistics.mean(vals), 4) if vals else None
        by_year[yr] = {"n_cohorts": len(ycoh), "completion_by_k": row}

    return {
        "n_cohorts_mature": len(mature),
        "cohort_range": [min(mature), max(mature)] if mature else None,
        "day_curve": day_curve,
        "month_curve": month_curve,
        "by_year": by_year,
    }


def _summ(key, vals):
    if not vals:
        return {"key": key, "n": 0}
    mean = statistics.mean(vals)
    return {
        "key": key, "n": len(vals),
        "mean": round(mean, 4),
        "sd": round(statistics.pstdev(vals), 4) if len(vals) > 1 else 0.0,
        "p10": round(pct(vals, 10), 4), "p50": round(pct(vals, 50), 4),
        "p90": round(pct(vals, 90), 4),
        "min": round(vals[0], 4), "max": round(vals[-1], 4),
        "uplift": round(1 / mean, 4) if mean else None,
    }


def filing_lag_stats(cohorts_rows, lo, hi):
    """Reconcile with build.reporting_lag(): incident→report lag over a settled window."""
    lags = sorted(x for x in cohorts_rows if x is not None and x >= 0)
    n = len(lags)
    if not n:
        return None
    within = lambda dd: round(sum(1 for x in lags if x <= dd) / n * 100)
    return {"window": f"{lo}..{hi}", "n": n, "median_days": pct(lags, 50),
            "within_7_pct": within(7), "within_30_pct": within(30),
            "within_60_pct": within(60), "p90_days": pct(lags, 90)}


# ── publication delta (report_datetime → data_loaded_at), faithful post-reload rows only ────
def publication_delta(rows):
    loaded_dates = [d(r["data_loaded_at"]) for r in rows if r.get("data_loaded_at")]
    hist = {}
    for ld in loaded_dates:
        hist[ld] = hist.get(ld, 0) + 1
    reload_date = max(hist, key=hist.get)              # the bulk-reload spike (all pre-reload rows share it)
    faithful = []
    for r in rows:
        ld, rep = d(r.get("data_loaded_at")), d(r.get("report_datetime"))
        if ld and rep and ld > reload_date:
            faithful.append((ld - rep).days)
    faithful = sorted(x for x in faithful if x >= 0)
    n = len(faithful)
    return {
        "detected_reload_date": reload_date.isoformat(),
        "reload_row_count": hist[reload_date],
        "faithful_n": n,
        "median_days": pct(faithful, 50),
        "p90_days": pct(faithful, 90),
        "within_2_pct": round(sum(1 for x in faithful if x <= 2) / n * 100) if n else None,
        "within_7_pct": round(sum(1 for x in faithful if x <= 7) / n * 100) if n else None,
    }


def group(rows, district=None, signal=None, resolution=None):
    def keep(r):
        if district and r.get("police_district") != district:
            return False
        if resolution and r.get("resolution") != resolution:
            return False
        if signal == "shoplifting" and r.get("incident_subcategory") != "Larceny Theft - Shoplifting":
            return False
        if signal == "commercial" and r.get("incident_subcategory") not in (
                "Burglary - Commercial", "Robbery - Commercial"):
            return False
        return True
    return [r for r in rows if keep(r)]


def confidence_verdict(primary_month_curve):
    entry = next((c for c in primary_month_curve if c.get("key") == TARGET_K), None)
    if not entry or not entry.get("n"):
        return {"level": "unknown", "reason": "no mature cohorts at target recency"}
    band = round(entry["p90"] - entry["p10"], 4)
    high = band <= CONF_BAND
    return {
        "target_k_months": TARGET_K,
        "mean_completion": entry["mean"],
        "p10_p90_band": band,
        "uplift": entry["uplift"],
        "expected_increase_pct": round((entry["uplift"] - 1) * 100, 1) if entry["uplift"] else None,
        "level": "high" if high else "moderate",
        "range_band_viable": high,
        "rule": f"high if p10–p90 spread at k={TARGET_K} ≤ {CONF_BAND}",
    }


def main():
    rows = fetch_rows()
    n_pulled = len(rows)

    groups = {
        "northern_reported_all": group(rows, "Northern", None, RES_REPORTED),
        "northern_reported_shoplifting": group(rows, "Northern", "shoplifting", RES_REPORTED),
        "northern_reported_commercial": group(rows, "Northern", "commercial", RES_REPORTED),
        "northern_arrests_all": group(rows, "Northern", None, RES_ARREST),
        "citywide_reported_all": group(rows, None, None, RES_REPORTED),
    }
    results = {}
    dup_total = 0
    for name, grp in groups.items():
        cohorts, dupes = build_cohorts(grp)
        dup_total += dupes
        results[name] = {"n_rows": len(grp), **completion_curve(cohorts)}

    primary = results["northern_reported_all"]["month_curve"]

    # Cross-check vs build.reporting_lag(): Northern merchant reports, over a fully-settled
    # window from 24 to 12 months back (same window the baked `settling` block uses).
    def first_of_month(mb):
        total = TODAY.year * 12 + (TODAY.month - 1) - mb
        return datetime.date(total // 12, total % 12 + 1, 1)
    lo_ref, hi_ref = first_of_month(24), first_of_month(12)
    xcheck_rows = [(d(r["report_datetime"]) - d(r["incident_date"])).days
                   for r in group(rows, "Northern", None, RES_REPORTED)
                   if r.get("report_datetime") and r.get("incident_date")
                   and lo_ref <= d(r["incident_date"]) < hi_ref]
    filing_ref = filing_lag_stats(xcheck_rows, lo_ref.isoformat(), hi_ref.isoformat())

    out = {
        "generated": TODAY.isoformat(),
        "dataset": DATASET,
        "domain": DOMAIN,
        "history_start": HISTORY_START,
        "merchant_where": MERCHANT_WHERE,
        "maturity_days": MATURITY_DAYS,
        "day_grid": DAY_GRID,
        "month_grid": MONTH_GRID,
        "target_k_months": TARGET_K,
        "n_rows_pulled": n_pulled,
        "dedup_dropped": dup_total,
        "publication_delta": publication_delta(rows),
        "filing_lag_crosscheck": filing_ref,
        "groups": results,
        "confidence": confidence_verdict(primary),
        "queries": build_queries(),
    }

    path = os.path.join(HERE, "lag_results.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=2)

    c = out["confidence"]
    print(f"pulled {n_pulled} rows ({dup_total} dup incident_ids dropped)")
    print(f"reload spike: {out['publication_delta']['detected_reload_date']} "
          f"({out['publication_delta']['reload_row_count']} rows share it)")
    print(f"publication delta (faithful n={out['publication_delta']['faithful_n']}): "
          f"median {out['publication_delta']['median_days']}d, "
          f"{out['publication_delta']['within_7_pct']}% ≤7d")
    if filing_ref:
        print(f"filing-lag cross-check ({filing_ref['window']}, n={filing_ref['n']}): "
              f"{filing_ref['within_30_pct']}% ≤30d, p90 {filing_ref['p90_days']}d")
    print(f"PRIMARY completion by months-after-close: "
          + ", ".join(f"k={c2['key']}:{round(c2['mean']*100)}%" for c2 in primary if c2.get('n')))
    print(f"confidence: {c['level']} · at k={c.get('target_k_months')} "
          f"~{round((c.get('mean_completion') or 0)*100)}% complete → expect +{c.get('expected_increase_pct')}% "
          f"(p10–p90 band {round((c.get('p10_p90_band') or 0)*100,1)}pts) · "
          f"range-band viable: {c.get('range_band_viable')}")
    print(f"wrote {path}")


def build_queries():
    """Runnable Socrata $query URLs backing the doc's headline facts — so numbers can't drift."""
    north = "police_district='Northern'"
    merch = MERCHANT_WHERE
    # An illustrative single-cohort fill-in (2025-01): eventual total vs filed within +30 days.
    coh_lo, coh_hi = "2025-01-01", "2025-02-01"
    plus30 = "2025-03-02"  # 2025-01-31 + 30 days
    return {
        "northern_merchant_monthly_reported": query_url(
            f"SELECT date_trunc_ym(incident_date) AS month, count(*) AS n "
            f"WHERE ({merch}) AND {north} AND resolution='{RES_REPORTED}' "
            f"AND incident_date >= '{HISTORY_START}' GROUP BY month ORDER BY month"),
        "cohort_2025_01_eventual_total": query_url(
            f"SELECT count(*) AS n WHERE ({merch}) AND {north} AND resolution='{RES_REPORTED}' "
            f"AND incident_date >= '{coh_lo}' AND incident_date < '{coh_hi}'"),
        "cohort_2025_01_filed_within_30d": query_url(
            f"SELECT count(*) AS n WHERE ({merch}) AND {north} AND resolution='{RES_REPORTED}' "
            f"AND incident_date >= '{coh_lo}' AND incident_date < '{coh_hi}' "
            f"AND report_datetime <= '{plus30}'"),
        "filing_lag_raw_rows_recent_settled": query_url(
            f"SELECT incident_date, report_datetime WHERE ({merch}) AND {north} "
            f"AND resolution='{RES_REPORTED}' AND incident_date >= '2024-07-01' "
            f"AND incident_date < '2025-07-01' ORDER BY incident_date"),
        "publication_delta_faithful_window": query_url(
            f"SELECT incident_date, report_datetime, data_loaded_at WHERE ({merch}) AND {north} "
            f"AND data_loaded_at > '2025-06-14' ORDER BY data_loaded_at DESC"),
    }


if __name__ == "__main__":
    main()
