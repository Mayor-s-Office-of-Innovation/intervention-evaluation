"""Stage 0 · step 3 — roll records up into the JSON the frontend consumes.

Two signal kinds (see signals.py):
  • "point"    — read the assigned cache (cfs_drug), emit per-district + citywide monthly series
                 AND the compact points array the map uses.
  • "agg_only" — fetch pre-grouped monthly counts straight from Socrata
                 (count(distinct id) by month × native police_district), canonicalize the district
                 casing to the UPPERCASE keys, emit the same series shape (no points).

Also emits the composition group (arrest_mix), the wg3w-h783 settling lag (theft-style), and
provenance (dataset + exact filter + runnable query per signal — D7).

Writes  drug/data/aggregates.json · drug/data/points/<point-signal>.json · drug/data/provenance.json
"""
import datetime
import json
import os
import sys
import urllib.parse
from collections import defaultdict

from httpget import get_json
from tod import BUCKETS, tod_bucket, tod_case_sql
from signals import (
    SIGNALS, GROUPS, TARGET_DISTRICTS, DISTRICT_LABEL, DISTRICT_REGION, HISTORY_START,
    LURIE_INAUGURATION, DATASET_NAME, SETTLE_LAG_MONTHS, query_url, query_url_by_district,
)

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
DATA = os.path.join(os.path.dirname(HERE), "data")
EPOCH = datetime.date(2023, 1, 1)
TODAY = datetime.date.today()
DOMAIN_INC = "data.sfgov.org"

DISTRICT_LABELS = [DISTRICT_LABEL[d] for d in TARGET_DISTRICTS]


def month_axis(start_ym, end_ym):
    sy, sm = int(start_ym[:4]), int(start_ym[5:7])
    ey, em = int(end_ym[:4]), int(end_ym[5:7])
    months, y, m = [], sy, sm
    while (y, m) <= (ey, em):
        months.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            m, y = 1, y + 1
    return months


# ── weekly axis (homepage 2wk YoY chip; plan-2wk-chip) — Monday-start ISO dates, so the
# ~52-week-prior partner is found by a −364-day date lookup that survives 53-week years. ──
def week_start(iso):
    d = datetime.date.fromisoformat(iso[:10])
    return (d - datetime.timedelta(days=d.weekday())).isoformat()


def week_axis(start, end):
    w = start - datetime.timedelta(days=start.weekday())
    weeks = []
    while w <= end:
        weeks.append(w.isoformat())
        w += datetime.timedelta(days=7)
    return weeks


def settled_week(weeks, latest_settled_month):
    """Last week whose week-end (Mon+6) falls strictly before the month AFTER latest_settled_month —
    ties the fortnight settle horizon to the same month buffer the 1mo/3mo cards trust."""
    y, m = int(latest_settled_month[:4]), int(latest_settled_month[5:7])
    cutoff = datetime.date(y + 1, 1, 1) if m == 12 else datetime.date(y, m + 1, 1)
    result = None
    for w in weeks:
        if datetime.date.fromisoformat(w) + datetime.timedelta(days=6) < cutoff:
            result = w
        else:
            break
    return result


def soql(domain, dataset, params):
    url = f"https://{domain}/resource/{dataset}.json?" + urllib.parse.urlencode(params)
    return get_json(url)


def _series(by_dist_month, city_month, months):
    """Shape {ym:count} accumulators into the frontend series dict (per-district labels + Citywide)."""
    s = {DISTRICT_LABEL[d]: [by_dist_month[d].get(mo, 0) for mo in months] for d in TARGET_DISTRICTS}
    s["Citywide"] = [city_month.get(mo, 0) for mo in months]
    return s


def _series_weekly(by_dist_week, city_week, weeks):
    """Same shape as _series, but keyed on the weekly axis (totals only — no tod/points)."""
    s = {DISTRICT_LABEL[d]: [by_dist_week[d].get(w, 0) for w in weeks] for d in TARGET_DISTRICTS}
    s["Citywide"] = [city_week.get(w, 0) for w in weeks]
    return s


