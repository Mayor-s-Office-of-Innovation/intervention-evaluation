"""Stage 2 · transition classifier — per-intersection hot/cold on the fixed Lurie split (D11/D12).

For each presence signal, canonicalize reports to ~block cells and classify each cell by comparing
its PRE-Lurie monthly rate (2023-01 → 2024-12) to its "hot now" rate (last 3 complete months):

  • persistent  — hot before AND still hot now (and not a big drop)
  • cooled      — was hot (pre-Lurie OR a post-Lurie spike) and is now meaningfully lower
                  (this folds in "emerged post-Lurie then cooled", per the plan)
  • emerged     — cold before, hot now

Built on the PRESENCE signals only (encampment + the 911 group), never the enforcement/HSOC signal (D8).
No settling buffer (D13): "now" runs right up to the latest complete month.

Reads  build/cache/<signal>_assigned.json   (date, lat, lng, district — already in the 4 districts)
Writes unhoused/data/transitions/<key>.json — [{lat,lng,district,category,preRate,nowRate,...}, …]
                                              + a summary block the page shows.

Thresholds are TUNABLE (D12): a min-event floor + a hot monthly-rate + a cooled drop-fraction.
Re-run and eyeball the printed category counts; adjust HOT_RATE / FLOOR / COOL_FRAC to taste.
"""
import datetime
import json
import os
import sys
from collections import defaultdict, Counter

from tod import BUCKETS, tod_bucket, TOD_BUCKET_NAMES, tod_granular_bucket
from signals import SIGNALS, GROUPS, TARGET_DISTRICTS, DISTRICT_LABEL


def clean_loc(s):
    """Normalize a report's location label for the cell popup: CFS intersections use a backslash
    ('BATTERY ST \\ PINE ST' → 'BATTERY ST / PINE ST'); 311 addresses carry a city/state tail we drop
    ('150 MAIN ST, SAN FRANCISCO, CA …' → '150 MAIN ST')."""
    s = str(s).strip().replace(" \\ ", " / ").replace("\\", " / ")
    return s.split(",")[0].strip()

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
DATA = os.path.join(os.path.dirname(HERE), "data")

# ── Windows ──
PRE_START, PRE_END = "2023-01", "2024-12"   # pre-Lurie baseline (24 months, 2 summers)
PRE_MONTHS = 24
NOW_MONTHS = 3                               # "hot now" = trailing 3 complete months (D12)

# When True, the latest (in-progress) calendar month is treated as the newest analysis month so the
# map's "now" window reflects the freshest data, even though that month is not yet complete (its monthly
# RATE reads slightly low). Deliberate choice (2026-06-29): freshness over the partial-month false-drop
# guard. Set False to revert to the prior convention (analyze only through the last COMPLETE month).
INCLUDE_PARTIAL_MONTH = True

# ── Tunable classification knobs (D12) ──
CELL_DECIMALS = 3        # ~111 m N–S cells (block-ish)
FLOOR = 6                # min total reports in a cell (pre+now) to classify at all (kill lone spikes)
# "Hot" rate is PER SIGNAL because the two signals are on very different scales: encampment 311 cells
# run ~1.3/mo median, 911 calls only ~0.7/mo. A single bar made the 911 map nearly empty of
# persistent/cooled, so each signal gets its own threshold (tuned by eyeballing the live maps, D12).
HOT_RATE = {
    "encampment": 3.0,   # higher bar → focuses on stronger hotspots, thins dense overlap
    "cfs_presence": 1.25,  # lower bar → the lower-volume 911 map has real persistent/cooled, not all-emerged
}
BAND = 0.35              # dead-band around the district tide: within ±35% of expected = "tracked it"
                         # (rose/fell beyond it = emerged/cooled relative to the district)

# Presence signals the map is built on (D8 — never the HSOC/enforcement signal).
MAP_SIGNALS = {
    "encampment": ["encampment"],
    "cfs_presence": GROUPS["cfs_presence"]["members"],   # sitlie + homeless, combined
}
MAP_LABEL = {
    "encampment": SIGNALS["encampment"]["label"],
    "cfs_presence": GROUPS["cfs_presence"]["label"],
}


