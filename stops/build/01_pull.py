"""Stage 0 · step 1 — pull raw records for each signal (citywide, since HISTORY_START) and the
DataSF Muni Stops snapshot. Stdlib only; pages with $order=:id + $offset. Writes
build/cache/<signal>_raw.json and build/cache/stops_raw.json. cwd-independent.

    python3 01_pull.py                 # everything
    python3 01_pull.py encampment      # one signal
    python3 01_pull.py stops           # just the stops snapshot
"""
import json
import os
import sys
import time
import urllib.parse

from httpget import get_json
from signals import SIGNALS, STOPS_DATASET, HISTORY_START

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
PAGE = 50000


def fetch_page(sig, offset):
    where = f"{sig['where']} AND {sig['date_col']} >= '{HISTORY_START}'"
    params = {"$select": sig["select"], "$where": where, "$order": ":id",
              "$limit": str(PAGE), "$offset": str(offset)}
    return get_json(f"https://{sig['domain']}/resource/{sig['dataset']}.json?" + urllib.parse.urlencode(params),
                    timeout=300)


def pull(key):
    sig = SIGNALS[key]
    rows, offset = [], 0
    while True:
        page = fetch_page(sig, offset)
        rows.extend(page)
        print(f"  [{key}] +{len(page):>6} (offset {offset:>7}) → {len(rows):>7} total", flush=True)
        if len(page) < PAGE:
            break
        offset += PAGE
        time.sleep(0.3)
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, f"{key}_raw.json"), "w") as f:
        json.dump(rows, f)
    print(f"  [{key}] wrote {len(rows):,} rows", flush=True)


def pull_stops():
    url = (f"https://{STOPS_DATASET['domain']}/resource/{STOPS_DATASET['dataset']}.json?"
           + urllib.parse.urlencode({"$limit": "10000", "$order": "stopid"}))
    rows = get_json(url)
    os.makedirs(CACHE, exist_ok=True)
    with open(os.path.join(CACHE, "stops_raw.json"), "w") as f:
        json.dump(rows, f)
    print(f"  [stops] wrote {len(rows):,} stops ({sum(1 for r in rows if r.get('shelter') == '1')} sheltered)", flush=True)


if __name__ == "__main__":
    keys = sys.argv[1:] or ["stops", *SIGNALS.keys()]
    for k in keys:
        print(f"Pulling '{k}' …", flush=True)
        pull_stops() if k == "stops" else pull(k)