# ── point signal (cfs_drug): from the assigned cache, + compact points for the map ──
def rollup_point(key, agg, points_out, provenance, months, weeks):
    sig = SIGNALS[key]
    with open(os.path.join(CACHE, f"{key}_assigned.json")) as f:
        records = json.load(f)

    # Day/Night split (plan-time-of-day.md §3): accumulate per bucket; total = day+night.
    city = {b: defaultdict(int) for b in BUCKETS}
    by_dist = {d: {b: defaultdict(int) for b in BUCKETS} for d in TARGET_DISTRICTS}
    # Weekly totals (homepage 2wk chip) — re-bucket the same cached events by Monday week, no tod.
    wk_city = defaultdict(int)
    wk_by_dist = {d: defaultdict(int) for d in TARGET_DISTRICTS}
    dist_idx = {d: i for i, d in enumerate(TARGET_DISTRICTS)}
    tod_code = {"day": 0, "night": 1}
    pts = []
    for r in records:
        ym = r["ym"]
        b = tod_bucket(r.get("hour"))
        wk = week_start(r["date"])
        city[b][ym] += 1
        wk_city[wk] += 1
        d = r["district"]
        if d in by_dist:
            by_dist[d][b][ym] += 1
            wk_by_dist[d][wk] += 1
            if r["lat"] is not None:
                day = (datetime.date.fromisoformat(r["date"]) - EPOCH).days
                pts.append([r["lat"], r["lng"], day, dist_idx[d], tod_code[b]])

    def merged(get):  # {ym: count} summed across buckets for the (unchanged) total series
        out = defaultdict(int)
        for b in BUCKETS:
            for mo, n in get(b).items():
                out[mo] += n
        return out

    series = _series({d: merged(lambda b: by_dist[d][b]) for d in TARGET_DISTRICTS},
                     merged(lambda b: city[b]), months)
    series_tod = {b: _series({d: by_dist[d][b] for d in TARGET_DISTRICTS}, city[b], months) for b in BUCKETS}
    series_weekly = _series_weekly(wk_by_dist, wk_city, weeks)
    _store_signal(key, sig, series, agg, series_tod, series_weekly)
    points_out[key] = pts
    _store_provenance(key, sig, len(records), provenance)
    print(f"  [{key}] point · {len(pts):,} in-district points · citywide total {sum(series['Citywide']):,} "
          f"(day {sum(series_tod['day']['Citywide']):,} · night {sum(series_tod['night']['Citywide']):,})")


# ── weekly counts for an agg_only signal (homepage 2wk chip) — daily groups bucketed to Monday
# weeks locally (Socrata has no date_trunc_yw). Only fetched for signals flagged weekly=True. ──
def _weekly_agg(sig, weeks):
    cnt = f"count(distinct {sig['id_col']})" if sig.get("distinct") else "count(*)"
    full_where = f"({sig['where']}) AND {sig['date_col']} >= '{HISTORY_START}'"
    dfield = sig.get("district_field")
    if dfield and not sig.get("citywide_only"):
        rows = soql(sig["domain"], sig["dataset"], {
            "$select": f"date_trunc_ymd({sig['date_col']}) AS d, {dfield} AS dist, {cnt} AS n",
            "$where": full_where, "$group": f"d, {dfield}", "$order": "d", "$limit": "50000",
        })
        wk_city = defaultdict(int)
        wk_by_dist = {d: defaultdict(int) for d in TARGET_DISTRICTS}
        for r in rows:
            wk, n = week_start(r["d"]), int(r["n"])
            wk_city[wk] += n
            canon = (r.get("dist") or "").upper()
            if canon in wk_by_dist:
                wk_by_dist[canon][wk] += n
        return _series_weekly(wk_by_dist, wk_city, weeks)
    rows = soql(sig["domain"], sig["dataset"], {
        "$select": f"date_trunc_ymd({sig['date_col']}) AS d, {cnt} AS n",
        "$where": full_where, "$group": "d", "$order": "d", "$limit": "50000",
    })
    wk_city = defaultdict(int)
    for r in rows:
        wk_city[week_start(r["d"])] += int(r["n"])
    return {"Citywide": [wk_city.get(w, 0) for w in weeks]}


