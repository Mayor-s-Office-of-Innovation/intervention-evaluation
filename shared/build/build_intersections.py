"""Bake the authoritative SF cross-street index used by the map search fallback.

Source: DataSF `jfxm-zeee` — "Intersections by Each Cross Street Permutation"
(https://data.sfgov.org/resource/jfxm-zeee.json). ~21k permutation rows over ~9.4k intersection
nodes; every real SF corner with lat/lng. This replaces the old Nominatim geocoder, which had no
intersection index and returned [] for valid corners (e.g. Laguna & Ellis, Fillmore & Clay).

Why baked: the site is static GH Pages, accuracy is paramount, and the corner list is signal- and
dashboard-independent — so pull it once, offline, into a compact shared asset the search matches
locally (instant, no runtime external dependency).

Output: shared/data/sf-intersections.json — a street-name DICTIONARY + integer-indexed rows to keep
the file small (street names repeat heavily across corners):
    {
      "source": "jfxm-zeee", "generated": "YYYY-MM-DD", "coordScale": 100000,
      "streets": ["MISSION ST", "16TH ST", ...],       # unique display names
      "pts": [[latE5, lngE5, aIdx, bIdx], ...]         # one row per unordered corner
    }
The frontend reconstructs each corner's display name ("MISSION ST / 16TH ST") and match tokens from
the dictionary on load. Stdlib only; cwd-independent.
"""
import datetime
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), "data")          # shared/data/
OUT = os.path.join(OUT_DIR, "sf-intersections.json")
DOMAIN = "data.sfgov.org"
DATASET = "jfxm-zeee"
COORD_SCALE = 100000                                            # 5 dp ≈ 1.1 m, matches marker files
PAGE = 50000
_UA = {"User-Agent": "sf-district-dashboard-build"}


def get_json(url, timeout=120):
    """Read-only public GET; fall back to unverified TLS on macOS python.org builds (no system CAs)."""
    req = urllib.request.Request(url, headers=_UA)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ssl.create_default_context()) as r:
            return json.load(r)
    except (urllib.error.URLError, ssl.SSLError) as e:
        reason = getattr(e, "reason", e)
        if not isinstance(reason, ssl.SSLError):
            raise
        with urllib.request.urlopen(req, timeout=timeout, context=ssl._create_unverified_context()) as r:
            return json.load(r)


def norm_key(name):
    """Sorted significant-token key — mirrors the frontend's streetTokens() so dedup matches search.
    Lowercase, strip street-type suffixes, normalize ordinals (16TH→16)."""
    SUFFIX = {"st", "street", "ave", "avenue", "blvd", "boulevard", "dr", "drive", "ct", "court",
              "ln", "lane", "pl", "place", "ter", "terrace", "way", "hwy", "highway", "rd", "road",
              "plz", "plaza", "row", "aly", "alley", "cir", "circle"}
    toks = set()
    for w in "".join(c if c.isalnum() else " " for c in name.lower()).split():
        if w == "and":
            continue
        if w[:-2].isdigit() and w[-2:] in ("st", "nd", "rd", "th"):
            w = w[:-2]                                          # 16th → 16
        if w in SUFFIX:
            continue
        toks.add(w)
    return " ".join(sorted(toks))


def fetch_all():
    rows, offset = [], 0
    while True:
        params = {
            "$select": "street_name_1,street_name_2,latitude,longitude",
            "$where": "latitude IS NOT NULL AND longitude IS NOT NULL",
            "$order": ":id",
            "$limit": str(PAGE),
            "$offset": str(offset),
        }
        url = f"https://{DOMAIN}/resource/{DATASET}.json?" + urllib.parse.urlencode(params)
        page = get_json(url)
        rows.extend(page)
        print(f"  +{len(page):>6} (offset {offset:>6}) → {len(rows):>6} total")
        if len(page) < PAGE:
            break
        offset += PAGE
        time.sleep(0.3)                                        # be polite to the open portal
    return rows


def build():
    rows = fetch_all()
    streets = {}                                               # display name → index
    corners = {}                                               # unordered token-pair key → (latE5, lngE5, aIdx, bIdx)

    def street_idx(name):
        if name not in streets:
            streets[name] = len(streets)
        return streets[name]

    skipped = 0
    for r in rows:
        n1, n2 = (r.get("street_name_1") or "").strip(), (r.get("street_name_2") or "").strip()
        if not n1 or not n2:
            skipped += 1
            continue
        k1, k2 = norm_key(n1), norm_key(n2)
        if not k1 or not k2 or k1 == k2:                       # need two distinct real streets
            skipped += 1
            continue
        pair_key = " × ".join(sorted((k1, k2)))
        if pair_key in corners:
            continue                                           # reversed permutation / dupe node
        try:
            lat_e5 = round(float(r["latitude"]) * COORD_SCALE)
            lng_e5 = round(float(r["longitude"]) * COORD_SCALE)
        except (KeyError, TypeError, ValueError):
            skipped += 1
            continue
        corners[pair_key] = [lat_e5, lng_e5, street_idx(n1), street_idx(n2)]

    street_list = [None] * len(streets)
    for name, i in streets.items():
        street_list[i] = name

    out = {
        "source": DATASET,
        "source_url": f"https://{DOMAIN}/resource/{DATASET}.json",
        "generated": datetime.date.today().isoformat(),
        "coordScale": COORD_SCALE,
        "streets": street_list,
        "pts": list(corners.values()),
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"\n  raw rows        : {len(rows):,}")
    print(f"  unique corners  : {len(corners):,}")
    print(f"  unique streets  : {len(street_list):,}")
    print(f"  skipped         : {skipped:,}")
    print(f"  wrote           : {os.path.relpath(OUT, os.path.dirname(HERE))}  "
          f"({os.path.getsize(OUT) / 1024:.0f} KB)")


if __name__ == "__main__":
    build()
