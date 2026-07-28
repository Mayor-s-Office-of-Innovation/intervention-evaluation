"""Stage 0 · step 3 — roll records up into the JSON the frontend consumes.

Reads  build/cache/<signal>_assigned.json
Writes unhoused/data/aggregates.json   — months axis + per-district & citywide monthly series per signal,
                                          plus the D14 grouped series (911 calls = Sit/Lie + Homeless Complaint)
       unhoused/data/points/<signal>.json — compact [latE5, lngE5, dayIndex, districtIdx] for the 4 districts
       unhoused/data/provenance.json    — per signal AND per component: dataset id+name, exact filter,
                                          runnable Socrata query link (D7), dedup notes, break audit

Seasonal/trend KPIs (YoY, trailing-12mo) and the map's hot/cold classification are derived in the
frontend from the monthly series + points — the do-it-once work (point-in-polygon) is what lives here.
"""
import datetime
import json
import os
import sys
import urllib.parse
from collections import defaultdict

from httpget import get_json
from tod import BUCKETS, tod_bucket
from signals import (
    SIGNALS, GROUPS, TARGET_DISTRICTS, DISTRICT_LABEL, HISTORY_START,
    LURIE_INAUGURATION, DATASET_NAME, query_url,
)

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
DATA = os.path.join(os.path.dirname(HERE), "data")
EPOCH = datetime.date(2023, 1, 1)
TODAY = datetime.date.today()


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


# ── weekly axis (homepage 2wk YoY chip; plan-2wk-chip) — Monday-start ISO dates. Unhoused calls are
# creation-stamped (no settle lag), so the 2wk chip's settled week == the latest complete week. ──
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


def fetch_provenance_series(sig, where):
    """Citywide monthly count for a sub-filter, straight from Socrata (cheap aggregate)."""
    full = f"{where} AND {sig['date_col']} >= '{HISTORY_START}'"
    params = {
        "$select": f"date_trunc_ym({sig['date_col']}) AS ym, count(*) AS n",
        "$where": full,
        "$group": "ym",
        "$order": "ym",
        "$limit": "5000",
    }
    url = f"https://{sig['domain']}/resource/{sig['dataset']}.json?" + urllib.parse.urlencode(params)
    rows = get_json(url)
    return {r["ym"][:7]: int(r["n"]) for r in rows}


def rollup(signal_key, agg, points_out, provenance):
    sig = SIGNALS[signal_key]
    with open(os.path.join(CACHE, f"{signal_key}_assigned.json")) as f:
        records = json.load(f)

    # citywide + per-district monthly counts. `city`/`by_dist` stay the totals (also used by the
    # provenance break-audit below); `*_tod` carry the Day/Night split (plan-time-of-day.md §3).
    city = defaultdict(int)
    by_dist = {d: defaultdict(int) for d in TARGET_DISTRICTS}
    city_tod = {b: defaultdict(int) for b in BUCKETS}
    by_dist_tod = {d: {b: defaultdict(int) for b in BUCKETS} for d in TARGET_DISTRICTS}
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
        city[ym] += 1
        city_tod[b][ym] += 1
        wk_city[wk] += 1
        d = r["district"]
        if d in by_dist:
            by_dist[d][ym] += 1
            by_dist_tod[d][b][ym] += 1
            wk_by_dist[d][wk] += 1
            if r["lat"] is not None:
                day = (datetime.date.fromisoformat(r["date"]) - EPOCH).days
                pts.append([r["lat"], r["lng"], day, dist_idx[d], tod_code[b]])

    months = agg["months"]
    weeks = agg["weeks"]

    def _ser(bd, ct):
        s = {DISTRICT_LABEL[d]: [bd[d].get(mo, 0) for mo in months] for d in TARGET_DISTRICTS}
        s["Citywide"] = [ct.get(mo, 0) for mo in months]
        return s

    series = _ser(by_dist, city)
    series_tod = {b: _ser({d: by_dist_tod[d][b] for d in TARGET_DISTRICTS}, city_tod[b]) for b in BUCKETS}
    series_weekly = {DISTRICT_LABEL[d]: [wk_by_dist[d].get(w, 0) for w in weeks] for d in TARGET_DISTRICTS}
    series_weekly["Citywide"] = [wk_city.get(w, 0) for w in weeks]

    agg["signals"][signal_key] = {
        "label": sig["label"],
        "tier": sig.get("tier"),
        "group": sig.get("group"),
        "subview_of": sig.get("subview_of"),
        "caveat": sig.get("caveat"),
        "breaks": sig.get("breaks", []),
        "series": series,
        "series_tod": series_tod,
        "series_weekly": series_weekly,
    }
    points_out[signal_key] = pts

    # ── provenance (D7): dataset + exact filter + runnable query, per signal AND per component ──
    prov = {
        "dataset_id": sig["dataset"],
        "dataset_name": DATASET_NAME.get(sig["dataset"], sig["dataset"]),
        "filter": sig["where"],
        "query_url": query_url(sig),
        "records_pulled": len(records),
    }
    if sig.get("dedup_note"):
        prov["dedup_note"] = sig["dedup_note"]
    parts = sig.get("provenance_parts")
    if parts:
        # Each component of a combined signal gets its own filter + runnable query (auditable union).
        prov["components"] = {
            name: {"filter": w, "query_url": query_url(sig, where=w)} for name, w in parts.items()
        }
        prov["break_audit"] = {name: fetch_provenance_series(sig, w) for name, w in parts.items()}
        prov["break_audit"]["union"] = {mo: city.get(mo, 0) for mo in agg["months"]}
    provenance["signals"][signal_key] = prov

    in_district = sum(sum(by_dist[d].values()) for d in TARGET_DISTRICTS)
    print(f"  [{signal_key}] {len(pts):,} in-district points; "
          f"{in_district:,} in-district records of {len(records):,} citywide")