# ── agg_only signal: grouped count straight from Socrata ──
def rollup_agg(key, agg, provenance, months, weeks):
    sig = SIGNALS[key]
    cnt = f"count(distinct {sig['id_col']})" if sig.get("distinct") else "count(*)"
    full_where = f"({sig['where']}) AND {sig['date_col']} >= '{HISTORY_START}'"
    dfield = sig.get("district_field")
    # Day/Night split done server-side: an extra CASE grouping dimension on the hour. Each incident
    # has one timestamp → one bucket, so a distinct-incident count splits cleanly and day+night==total.
    tod_sql = tod_case_sql(sig["date_col"])

    if dfield and not sig.get("citywide_only"):
        rows = soql(sig["domain"], sig["dataset"], {
            "$select": f"date_trunc_ym({sig['date_col']}) AS ym, {dfield} AS dist, {tod_sql} AS tod, {cnt} AS n",
            "$where": full_where, "$group": f"ym, {dfield}, {tod_sql}", "$order": "ym", "$limit": "50000",
        })
        by_dist = {d: {b: defaultdict(int) for b in BUCKETS} for d in TARGET_DISTRICTS}
        city = {b: defaultdict(int) for b in BUCKETS}
        total_records = 0
        for r in rows:
            ym = r["ym"][:7]
            n = int(r["n"])
            b = r.get("tod") or "night"
            total_records += n
            city[b][ym] += n                    # citywide = every district, not just the target 4
            canon = (r.get("dist") or "").upper()
            if canon in by_dist:
                by_dist[canon][b][ym] += n

        def merged(get):
            out = defaultdict(int)
            for b in BUCKETS:
                for mo, n in get(b).items():
                    out[mo] += n
            return out

        series = _series({d: merged(lambda b: by_dist[d][b]) for d in TARGET_DISTRICTS},
                         merged(lambda b: city[b]), months)
        series_tod = {b: _series({d: by_dist[d][b] for d in TARGET_DISTRICTS}, city[b], months) for b in BUCKETS}
    else:
        rows = soql(sig["domain"], sig["dataset"], {
            "$select": f"date_trunc_ym({sig['date_col']}) AS ym, {tod_sql} AS tod, {cnt} AS n",
            "$where": full_where, "$group": f"ym, {tod_sql}", "$order": "ym", "$limit": "50000",
        })
        city = {b: defaultdict(int) for b in BUCKETS}
        for r in rows:
            city[r.get("tod") or "night"][r["ym"][:7]] += int(r["n"])
        total_records = sum(sum(c.values()) for c in city.values())
        merged = defaultdict(int)
        for b in BUCKETS:
            for mo, n in city[b].items():
                merged[mo] += n
        series = {"Citywide": [merged.get(mo, 0) for mo in months]}
        series_tod = {b: {"Citywide": [city[b].get(mo, 0) for mo in months]} for b in BUCKETS}

    series_weekly = _weekly_agg(sig, weeks) if sig.get("weekly") else None
    _store_signal(key, sig, series, agg, series_tod, series_weekly)
    _store_provenance(key, sig, total_records, provenance)
    tag = "citywide-only" if sig.get("citywide_only") else "by-district"
    print(f"  [{key}] agg ({tag}) · citywide total {sum(series['Citywide']):,} "
          f"(day {sum(series_tod['day']['Citywide']):,} · night {sum(series_tod['night']['Citywide']):,})")


