"""Stage 0 · step 3 — spatial join: attach every signal record to stops, build the per-stop
monthly series (stop + 25–250 m ring), neighbours, and the 911 intersection mapping (plan D6).

Reads  build/cache/stops_raw.json, gtfs_stops.json, <signal>_raw.json
Writes build/cache/joined.json — {months, generated, stops: {stopid: {meta…, series: {sig: {stop:[], ring:[]}}}}}

Geometry (plan §5 / D6):
  311  → nearest stop within STOP_RADIUS_M of the case point; ring = every stop 25–250 m away.
  911  → each stop snaps to its parent intersection (nearest CFS intersection centroid within
         INTERSECTION_SNAP_M); calls attach to every stop at that intersection. Ring = other
         intersections whose centroid is 25–250 m from the stop. Centroids only exist for
         intersections that had a call, so "no intersection within reach" means no calls of that
         type near the stop since HISTORY_START: a genuine zero series, flagged (intersection=None).
  neighbours = the 3 nearest UNSHELTERED stops within NEIGHBOUR_M (attribution baseline).
"""
import datetime
import json
import math
import os
from collections import defaultdict

from signals import (SIGNALS, HISTORY_START, STOP_RADIUS_M, RING_M, NEIGHBOUR_M, INTERSECTION_SNAP_M,
                     INTERSECTION_NAME_M)

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
TODAY = datetime.date.today()


def month_axis(start_ym, end_ym):
    sy, sm = int(start_ym[:4]), int(start_ym[5:7])
    ey, em = int(end_ym[:4]), int(end_ym[5:7])
    out, y, m = [], sy, sm
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            m, y = 1, y + 1
    return out


def dist_m(la1, lo1, la2, lo2):
    return math.hypot((la1 - la2) * 111320, (lo1 - lo2) * 111320 * math.cos(math.radians(la1)))


class Grid:
    """Cheap fixed-cell spatial index (~110 m cells) for radius queries."""
    CELL = 0.001

    def __init__(self):
        self.cells = defaultdict(list)

    def key(self, la, lo):
        return (int(la / self.CELL), int(lo / self.CELL))

    def add(self, la, lo, item):
        self.cells[self.key(la, lo)].append((la, lo, item))

    def within(self, la, lo, r):
        span = int(r / 100) + 1
        k = self.key(la, lo)
        for dx in range(-span, span + 1):
            for dy in range(-span, span + 1):
                for pla, plo, item in self.cells.get((k[0] + dx, k[1] + dy), ()):
                    d = dist_m(la, lo, pla, plo)
                    if d <= r:
                        yield d, item


def load(name):
    with open(os.path.join(CACHE, name)) as f:
        return json.load(f)


