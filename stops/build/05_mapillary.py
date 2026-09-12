"""Stage 0 · step 5 (optional) — resolve the nearest recent Mapillary street-level image for each stop.

Reads  MAPILLARY_TOKEN or MAPILLARY_ACCESS_TOKEN (any case) from the repo-root .env.local (gitignored) or the environment
       build/cache/joined.json (stop coordinates)
       stops/data/mapillary.json (previous run — reused for stops already resolved unless --refresh)
Writes stops/data/mapillary.json — {generated, radius_m, stops: {stopid: {id, captured, m, pano}}}

Only image IDs are stored. The page embeds the photo via Mapillary's public iframe
(https://www.mapillary.com/embed?image_key=<id>&style=photo), which needs no token — so the token
never ships to the browser and GitHub Pages never sees it. Without a token this step prints a note
and leaves the existing file alone, so the rest of the build still succeeds.

    python3 05_mapillary.py                # every stop not yet resolved (~3,260 API calls first time)
    python3 05_mapillary.py --only concern # just the concern-list stops (quick check)
    python3 05_mapillary.py --refresh      # re-resolve everything
"""
import datetime
import json
import math
import os
import sys
import time
import urllib.parse

from httpget import get_json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(HERE, "cache")
DATA = os.path.join(os.path.dirname(HERE), "data")
OUT = os.path.join(DATA, "mapillary.json")
RADIUS_M = 40          # search box half-width around the stop
API = "https://graph.mapillary.com/images"
FIELDS = "id,captured_at,is_pano,geometry"


KEYS = {"mapillary_token", "mapillary_access_token"}


def token():
    """MAPILLARY_TOKEN / MAPILLARY_ACCESS_TOKEN from the environment or repo-root .env.local
    (case-insensitive, `key = value` or `key=value`, optional quotes)."""
    for k in ("MAPILLARY_TOKEN", "MAPILLARY_ACCESS_TOKEN"):
        if os.environ.get(k):
            return os.environ[k].strip()
    env = os.path.join(ROOT, ".env.local")
    if os.path.exists(env):
        for line in open(env):
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            k, v = line.split("=", 1)
            if k.strip().lower() in KEYS:
                return v.strip().strip('"').strip("'")
    return None


def dist_m(la1, lo1, la2, lo2):
    return math.hypot((la1 - la2) * 111320, (lo1 - lo2) * 111320 * math.cos(math.radians(la1)))


LADDER = (RADIUS_M, 20, 15, 10, 6, 3)   # busy corners: Mapillary refuses boxes with too many images ("reduce the
                                     # amount of data"), so shrink the box until the search succeeds


def search(tok, lat, lng, radius):
    dlat = radius / 111320
    dlng = radius / (111320 * math.cos(math.radians(lat)))
    params = {"access_token": tok, "fields": FIELDS, "limit": "50",
              "bbox": f"{lng - dlng:.6f},{lat - dlat:.6f},{lng + dlng:.6f},{lat + dlat:.6f}"}
    return get_json(API + "?" + urllib.parse.urlencode(params), timeout=60).get("data", [])


# ── Vector-tile fallback: Mapillary "image" layer at z14, decoded from Mapbox Vector Tile protobuf ──
TILE_URL = "https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token={t}"
TILE_Z = 14
_tile_cache = {}


def _varint(buf, i):
    r, shift = 0, 0
    while True:
        b = buf[i]; i += 1
        r |= (b & 0x7F) << shift
        if not b & 0x80:
            return r, i
        shift += 7


def _fields(buf):
    """Yield (field_no, wire_type, value) for a protobuf message. Length-delimited values are bytes."""
    i, n = 0, len(buf)
    while i < n:
        key, i = _varint(buf, i)
        f, wt = key >> 3, key & 7
        if wt == 0:
            v, i = _varint(buf, i)
        elif wt == 2:
            ln, i = _varint(buf, i); v = buf[i:i + ln]; i += ln
        elif wt == 5:
            v = buf[i:i + 4]; i += 4
        elif wt == 1:
            v = buf[i:i + 8]; i += 8
        else:
            raise ValueError(f"unsupported wire type {wt}")
        yield f, wt, v


def _packed(buf):
    out, i = [], 0
    while i < len(buf):
        v, i = _varint(buf, i); out.append(v)
    return out


def _value(buf):
    import struct
    for f, wt, v in _fields(buf):
        if f == 1: return v.decode("utf-8", "replace")
        if f == 2: return struct.unpack("<f", v)[0]
        if f == 3: return struct.unpack("<d", v)[0]
        if f in (4, 5): return v
        if f == 6: return (v >> 1) ^ -(v & 1)
        if f == 7: return bool(v)
    return None