def _store_signal(key, sig, series, agg, series_tod=None, series_weekly=None):
    node = {
        "label": sig["label"],
        "tier": sig.get("tier"),
        "axis": sig.get("axis"),
        "goal": sig.get("goal"),
        "group": sig.get("group"),
        "settles": sig.get("settles", False),
        "citywide_only": sig.get("citywide_only", False),
        "excluded_from_trend": sig.get("excluded_from_trend", False),
        "caveat": sig.get("caveat"),
        "series": series,                       # total (day+night) — unchanged shape
        "series_tod": series_tod or {},         # {day:{...}, night:{...}} (plan-time-of-day.md §3)
    }
    if series_weekly:
        node["series_weekly"] = series_weekly   # weekly axis for the homepage 2wk YoY chip
    agg["signals"][key] = node


def _store_provenance(key, sig, total_records, provenance):
    provenance["signals"][key] = {
        "dataset_id": sig["dataset"],
        "dataset_name": DATASET_NAME.get(sig["dataset"], sig["dataset"]),
        "filter": sig["where"],
        "query_url": query_url(sig),
        "query_url_by_district": query_url_by_district(sig),
        "records": total_records,
        "axis": sig.get("axis"),
        "goal": sig.get("goal"),
        "caveat": sig.get("caveat"),
    }


def build_groups(agg, provenance):
    for gkey, g in GROUPS.items():
        members = [m for m in g["members"] if m in agg["signals"]]
        if not members:
            continue
        labels = list(agg["signals"][members[0]]["series"].keys())
        nmonths = len(agg["months"])
        series = {lab: [sum(agg["signals"][m]["series"][lab][i] for m in members)
                        for i in range(nmonths)] for lab in labels}
        # Sum the per-bucket member series too, so the composition view can filter by day/night.
        series_tod = {}
        if all(agg["signals"][m].get("series_tod") for m in members):
            series_tod = {b: {lab: [sum(agg["signals"][m]["series_tod"][b][lab][i] for m in members)
                                    for i in range(nmonths)] for lab in labels} for b in BUCKETS}
        agg["groups"][gkey] = {
            "label": g["label"], "members": members, "note": g["note"],
            "series": series, "series_tod": series_tod,
        }
        provenance["groups"][gkey] = {
            "label": g["label"], "note": g["note"],
            "members": {m: {"label": SIGNALS[m]["label"], "query_url": query_url(SIGNALS[m])}
                        for m in members},
        }
        print(f"  [group {gkey}] {' + '.join(members)} → {sum(series['Citywide']):,} citywide")