def latest_analysis_month():
    """The newest month the map analyzes. With INCLUDE_PARTIAL_MONTH the current (in-progress) month is
    used; otherwise the last COMPLETE month (the current month is partial → previous is complete)."""
    today = datetime.date.today()
    y, m = today.year, today.month
    if INCLUDE_PARTIAL_MONTH:
        return f"{y:04d}-{m:02d}"
    m -= 1
    if m == 0:
        m, y = 12, y - 1
    return f"{y:04d}-{m:02d}"


def now_window(latest):
    """The NOW_MONTHS complete months ending at `latest` (inclusive), as a set of 'YYYY-MM'."""
    y, m = int(latest[:4]), int(latest[5:7])
    out = []
    for _ in range(NOW_MONTHS):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return set(out)


def in_pre(ym):
    return PRE_START <= ym <= PRE_END


def load_records(member_keys):
    """Merge assigned records across one or more signals (for the combined 911 group)."""
    recs = []
    for k in member_keys:
        with open(os.path.join(CACHE, f"{k}_assigned.json")) as f:
            for r in json.load(f):
                if r["district"] in TARGET_DISTRICTS and r["lat"] is not None:
                    recs.append(r)
    return recs


def classify(key, latest, nowset, summary):
    recs = load_records(MAP_SIGNALS[key])
    # per cell: pre & now counts + a full monthly histogram (for the popup sparkline);
    # track district so we can normalize against the district "tide".
    # `m` is the total monthly histogram (the parity oracle, unchanged); `m_day`/`m_night` are the
    # day/night splits the frontend filter selects (plan-time-of-day.md §3). m == m_day + m_night.
    # `m_tod` holds the 4 granular buckets (morning/afternoon/evening/night — a finer partition than
    # day/night) the map's "Time of day" chips select; sum of the 4 == m (verified below).
    cells = defaultdict(lambda: {"pre": 0, "now": 0, "lat": 0.0, "lng": 0.0, "n": 0, "dist": None,
                                 "m": defaultdict(int), "m_day": defaultdict(int),
                                 "m_night": defaultdict(int),
                                 "m_tod": {b: defaultdict(int) for b in TOD_BUCKET_NAMES},
                                 "names": Counter()})
    dist_pre = defaultdict(int)
    dist_now = defaultdict(int)
    # Full per-district monthly histogram (every in-district report, aligned to MONTHS). The browser
    # sums this over any scrubbed window to recompute the district "tide" — so it lives in the data
    # file and parity-matches the fixed-preset tide computed below (D7 / classify.js). Split by bucket
    # too so the tide can be recomputed within the selected day/night window.
    dist_month = defaultdict(lambda: defaultdict(int))
    dist_month_tod = {b: defaultdict(lambda: defaultdict(int)) for b in BUCKETS}
    # Per-district monthly histogram split by the 4 granular buckets — the matching denominator so the
    # map's time-of-day filter normalizes the cell against the SAME slice of the district tide.
    dist_month_todg = {b: defaultdict(lambda: defaultdict(int)) for b in TOD_BUCKET_NAMES}
    for r in recs:
        cy = round(r["lat"], CELL_DECIMALS)
        cx = round(r["lng"], CELL_DECIMALS)
        c = cells[(cy, cx)]
        c["lat"] += r["lat"]; c["lng"] += r["lng"]; c["n"] += 1; c["dist"] = r["district"]
        det = r.get("detail") or {}
        loc = det.get("intersection_name") or det.get("address")
        if loc:
            c["names"][clean_loc(loc)] += 1
        ym = r["ym"]
        b = tod_bucket(r.get("hour"))
        gb = tod_granular_bucket(r.get("hour"))
        c["m"][ym] += 1
        c["m_" + b][ym] += 1
        c["m_tod"][gb][ym] += 1
        dist_month[r["district"]][ym] += 1
        dist_month_tod[b][r["district"]][ym] += 1
        dist_month_todg[gb][r["district"]][ym] += 1
        if in_pre(ym):
            c["pre"] += 1; dist_pre[r["district"]] += 1
        elif ym in nowset:
            c["now"] += 1; dist_now[r["district"]] += 1

    # District tide: how much the WHOLE district's monthly rate changed pre→now. This absorbs the
    # June-2025 reroute, citywide secular trend, and seasonality, so a cell is judged on whether it
    # moved relative to its district — difference-in-differences (D6/D12), not an absolute count.
    tide = {}
    for d in TARGET_DISTRICTS:
        pre_rate = dist_pre[d] / PRE_MONTHS
        now_rate = dist_now[d] / NOW_MONTHS
        tide[d] = (now_rate / pre_rate) if pre_rate > 0 else 1.0

    hot = HOT_RATE[key]
    out = []
    counts = defaultdict(int)
    for (cy, cx), c in cells.items():
        # Window-INDEPENDENT inclusion (D7): emit every block with enough ALL-TIME volume to ever be a
        # hotspot in some scrubbed window, not just those hot under the fixed Lurie split. The browser
        # reclassifies these against any window from their `monthly` array (classify.js).
        if c["n"] < FLOOR:
            continue
        pre_rate = c["pre"] / PRE_MONTHS
        now_rate = c["now"] / NOW_MONTHS
        expected = pre_rate * tide[c["dist"]]

        # Fixed-preset (24-mo pre vs 3-mo now) classification, baked as the PARITY ORACLE for
        # classify.js. `category` is null for cells the fixed preset doesn't classify — they're still
        # emitted (with `monthly`) so the scrubber can classify them under any window.
        cat = None
        if c["pre"] + c["now"] >= FLOOR:
            hot_before = pre_rate >= hot
            hot_now = now_rate >= hot
            if hot_before or hot_now:
                rose = now_rate > expected * (1 + BAND)     # grew faster than its district
                fell = now_rate < expected * (1 - BAND)     # grew slower / shrank vs its district
                if hot_now and not hot_before:
                    cat = "emerged" if rose else None        # newly hot AND outpaced the district tide
                elif fell and (hot_before or now_rate < hot):
                    cat = "cooled"                           # was hot, fell relative to its district
                elif hot_before and hot_now:
                    cat = "persistent"                       # stayed hot, roughly tracking its district
        if cat:
            counts[cat] += 1

        out.append({
            "lat": round(c["lat"] / c["n"], 5),
            "lng": round(c["lng"] / c["n"], 5),
            "name": c["names"].most_common(1)[0][0] if c["names"] else None,  # most-reported spot in the cell
            "district": DISTRICT_LABEL[c["dist"]],
            "category": cat,                                  # fixed-preset oracle (may be null)
            "preRate": round(pre_rate, 2),
            "nowRate": round(now_rate, 2),
            "expectedRate": round(expected, 2),
            "total": c["n"],                                  # all-time volume (window-independent)
            "monthly": [c["m"].get(mo, 0) for mo in MONTHS],  # aligned to meta.months — the raw material
            "monthly_day": [c["m_day"].get(mo, 0) for mo in MONTHS],     # day/night splits (sum == monthly)
            "monthly_night": [c["m_night"].get(mo, 0) for mo in MONTHS],
            # granular time-of-day splits (the 4 buckets sum to monthly — see assertion below)
            "monthly_tod": {b: [c["m_tod"][b].get(mo, 0) for mo in MONTHS] for b in TOD_BUCKET_NAMES},
        })

    # Parity guard: the 4 granular buckets must repartition the monthly total exactly (mirrors the
    # day/night `m == m_day + m_night` invariant). Catches any hour-bucketing drift at build time.
    for cell in out:
        gsum = [sum(vals) for vals in zip(*cell["monthly_tod"].values())]
        assert gsum == cell["monthly"], f"granular buckets != monthly for a {key} cell"

    classified = sum(counts.values())
    summary[key] = {
        "label": MAP_LABEL[key],
        "members": MAP_SIGNALS[key],
        "hot_rate_per_month": hot,
        "district_tide": {DISTRICT_LABEL[d]: round(tide[d], 2) for d in TARGET_DISTRICTS},
        # per-district monthly totals (aligned to MONTHS) so the browser recomputes the tide per window
        "district_monthly": {DISTRICT_LABEL[d]: [dist_month[d].get(mo, 0) for mo in MONTHS]
                             for d in TARGET_DISTRICTS},
        # day/night splits of the district tide (sum == district_monthly), for the time-of-day filter
        "district_monthly_day": {DISTRICT_LABEL[d]: [dist_month_tod["day"][d].get(mo, 0) for mo in MONTHS]
                                 for d in TARGET_DISTRICTS},
        "district_monthly_night": {DISTRICT_LABEL[d]: [dist_month_tod["night"][d].get(mo, 0) for mo in MONTHS]
                                   for d in TARGET_DISTRICTS},
        # granular per-bucket district tide (sum of the 4 == district_monthly), the matching denominator
        # for the map's time-of-day filter
        "district_monthly_tod": {b: {DISTRICT_LABEL[d]: [dist_month_todg[b][d].get(mo, 0) for mo in MONTHS]
                                     for d in TARGET_DISTRICTS}
                                 for b in TOD_BUCKET_NAMES},
        "counts": dict(counts),
        "cells": len(out),
        "classified_fixed_preset": classified,
    }
    print(f"  [{key}] {len(out)} candidate cells ({classified} classified under fixed preset) → "
          f"persistent {counts['persistent']}, cooled {counts['cooled']}, emerged {counts['emerged']}  "
          f"| district tide {summary[key]['district_tide']}")
    return out