def _decode_image_layer(tile_bytes, z, x, y):
    """Points of the 'image' layer as dicts {id, captured_at, is_pano, lat, lng}."""
    out = []
    for f, wt, layer in _fields(tile_bytes):
        if f != 3:
            continue
        name, keys, values, feats, extent = None, [], [], [], 4096
        for lf, lwt, lv in _fields(layer):
            if lf == 1: name = lv.decode()
            elif lf == 2: feats.append(lv)
            elif lf == 3: keys.append(lv.decode())
            elif lf == 4: values.append(_value(lv))
            elif lf == 5: extent = lv
        if name != "image":
            continue
        n = 2 ** z
        for fb in feats:
            props, geom, fid = {}, [], None
            for ff, fwt, fv in _fields(fb):
                if ff == 1: fid = fv
                elif ff == 2:
                    t = _packed(fv)
                    props = {keys[t[k]]: values[t[k + 1]] for k in range(0, len(t), 2)}
                elif ff == 4: geom = _packed(fv)
            # point geometry: MoveTo commands with zigzag deltas
            i, cx, cy = 0, 0, 0
            while i < len(geom):
                cmd, cnt = geom[i] & 7, geom[i] >> 3; i += 1
                if cmd != 1:
                    break
                for _ in range(cnt):
                    dx, dy = geom[i], geom[i + 1]; i += 2
                    cx += (dx >> 1) ^ -(dx & 1); cy += (dy >> 1) ^ -(dy & 1)
                    px, py = x + cx / extent, y + cy / extent
                    lng = px / n * 360 - 180
                    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * py / n))))
                    out.append({"id": str(props.get("id", fid)), "captured_at": props.get("captured_at"),
                                "is_pano": props.get("is_pano"), "geometry": {"coordinates": [lng, lat]}})
    return out


def tile_images(tok, lat, lng):
    import urllib.request
    n = 2 ** TILE_Z
    x = int((lng + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    key = (TILE_Z, x, y)
    if key not in _tile_cache:
        req = urllib.request.Request(TILE_URL.format(z=TILE_Z, x=x, y=y, t=tok), headers={"User-Agent": "sf-stops-build"})
        with urllib.request.urlopen(req, timeout=60) as r:
            _tile_cache[key] = _decode_image_layer(r.read(), TILE_Z, x, y)
    return _tile_cache[key]


def resolve(tok, lat, lng):
    rows = None
    for radius in LADDER:
        try:
            rows = search(tok, lat, lng, radius)
            break
        except Exception as e:
            if "500" not in str(e):           # anything but the too-much-data 500: one retry then give up
                time.sleep(2)
                rows = search(tok, lat, lng, radius)
                break
    if rows is None:
        # Densest corners (FiDi/SoMa) are refused even at 3 m: fall back to the vector tile, which is
        # built for dense data and never refuses (50k tiles/day cap; a handful of z14 tiles cover downtown).
        rows = tile_images(tok, lat, lng)
    best = None
    for r in rows:
        try:
            glng, glat = r["geometry"]["coordinates"]
        except (KeyError, TypeError, ValueError):
            continue
        d = dist_m(lat, lng, glat, glng)
        if d > RADIUS_M:
            continue
        ts = int(r.get("captured_at") or 0)
        # prefer non-panoramic, then recent, then close: score = years old + distance penalty
        age_y = (time.time() * 1000 - ts) / (365.25 * 86400 * 1000)
        score = age_y + d / 40 + (1.5 if r.get("is_pano") else 0)
        if best is None or score < best[0]:
            best = (score, {"id": r["id"], "captured": datetime.date.fromtimestamp(ts / 1000).isoformat() if ts else None,
                            "m": round(d), "pano": bool(r.get("is_pano"))})
    return best[1] if best else None


def main(argv):
    tok = token()
    if not tok:
        print("05_mapillary: no MAPILLARY_TOKEN in .env.local or environment — skipping (existing data/mapillary.json kept)")
        return 0
    with open(os.path.join(CACHE, "joined.json")) as f:
        stops = json.load(f)["stops"]
    prev = json.load(open(OUT))["stops"] if os.path.exists(OUT) else {}
    ids = list(stops)
    if "--only" in argv and argv[argv.index("--only") + 1] == "concern":
        c = json.load(open(os.path.join(DATA, "concern.json")))
        ids = [r["id"] for r in c["rows"] if r.get("matched")]
    todo = ids if "--refresh" in argv else [i for i in ids if i not in prev]
    print(f"05_mapillary: {len(todo)} stops to resolve ({len(prev)} already resolved)")
    out = dict(prev)
    found = 0
    for n, sid in enumerate(todo, 1):
        s = stops[sid]
        try:
            hit = resolve(tok, s["lat"], s["lng"])
        except Exception as e:      # keep going; leave the stop unrecorded so the next run retries it
            print(f"  [{sid}] error after retries: {e}")
            continue
        out[sid] = hit
        found += bool(hit)
        if n % 100 == 0 or n == len(todo):
            print(f"  {n}/{len(todo)} · {found} with an image", flush=True)
            with open(OUT, "w") as f:
                json.dump({"generated": datetime.date.today().isoformat(), "radius_m": RADIUS_M, "stops": out}, f, separators=(",", ":"))
        time.sleep(0.05)
    with open(OUT, "w") as f:
        json.dump({"generated": datetime.date.today().isoformat(), "radius_m": RADIUS_M, "stops": out}, f, separators=(",", ":"))
    print(f"wrote {OUT}: {sum(1 for v in out.values() if v)} of {len(out)} stops have an image within {RADIUS_M} m")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