def build_groups(agg, provenance):
    """D14 — emit summed group series (e.g. 911 calls = Sit/Lie + Homeless Complaint)."""
    for gkey, g in GROUPS.items():
        members = [m for m in g["members"] if m in agg["signals"]]
        if not members:
            continue
        labels = list(agg["signals"][members[0]]["series"].keys())
        nmonths = len(agg["months"])
        series = {}
        for lab in labels:
            series[lab] = [
                sum(agg["signals"][m]["series"][lab][i] for m in members)
                for i in range(nmonths)
            ]
        # Sum the per-bucket member series too (so the group can be filtered by day/night).
        series_tod = {}
        if all(agg["signals"][m].get("series_tod") for m in members):
            series_tod = {b: {lab: [sum(agg["signals"][m]["series_tod"][b][lab][i] for m in members)
                                    for i in range(nmonths)] for lab in labels} for b in BUCKETS}
        agg["groups"][gkey] = {
            "label": g["label"], "tier": g.get("tier"),
            "members": members, "note": g["note"], "series": series, "series_tod": series_tod,
        }
        provenance["groups"][gkey] = {
            "label": g["label"],
            "note": g["note"],
            "members": {
                m: {
                    "label": SIGNALS[m]["label"],
                    "dataset_id": SIGNALS[m]["dataset"],
                    "dataset_name": DATASET_NAME.get(SIGNALS[m]["dataset"], SIGNALS[m]["dataset"]),
                    "filter": SIGNALS[m]["where"],
                    "query_url": query_url(SIGNALS[m]),
                } for m in members
            },
        }
        total = sum(series["Citywide"])
        print(f"  [group {gkey}] {' + '.join(members)} → {total:,} citywide records")


if __name__ == "__main__":
    keys = sys.argv[1:] or list(SIGNALS.keys())
    cur_ym = f"{TODAY.year:04d}-{TODAY.month:02d}"
    months = month_axis(HISTORY_START[:7], cur_ym)
    latest_complete = months[-2]  # current month is partial → previous is latest complete

    # Weekly axis (homepage 2wk YoY chip). Unhoused is creation-stamped (no settle lag), so the 2wk
    # chip's settled week == the latest complete week — no latest_settled_week pointer needed.
    weeks = week_axis(datetime.date.fromisoformat(HISTORY_START[:10]), TODAY)

    agg = {
        "generated": TODAY.isoformat(),
        "epoch": EPOCH.isoformat(),
        "months": months,
        "latest_complete_month": latest_complete,
        "current_partial_month": cur_ym,
        "weeks": weeks,
        "latest_complete_week": weeks[-2],
        "current_partial_week": weeks[-1],
        "districts": [DISTRICT_LABEL[d] for d in TARGET_DISTRICTS],
        # Map classification windows (D11/D12) — no settling buffer needed (D13).
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
        "note": "Each signal (and each component of a combined one) lists its dataset and a runnable "
                "Socrata query so every number on the page ties back to source data (plan D7).",
        "signals": {},
        "groups": {},
    }

    for k in keys:
        print(f"Rolling up '{k}' …")
        rollup(k, agg, points_out, provenance)
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
    print(f"\naggregates.json: {a/1024:.1f} KB · months {agg['months'][0]}…{agg['months'][-1]} "
          f"(latest complete {latest_complete})")
    for k in keys:
        p = os.path.getsize(os.path.join(DATA, "points", f"{k}.json"))
        print(f"points/{k}.json: {p/1024:.1f} KB")
