"""Stage 0 · step 3 — roll records up into the JSON the frontend consumes.

Reads  build/cache/<signal>_assigned.json
Writes districts/data/aggregates.json        — months axis + per-district & citywide monthly series
       districts/data/points/<signal>.json    — compact [latE5, lngE5, dayIndex, districtIdx] for the 4 districts
       districts/data/provenance.json          — filters, counts, and the auditable break series (encampment-only vs rerouted vs union)

Seasonal/trend KPIs (YoY, trailing-12mo) are derived in the frontend (rollup.js) from
the monthly series — the expensive, do-it-once work (point-in-polygon) is what lives here.
"""
import datetime
import json
import os
import sys
import urllib.parse
from collections import defaultdict

from httpget import get_json
from signals import SIGNALS, TARGET_DISTRICTS, DISTRICT_LABEL, HISTORY_START

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

    # citywide + per-district monthly counts
    city = defaultdict(int)
    by_dist = {d: defaultdict(int) for d in TARGET_DISTRICTS}
    dist_idx = {d: i for i, d in enumerate(TARGET_DISTRICTS)}
    pts = []
    for r in records:
        ym = r["ym"]
        city[ym] += 1
        d = r["district"]
        if d in by_dist:
            by_dist[d][ym] += 1
            if r["lat"] is not None:
                day = (datetime.date.fromisoformat(r["date"]) - EPOCH).days
                pts.append([r["lat"], r["lng"], day, dist_idx[d]])

    series = {DISTRICT_LABEL[d]: [by_dist[d].get(mo, 0) for mo in agg["months"]] for d in TARGET_DISTRICTS}
    series["Citywide"] = [city.get(mo, 0) for mo in agg["months"]]

    agg["signals"][signal_key] = {
        "label": sig["label"],
        "caveat": sig.get("caveat"),
        "breaks": sig.get("breaks", []),
        "series": series,
    }
    points_out[signal_key] = pts

    # provenance: the auditable break (encampment-only vs rerouted vs union)
    prov = {"filter": sig["where"], "records_pulled": len(records)}
    parts = sig.get("provenance_parts")
    if parts:
        prov["break_audit"] = {name: fetch_provenance_series(sig, w) for name, w in parts.items()}
        prov["break_audit"]["union"] = {mo: city.get(mo, 0) for mo in agg["months"]}
    provenance["signals"][signal_key] = prov

    in_district = sum(sum(by_dist[d].values()) for d in TARGET_DISTRICTS)
    print(f"  [{signal_key}] {len(pts):,} in-district points; "
          f"{in_district:,} in-district records of {len(records):,} citywide")


if __name__ == "__main__":
    keys = sys.argv[1:] or list(SIGNALS.keys())
    # current month is partial → latest complete month is the previous one
    cur_ym = f"{TODAY.year:04d}-{TODAY.month:02d}"
    latest_complete = month_axis("2023-01", cur_ym)[-2]

    agg = {
        "generated": TODAY.isoformat(),
        "epoch": EPOCH.isoformat(),
        "months": month_axis(HISTORY_START[:7], cur_ym),
        "latest_complete_month": latest_complete,
        "current_partial_month": cur_ym,
        "districts": [DISTRICT_LABEL[d] for d in TARGET_DISTRICTS],
        "signals": {},
    }
    points_out = {}
    provenance = {"generated": TODAY.isoformat(), "districts_geojson": "qgnn-b9vv", "signals": {}}

    for k in keys:
        print(f"Rolling up '{k}' …")
        rollup(k, agg, points_out, provenance)

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