# ── wg3w-h783 report-approval lag (theft-style) — drives the "recent months aren't final" note ──
def first_of_month(months_back):
    total = TODAY.year * 12 + (TODAY.month - 1) - months_back
    return datetime.date(total // 12, total % 12 + 1, 1)


def reporting_lag():
    lo, hi = first_of_month(24), first_of_month(12)
    where = (f"incident_category = 'Drug Offense' AND report_type_description = 'Initial' "
             f"AND incident_datetime >= '{lo}' AND incident_datetime < '{hi}'")
    rows = soql(DOMAIN_INC, "wg3w-h783", {
        "$select": "incident_datetime, report_datetime", "$where": where, "$limit": "50000"})
    lags = []
    for r in rows:
        if r.get("incident_datetime") and r.get("report_datetime"):
            d = (datetime.date.fromisoformat(r["report_datetime"][:10])
                 - datetime.date.fromisoformat(r["incident_datetime"][:10])).days
            if d >= 0:
                lags.append(d)
    lags.sort()
    n = len(lags)
    pctile = lambda p: lags[min(n - 1, int(p / 100 * n))] if n else None
    within = lambda d: round(sum(1 for x in lags if x <= d) / n * 100) if n else None
    return {
        "ref_window": f"{lo:%b %Y}–{first_of_month(13):%b %Y}", "n": n,
        "median_days": pctile(50), "within_30_pct": within(30), "p90_days": pctile(90),
    }


if __name__ == "__main__":
    keys = sys.argv[1:] or list(SIGNALS.keys())
    cur_ym = f"{TODAY.year:04d}-{TODAY.month:02d}"
    months = month_axis(HISTORY_START[:7], cur_ym)
    latest_complete = months[-2]                       # current month is partial
    latest_settled = months[-2 - SETTLE_LAG_MONTHS]    # + wg3w-h783 still-settling recent months

    # Weekly axis (homepage 2wk YoY chip) — the settled week ties to the same month buffer above.
    weeks = week_axis(datetime.date.fromisoformat(HISTORY_START[:10]), TODAY)
    latest_settled_week = settled_week(weeks, latest_settled)
    settle_lag_weeks = (weeks.index(weeks[-2]) - weeks.index(latest_settled_week)
                        if latest_settled_week else None)

    lag = reporting_lag()
    print(f"reporting lag (wg3w-h783 drug, settled ref {lag['ref_window']}, n={lag['n']}): "
          f"median {lag['median_days']}d · {lag['within_30_pct']}% ≤30d · p90 {lag['p90_days']}d")

    agg = {
        "generated": TODAY.isoformat(),
        "epoch": EPOCH.isoformat(),
        "months": months,
        "latest_complete_month": latest_complete,
        "latest_settled_month": latest_settled,
        "settle_lag_months": SETTLE_LAG_MONTHS,
        "current_partial_month": cur_ym,
        "weeks": weeks,
        "latest_complete_week": weeks[-2],
        "current_partial_week": weeks[-1],
        "latest_settled_week": latest_settled_week,
        "settle_lag_weeks": settle_lag_weeks,
        "settling": lag,
        "districts": DISTRICT_LABELS,
        "lurie_inauguration": LURIE_INAUGURATION,
        "pre_lurie_window": ["2023-01", "2024-12"],
        "hot_now_months": 3,
        "signals": {},
        "groups": {},
    }
    points_out = {}
    provenance = {
        "generated": TODAY.isoformat(),
        "districts_geojson": "qgnn-b9vv",
        "history_start": HISTORY_START[:10],
        "latest_settled_month": latest_settled,
        "settle_note": (f"Dealer/paraphernalia arrest counts come from SFPD incident reports, which appear "
                        f"only after supervisor approval, so the {SETTLE_LAG_MONTHS} most recent complete "
                        f"months under-report and are shown shaded; the arrest cards evaluate the latest "
                        f"settled month ({latest_settled}), and the homepage 2-week figure reflects the "
                        f"latest settled fortnight ({latest_settled_week}). Community 911 calls and 311 "
                        f"needle reports are creation-stamped (no lag) — only the in-progress month is partial."),
        "note": "Each signal lists its dataset and a runnable Socrata query so every number ties back to "
                "source data (plan D7).",
        "signals": {},
        "groups": {},
    }

    for k in keys:
        sig = SIGNALS[k]
        print(f"Rolling up '{k}' …")
        if sig.get("kind") == "point":
            rollup_point(k, agg, points_out, provenance, months, weeks)
        else:
            rollup_agg(k, agg, provenance, months, weeks)
    print("Building groups …")
    build_groups(agg, provenance)

    os.makedirs(DATA, exist_ok=True)
    os.makedirs(os.path.join(DATA, "points"), exist_ok=True)
    with open(os.path.join(DATA, "aggregates.json"), "w") as f:
        json.dump(agg, f, separators=(",", ":"))
    for k, pts in points_out.items():
        with open(os.path.join(DATA, "points", f"{k}.json"), "w") as f:
            json.dump(pts, f, separators=(",", ":"))
    with open(os.path.join(DATA, "provenance.json"), "w") as f:
        json.dump(provenance, f, indent=2)

    a = os.path.getsize(os.path.join(DATA, "aggregates.json"))
    print(f"\naggregates.json: {a/1024:.1f} KB · months {months[0]}…{months[-1]} "
          f"(latest complete {latest_complete}, latest settled {latest_settled})")