def main():
    months = month_axis(HISTORY_START[:7], TODAY.strftime("%Y-%m"))
    midx = {m: i for i, m in enumerate(months)}
    n = len(months)

    raw = load("stops_raw.json")
    # GTFS: parsed feed if 02_gtfs ran; otherwise (CI where gtfs.sfmta.com times out) carry the routes/alts
    # forward from the committed data/stops.json, keeping its gtfs_as_of date so the page can say how stale.
    gpath = os.path.join(CACHE, "gtfs_stops.json")
    if os.path.exists(gpath):
        g = load("gtfs_stops.json")
        gtfs, gtfs_as_of = g["stops"], g.get("parsed")
    else:
        prev_path = os.path.join(os.path.dirname(HERE), "data", "stops.json")
        if not os.path.exists(prev_path):
            raise SystemExit("no build/cache/gtfs_stops.json and no committed data/stops.json to fall back on — run 02_gtfs.py")
        with open(prev_path) as f:
            prev = json.load(f)
        gtfs = {p["id"]: {"code": p["code"], "routes": p["routes"], "alts": p["alts"], "wheelchair": None}
                for p in prev["stops"] if p.get("in_gtfs")}
        gtfs_as_of = prev.get("gtfs_as_of")
        print(f"gtfs: no fresh feed — carrying routes/alts forward from data/stops.json (as of {gtfs_as_of})")
    stops = {}
    for r in raw:
        if not r.get("latitude"):
            continue
        sid = r["stopid"]
        g = gtfs.get(sid, {})
        stops[sid] = {
            "id": sid, "code": g.get("code") or f"1{sid}", "name": r["stopname"],
            "lat": float(r["latitude"]), "lng": float(r["longitude"]),
            "shelter": r.get("shelter") == "1", "shelter_as_of": (r.get("data_as_of") or "")[:10],
            "accessible": r.get("accessibilitymask") == "1", "wheelchair_gtfs": g.get("wheelchair"),
            "on": r.get("onstreet"), "at": r.get("atstreet"), "position": r.get("position"),
            "supe": r.get("supervisor_district"),
            "routes": g.get("routes", []), "alts": g.get("alts", []),
            "in_gtfs": sid in gtfs,
        }
    print(f"stops: {len(stops)} ({sum(1 for s in stops.values() if s['shelter'])} sheltered, "
          f"{sum(1 for s in stops.values() if not s['in_gtfs'])} not in GTFS)")

    grid = Grid()
    for s in stops.values():
        grid.add(s["lat"], s["lng"], s["id"])

    # neighbours: 3 nearest unsheltered stops within NEIGHBOUR_M
    for s in stops.values():
        nb = sorted((d, sid) for d, sid in grid.within(s["lat"], s["lng"], NEIGHBOUR_M)
                    if sid != s["id"] and not stops[sid]["shelter"])
        s["neighbours"] = [sid for _, sid in nb[:3]]

    series = {sid: {} for sid in stops}
    for key in SIGNALS:
        for sid in stops:
            series[sid][key] = {"stop": [0] * n, "ring": [0] * n}

    # ── 311 signals: point → nearest stop (≤25 m) + ring ──
    for key, sig in SIGNALS.items():
        if sig["geo_kind"] != "latlong":
            continue
        rows = load(f"{key}_raw.json")
        hit = 0
        for r in rows:
            if not r.get("lat"):
                continue
            ym = r[sig["date_col"]][:7]
            if ym not in midx:
                continue
            la, lo = float(r["lat"]), float(r["long"])
            near = list(grid.within(la, lo, RING_M))
            if not near:
                continue
            d0, s0 = min(near)
            if d0 <= STOP_RADIUS_M:
                series[s0][key]["stop"][midx[ym]] += 1
                hit += 1
            for d, sid in near:
                if d > STOP_RADIUS_M:
                    series[sid][key]["ring"][midx[ym]] += 1
        print(f"[{key}] {len(rows):,} rows; {hit:,} within {STOP_RADIUS_M} m of a stop ({hit / max(1, len(rows)):.1%})")

    # ── 911 signals: intersection centroids → stops ──
    inter = {}       # name → (lat, lng)
    inter_counts = {key: defaultdict(lambda: [0] * n) for key, s in SIGNALS.items() if s["geo_kind"] == "point"}
    for key in inter_counts:
        rows = load(f"{key}_raw.json")
        for r in rows:
            p = r.get("intersection_point")
            name = r.get("intersection_name")
            if not p or not name:
                continue
            ym = r[SIGNALS[key]["date_col"]][:7]
            if ym not in midx:
                continue
            lo, la = p["coordinates"]
            inter.setdefault(name, (la, lo))
            inter_counts[key][name][midx[ym]] += 1
        print(f"[{key}] {len(rows):,} rows over {len(inter):,} intersections")
    igrid = Grid()
    for name, (la, lo) in inter.items():
        igrid.add(la, lo, name)
    snapped = 0
    norm = lambda x: (x or "").upper().replace("'", "").strip()
    for s in stops.values():
        # Prefer (within INTERSECTION_NAME_M) the centroid whose name carries BOTH the stop's on/at streets,
        # then either street; else the nearest centroid within INTERSECTION_SNAP_M. Big Market St
        # intersections put far-side stops 80–130 m from the centroid, which pure nearest gets wrong.
        on, at = norm(s["on"]), norm(s["at"])
        cand = sorted(igrid.within(s["lat"], s["lng"], INTERSECTION_NAME_M))
        best = None
        if on and at:
            both = [(d, nm) for d, nm in cand if on in nm and at in nm]
            one = [(d, nm) for d, nm in cand if on in nm or at in nm]
            best = (both or one or [None])[0]
        if best is None:
            near = [(d, nm) for d, nm in cand if d <= INTERSECTION_SNAP_M]
            best = near[0] if near else None
        s["intersection"] = best[1] if best else None
        s["intersection_m"] = round(best[0]) if best else None
        snapped += bool(best)
        ring = [name for d, name in igrid.within(s["lat"], s["lng"], RING_M)
                if d > STOP_RADIUS_M and name != s["intersection"]]
        for key, counts in inter_counts.items():
            ser = series[s["id"]][key]
            # No CFS intersection within reach ⇒ no calls of this type at any intersection near the
            # stop since HISTORY_START ⇒ a genuine zero series (intersection stays None so the card
            # can say "no calls at any intersection within 60 m" rather than name one).
            ser["stop"] = list(counts[s["intersection"]]) if s["intersection"] in counts else [0] * n
            ring_tot = [0] * n
            for name in ring:
                if name in counts:
                    c = counts[name]
                    for i in range(n):
                        ring_tot[i] += c[i]
            ser["ring"] = ring_tot
    print(f"911: {snapped}/{len(stops)} stops snapped to an intersection (name match ≤{INTERSECTION_NAME_M} m or nearest ≤{INTERSECTION_SNAP_M} m)")

    for sid, s in stops.items():
        s["series"] = series[sid]
    out = {"generated": TODAY.isoformat(), "history_start": HISTORY_START, "months": months,
           "current_partial_month": TODAY.strftime("%Y-%m"), "gtfs_as_of": gtfs_as_of, "stops": stops}
    with open(os.path.join(CACHE, "joined.json"), "w") as f:
        json.dump(out, f)
    print(f"wrote joined.json ({len(months)} months)")


if __name__ == "__main__":
    main()