def _min_month(s):
    return min(s)


def _months_between(a, b):
    ay, am = int(a[:4]), int(a[5:7])
    by, bm = int(b[:4]), int(b[5:7])
    return (by - ay) * 12 + (bm - am)


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


if __name__ == "__main__":
    latest = latest_analysis_month()
    nowset = now_window(latest)
    MONTHS = month_axis(PRE_START, latest)   # sparkline x-axis (2023-01 → latest analysis month)
    partial = " (PARTIAL/in-progress)" if INCLUDE_PARTIAL_MONTH else " (complete)"
    print(f"Lurie split: pre {PRE_START}…{PRE_END} vs now {sorted(nowset)} (latest {latest}{partial})")
    print(f"Knobs: cell={CELL_DECIMALS}dp floor={FLOOR} hot_rate(per-signal)={HOT_RATE}/mo band=±{BAND}")

    keys = sys.argv[1:] or list(MAP_SIGNALS.keys())
    os.makedirs(os.path.join(DATA, "transitions"), exist_ok=True)
    summary = {}
    meta = {
        "generated": datetime.date.today().isoformat(),
        "lurie_inauguration": "2025-01-08",
        "pre_window": [PRE_START, PRE_END],
        "now_window": sorted(nowset),
        "latest_month": latest,
        "latest_month_partial": INCLUDE_PARTIAL_MONTH,   # newest month is in-progress → rate reads low
        "months": MONTHS,
        "lurie_month": "2025-01",
        "knobs": {"cell_decimals": CELL_DECIMALS, "floor": FLOOR,
                  "hot_rate_per_month_by_signal": HOT_RATE, "tide_band": BAND},
        "signals": summary,
    }
    for key in keys:
        print(f"Classifying '{key}' …")
        cells = classify(key, latest, nowset, summary)
        with open(os.path.join(DATA, "transitions", f"{key}.json"), "w") as f:
            json.dump(cells, f, separators=(",", ":"))
    with open(os.path.join(DATA, "transitions", "_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    print("\nwrote data/transitions/*.json + _meta.json")
