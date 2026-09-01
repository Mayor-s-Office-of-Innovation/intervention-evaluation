"""Stage 0 · step 2 — assign each raw record to a police district (point-in-polygon).

Reuses emergent-map's verified ray-casting (build/03_aggregate_311.py). 311 has no
reliable server-side police-district field (D3), so we test each point against the
qgnn-b9vv district polygons we saved in emergent-map.

Reads  build/cache/<signal>_raw.json
Writes build/cache/<signal>_assigned.json  — [{id, ym, date, lat, lng, district}, …]
Also writes districts/data/police_districts.geojson trimmed to the 4 target districts
(for the frontend map) on first run.
"""
import json
import os
import sys

from signals import SIGNALS, TARGET_DISTRICTS

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
DATA = os.path.join(os.path.dirname(HERE), "data")
# District boundaries (dataset qgnn-b9vv) — a static administrative-boundary set committed
# in-repo under shared/data so the build is self-contained (CI has no emergent-map checkout).
GEOJSON_SRC = os.path.abspath(
    os.path.join(HERE, "..", "..", "shared", "data", "police_districts.geojson")
)


def load_polygons():
    with open(GEOJSON_SRC) as f:
        geo = json.load(f)
    polys = []
    for feat in geo["features"]:
        name = feat["properties"].get("district")
        geom = feat["geometry"]
        if geom["type"] == "Polygon":
            rings = [geom["coordinates"][0]]
        elif geom["type"] == "MultiPolygon":
            rings = [poly[0] for poly in geom["coordinates"]]
        else:
            rings = []
        polys.append((name, rings))
    return geo, polys


def point_in_ring(lng, lat, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def district_for(lat, lng, polys):
    for name, rings in polys:
        for ring in rings:
            if point_in_ring(lng, lat, ring):
                return name
    return "UNKNOWN"


def write_target_geojson(geo):
    """Trim the boundary set to the 4 target districts for the frontend map."""
    feats = [f for f in geo["features"] if f["properties"].get("district") in TARGET_DISTRICTS]
    out = {"type": "FeatureCollection", "features": feats}
    os.makedirs(DATA, exist_ok=True)
    path = os.path.join(DATA, "police_districts.geojson")
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"  wrote {len(feats)} district polygons → {os.path.relpath(path, HERE)}")


def coords_of(r, sig):
    """Return (lat, lng) for a row per the signal's geo_kind, or (None, None)."""
    if sig["geo_kind"] == "latlong":
        lat_s, lng_s = r.get("lat"), r.get("long")
        if lat_s in (None, "") or lng_s in (None, ""):
            return None, None
        return round(float(lat_s), 5), round(float(lng_s), 5)
    # 'point' — a GeoJSON point {coordinates: [lng, lat]}
    pt = r.get(sig["geo_col"])
    coords = pt.get("coordinates") if isinstance(pt, dict) else None
    if not coords or coords[0] is None or coords[1] is None:
        return None, None
    return round(float(coords[1]), 5), round(float(coords[0]), 5)


def assign(signal_key, polys):
    sig = SIGNALS[signal_key]
    with open(os.path.join(CACHE, f"{signal_key}_raw.json")) as f:
        rows = json.load(f)

    seen = set()
    out = []
    dropped_undated = no_coord = 0
    for r in rows:
        rid = r.get(sig["id_col"])
        if rid is not None:
            if rid in seen:
                continue
            seen.add(rid)
        dt = r.get(sig["date_col"])
        if not dt:
            dropped_undated += 1
            continue
        ym, date = dt[:7], dt[:10]
        lat, lng = coords_of(r, sig)
        if lat is None:
            no_coord += 1
            out.append({"id": rid, "ym": ym, "date": date, "lat": None, "lng": None, "district": "UNKNOWN"})
            continue
        out.append({
            "id": rid, "ym": ym, "date": date, "lat": lat, "lng": lng,
            "district": district_for(lat, lng, polys),
        })

    path = os.path.join(CACHE, f"{signal_key}_assigned.json")
    with open(path, "w") as f:
        json.dump(out, f)

    from collections import Counter
    dc = Counter(o["district"] for o in out)
    print(f"  [{signal_key}] {len(out):,} unique records "
          f"(dropped {dropped_undated} undated, {no_coord} without coords)")
    for d in TARGET_DISTRICTS + ["UNKNOWN"]:
        print(f"    {d:<11}: {dc.get(d, 0):,}")
    print(f"  [{signal_key}] wrote → {os.path.relpath(path, HERE)}")


if __name__ == "__main__":
    geo, polys = load_polygons()
    write_target_geojson(geo)
    keys = sys.argv[1:] or list(SIGNALS.keys())
    for k in keys:
        assign(k, polys)
