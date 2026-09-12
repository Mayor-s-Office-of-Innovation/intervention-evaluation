"""Stage 0 · step 2 — parse the SFMTA GTFS feed for routes served and the nearest alternative stop.

Reads  build/cache/gtfs.zip  (download https://gtfs.sfmta.com/transitdata/google_transit.zip in a
                              browser — the host times out for CLI clients — or pass a path as argv[1])
Writes build/cache/gtfs_stops.json  — per stop_id: stop_code, wheelchair, routes[], alts[] (one per
                                      route+direction: the closer of prev/next stop in sequence, with
                                      straight-line metres), plus feed_info dates.

GTFS stop_id == DataSF stopid (4-digit); stop_code is the public 5-digit ID.
Distances are straight-line between stop coordinates (a slight understatement of the walk).
"""
import csv
import io
import json
import math
import os
import sys
import zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")


def dist_m(a, b):
    la = a[0]
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * math.cos(math.radians(la)))


def main(zip_path):
    z = zipfile.ZipFile(zip_path)
    rd = lambda name: csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"))
    stops = {r["stop_id"]: r for r in rd("stops.txt")}
    routes = {r["route_id"]: r["route_short_name"] or r["route_long_name"] for r in rd("routes.txt")}
    trips = {r["trip_id"]: r for r in rd("trips.txt")}
    feed = next(iter(rd("feed_info.txt")), {}) if "feed_info.txt" in z.namelist() else {}

    seq = defaultdict(list)
    for r in rd("stop_times.txt"):
        seq[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"]))
    # one representative trip (the longest) per route+direction+shape pattern
    best = {}
    for tid, st in seq.items():
        t = trips[tid]
        k = (t["route_id"], t["direction_id"], t["shape_id"])
        if k not in best or len(st) > len(seq[best[k]]):
            best[k] = tid

    coord = {sid: (float(s["stop_lat"]), float(s["stop_lon"])) for sid, s in stops.items()}
    per_stop = defaultdict(lambda: {"routes": set(), "alts": {}})
    for (rid, did, _), tid in best.items():
        st = [s for _, s in sorted(seq[tid])]
        for i, sid in enumerate(st):
            rec = per_stop[sid]
            rec["routes"].add(routes[rid])
            cands = ([st[i - 1]] if i > 0 else []) + ([st[i + 1]] if i + 1 < len(st) else [])
            if not cands:
                continue
            d, alt = min((dist_m(coord[sid], coord[c]), c) for c in cands)
            key = f"{routes[rid]}|{did}"
            cur = rec["alts"].get(key)
            if cur is None or d < cur["m"]:
                rec["alts"][key] = {"route": routes[rid], "dir": did, "stop": alt,
                                    "name": stops[alt]["stop_name"], "m": round(d)}

    def route_key(x):
        return (len(x), x)

    out = {}
    for sid, rec in per_stop.items():
        s = stops[sid]
        out[sid] = {
            "code": s.get("stop_code"), "name": s["stop_name"],
            "wheelchair": s.get("wheelchair_boarding"),
            "routes": sorted(rec["routes"], key=route_key),
            "alts": sorted(rec["alts"].values(), key=lambda a: a["m"]),
        }
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, "gtfs_stops.json"), "w") as f:
        json.dump({"feed": {k: feed.get(k) for k in ("feed_version", "feed_start_date", "feed_end_date")},
                   "parsed": __import__("datetime").date.today().isoformat(), "stops": out}, f)
    print(f"gtfs: {len(stops)} stops in feed, {len(out)} with service, {len(best)} patterns; "
          f"feed {feed.get('feed_version')} {feed.get('feed_start_date')}–{feed.get('feed_end_date')}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(CACHE, "gtfs.zip"))
