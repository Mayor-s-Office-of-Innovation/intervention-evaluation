"""Stage 0 · step 1 — pull raw point records for each signal from Socrata.

Stdlib only (urllib) — no pip deps. Pages with $order=:id + $offset for stable
pagination. Writes one cache file per signal to build/cache/<signal>_raw.json as a
list of minimal row dicts. cwd-independent (paths resolve from this file).
"""
import json
import os
import sys
import time
import urllib.parse

from httpget import get_json
from signals import SIGNALS, HISTORY_START

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
PAGE = 50000  # Socrata max rows per request


def fetch_page(sig, offset):
    where = f"{sig['where']} AND {sig['date_col']} >= '{HISTORY_START}'"
    params = {
        "$select": sig["select"],
        "$where": where,
        "$order": ":id",
        "$limit": str(PAGE),
        "$offset": str(offset),
    }
    url = f"https://{sig['domain']}/resource/{sig['dataset']}.json?" + urllib.parse.urlencode(params)
    return get_json(url)


def pull(signal_key):
    sig = SIGNALS[signal_key]
    rows, offset = [], 0
    while True:
        page = fetch_page(sig, offset)
        rows.extend(page)
        print(f"  [{signal_key}] +{len(page):>6} (offset {offset:>7}) → {len(rows):>7} total")
        if len(page) < PAGE:
            break
        offset += PAGE
        time.sleep(0.3)  # be polite to the open portal
    os.makedirs(CACHE, exist_ok=True)
    out = os.path.join(CACHE, f"{signal_key}_raw.json")
    with open(out, "w") as f:
        json.dump(rows, f)
    print(f"  [{signal_key}] wrote {len(rows):,} rows → {os.path.relpath(out, HERE)}")
    return len(rows)


if __name__ == "__main__":
    keys = sys.argv[1:] or list(SIGNALS.keys())
    for k in keys:
        print(f"Pulling '{k}' …")
        pull(k)
