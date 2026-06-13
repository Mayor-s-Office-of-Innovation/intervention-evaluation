"""Stage 2 · individual-report markers — the zoom-in drill-down layer.

City leadership wants to inspect specific known-problematic intersections, so above a zoom level the
transition map swaps its ~block category dots for INDIVIDUAL report markers, colored by recency
(within the trailing-3-month "now" window vs older — the same cutoff the clustering uses) with a hover
overlay of the report's helpful detail fields (address/intersection, type, status/disposition, etc.).

Reads  build/cache/<member>_assigned.json   (carries `detail` from 02_assign)
Writes unhoused/data/markers/<mapkey>.json   for the two map signals (encampment, cfs_presence).

Format keeps the file lean: a `labels` header + rows of [latE5, lngE5, day, ...detailValues].
`day` = days since epoch; the frontend colors by day vs `lurie_day`. Low-volume signals only — these
files are lazy-loaded the first time a user zooms in.
"""
import datetime
import json
import os

from signals import SIGNALS, GROUPS, TARGET_DISTRICTS, LURIE_INAUGURATION

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
DATA = os.path.join(os.path.dirname(HERE), "data")
EPOCH = datetime.date(2023, 1, 1)
NOW_MONTHS = 3   # keep in sync with 04_transitions.NOW_MONTHS — markers are colored "recent" if they
                 # fall in the trailing-3-complete-months window (the same cutoff the clustering uses).


def now_start_date():
    """First day of the trailing-NOW_MONTHS complete-month window (the 'recent' cutoff)."""
    today = datetime.date.today()
    y, m = today.year, today.month
    m -= 1                                   # latest *complete* month is the previous one
    if m == 0:
        m, y = 12, y - 1
    for _ in range(NOW_MONTHS - 1):          # step back to the window's first month
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return datetime.date(y, m, 1)

MAP_SIGNALS = {
    "encampment": ["encampment"],
    "cfs_presence": GROUPS["cfs_presence"]["members"],   # sitlie + homeless
}


def clean(col, val):
    if val is None:
        return ""
    s = str(val).strip()
    if col == "address":            # "855 PINE ST, SAN FRANCISCO, CA 94108" → "855 PINE ST"
        return s.split(",")[0].strip()
    if col == "intersection_name":  # "CABRILLO ST \ LA PLAYA" → "CABRILLO ST / LA PLAYA"
        return s.replace(" \\ ", " / ").replace("\\", " / ")
    return s


def build(mapkey):
    members = MAP_SIGNALS[mapkey]
    detail = SIGNALS[members[0]]["detail"]
    cols = [c for c, _ in detail]
    labels = [lab for _, lab in detail]

    # gather cleaned detail values per field
    rows = []
    for m in members:
        with open(os.path.join(CACHE, f"{m}_assigned.json")) as f:
            for r in json.load(f):
                if r["district"] not in TARGET_DISTRICTS or r["lat"] is None:
                    continue
                day = (datetime.date.fromisoformat(r["date"]) - EPOCH).days
                d = r.get("detail", {})
                rows.append((round(r["lat"] * 1e5), round(r["lng"] * 1e5), day,
                             [clean(c, d.get(c)) for c in cols]))

    # Code low-cardinality fields with a per-field dictionary (keeps the file lean — e.g. the long
    # "Healthy Streets Operation Center" string isn't repeated 96k times). High-cardinality fields
    # (address / intersection) stay raw.
    n = len(rows)
    fields = []
    for i, lab in enumerate(labels):
        distinct = {row[3][i] for row in rows}
        coded = len(distinct) <= max(64, n // 50)
        fields.append({"label": lab, "coded": coded,
                       "values": sorted(distinct) if coded else None})
    code_idx = [({v: j for j, v in enumerate(f["values"])} if f["coded"] else None) for f in fields]

    pts = []
    for (la, lo, day, vals) in rows:
        enc = [code_idx[i][v] if fields[i]["coded"] else v for i, v in enumerate(vals)]
        pts.append([la, lo, day] + enc)

    out = {
        "epoch": EPOCH.isoformat(),
        "coordScale": 100000,
        "lurie_day": (datetime.date.fromisoformat(LURIE_INAUGURATION) - EPOCH).days,
        "now_start_day": (now_start_date() - EPOCH).days,   # markers ≥ this day are colored "recent"
        "now_months": NOW_MONTHS,
        "fields": fields,   # [{label, coded, values}] — frontend decodes coded ints via values[]
        "pts": pts,
    }
    os.makedirs(os.path.join(DATA, "markers"), exist_ok=True)
    path = os.path.join(DATA, "markers", f"{mapkey}.json")
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    kb = os.path.getsize(path) / 1024
    coded = [f["label"] for f in fields if f["coded"]]
    print(f"  [{mapkey}] {len(pts):,} markers → {kb:.0f} KB · coded {coded}")


if __name__ == "__main__":
    for k in MAP_SIGNALS:
        print(f"Building markers for '{k}' …")
        build(k)
