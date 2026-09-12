"""Stage 0 · step 4 — emit the JSON the page consumes.

Reads  build/cache/joined.json, build/concern_list.public.tsv (committed: Stop ID, Location, Boardings)
       — or, with --full, build/concern_list.tsv (gitignored: the leadership list with notes, boardings,
       missed-servicing rank, removal requests). PUBLIC IS THE DEFAULT: the detailed overlay is never
       written unless --full is asked for, so a routine rebuild can't leak the list's details.
Writes stops/data/stops.json          — every stop's meta (no series) + 12-month totals per signal, months axis
       stops/data/series/<NN>.json    — per-stop monthly series {stopid: {sig: {stop:[], ring:[]}}}, sharded by
                                        the first two digits of stopid (~35 files) so a card loads one small file
       stops/data/concern.json        — the leadership overlay (plan §7): pinned stops + basis + flags
       stops/data/citywide.json       — concentration curve + top sheltered stops by encampment (plan D9)
       stops/data/provenance.json     — datasets, verbatim filters, runnable citywide + per-stop query templates
"""
import csv
import datetime
import json
import os
import re
import sys
from collections import defaultdict

from signals import (SIGNALS, DATASET_NAME, HISTORY_START, STOP_RADIUS_M, RING_M, NEIGHBOUR_M,
                     INTERSECTION_SNAP_M, query_url, stop_query_template,
                     stop_total_template)

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
DATA = os.path.join(os.path.dirname(HERE), "data")
TODAY = datetime.date.today()

BASIS_RULES = [
    ("contractor", re.compile(r"missed servicing", re.I)),
    ("cbd", re.compile(r"\bCBD\b|Partnership|TNDC", re.I)),
    ("state", re.compile(r"State of California|Highway Patrol|General Services", re.I)),
    ("mayor", re.compile(r"Mayor", re.I)),
]


def basis_types(text):
    t = [k for k, rx in BASIS_RULES if rx.search(text or "")]
    return t or ["unstated"]


def read_concern(path, detail):
    """Rows of the overlay. detail=False (public) keeps only Stop ID + Location; detail=True (--full)
    carries the list's notes, boardings, rank and removal flag."""
    if not os.path.exists(path):
        print(f"  (no concern list at {path} — overlay will be empty)")
        return [], None
    rows = [r for r in csv.DictReader(open(path, encoding="utf-8-sig"), delimiter="\t") if (r.get("Stop ID") or "").strip()]
    g = lambda r, k: (r.get(k) or "").strip()
    out = []
    for r in rows:
        code = g(r, "Stop ID")
        sid = code[1:] if re.fullmatch(r"1\d{4}", code) else None
        rec = {"code": code, "id": sid, "list_location": g(r, "Location"),
               # The list's own "Boardings" column is empty in every row; the figures sit under a column
               # headed "Lift deployments: Aver/day". Confirmed with the list owner (2026-09-12) that these
               # are daily boardings and the heading is legacy — the value distribution agrees (median 56,
               # max 303, implausible as lift cycles). No citable SFMTA source yet; the card says so.
               "boardings": g(r, "Boardings") or g(r, "Lift deployments: Aver/day")}   # public: shown on the card
        if detail:
            rec.update({
                "precinct": g(r, "Police Precinct"),
                "issue": g(r, "Primary Issue"), "basis": g(r, "Basis / Notes"),
                "basis_types": basis_types(g(r, "Basis / Notes")),
                "missed_servicing_rank": g(r, "Jan-Jun Rank") or None,
                "needs_verification": g(r, "Needs Verification").lower() == "yes",
                "removal_requested": g(r, "Request for removals").lower() == "yes",
            })
        out.append(rec)
    mtime = datetime.date.fromtimestamp(os.path.getmtime(path)).isoformat()
    return out, mtime


def main(concern_path, detail):
    with open(os.path.join(CACHE, "joined.json")) as f:
        J = json.load(f)
    months, stops = J["months"], J["stops"]
    partial = J["current_partial_month"]
    complete = [m for m in months if m < partial]
    latest_complete = complete[-1]
    t12 = complete[-12:]
    t12_idx = [months.index(m) for m in t12]

    # ── stops.json ──
    meta = []
    for s in stops.values():
        tot = {}
        for key in SIGNALS:
            ser = s["series"][key]["stop"]
            tot[key] = None if ser is None else sum(ser[i] for i in t12_idx)
        meta.append({k: s[k] for k in ("id", "code", "name", "lat", "lng", "shelter", "shelter_as_of",
                                        "accessible", "on", "at", "position", "supe", "routes", "alts",
                                        "in_gtfs", "neighbours", "intersection", "intersection_m")}
                    | {"t12": tot})
    meta.sort(key=lambda s: int(s["id"]))
    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "stops.json"), "w") as f:
        json.dump({"generated": J["generated"], "history_start": HISTORY_START, "months": months,
                   "latest_complete_month": latest_complete, "current_partial_month": partial,
                   "t12_window": [t12[0], t12[-1]], "signals": list(SIGNALS.keys()),
                   "gtfs_as_of": J.get("gtfs_as_of"),
                   "geometry": {"stop_radius_m": STOP_RADIUS_M, "ring_m": RING_M, "neighbour_m": NEIGHBOUR_M,
                                "intersection_snap_m": INTERSECTION_SNAP_M},
                   "stops": meta}, f, separators=(",", ":"))
    print(f"stops.json: {len(meta)} stops, months {months[0]}…{months[-1]} (latest complete {latest_complete})")

    # ── series shards ──
    sdir = os.path.join(DATA, "series")
    os.makedirs(sdir, exist_ok=True)
    for old in os.listdir(sdir):
        os.remove(os.path.join(sdir, old))
    shards = defaultdict(dict)
    for sid, s in stops.items():
        shards[sid.zfill(4)[:2]][sid] = s["series"]
    for sh, body in shards.items():
        with open(os.path.join(sdir, f"{sh}.json"), "w") as f:
            json.dump(body, f, separators=(",", ":"))
    print(f"series: {len(shards)} shards")

    # ── concern overlay ──
    rows, list_date = read_concern(concern_path, detail)
    matched = 0
    for r in rows:
        s = stops.get(r["id"]) if r["id"] else None
        r["matched"] = bool(s)
        if s:
            matched += 1
            r["name"] = s["name"]
            r["shelter"] = s["shelter"]
            r["alts_on_list"] = []   # filled below
    listed = {r["id"] for r in rows if r["matched"]}
    for r in rows:
        if r["matched"]:
            r["alts_on_list"] = sorted({a["stop"] for a in stops[r["id"]]["alts"] if a["stop"] in listed})
    with open(os.path.join(DATA, "concern.json"), "w") as f:
        json.dump({"list_date": list_date, "source": os.path.basename(concern_path), "detail": detail,
                   "note": ("Leadership concern list, FULL detail (built with --full). 'boardings' is the list's own "
                            "figure (its column was headed 'Lift deployments' — confirm)." if detail else
                            "Leadership concern list, PUBLIC form: stop identities + the list's boardings figure. Rebuild with "
                            "--full and the gitignored build/concern_list.tsv to restore notes, rank and removal requests."),
                   "rows": rows}, f, indent=1)
    print(f"concern.json ({'FULL' if detail else 'public'}): {len(rows)} rows, {matched} matched"
          + (f", {sum(1 for r in rows if r.get('removal_requested'))} removal requests" if detail else ""))

    # ── citywide context (D9) ──
    enc = "encampment"
    sheltered = [s for s in stops.values() if s["shelter"]]
    ranked = sorted(sheltered, key=lambda s: -sum(s["series"][enc]["stop"][i] for i in t12_idx))
    total = sum(sum(s["series"][enc]["stop"][i] for i in t12_idx) for s in sheltered)
    curve, run = [], 0
    for k, s in enumerate(ranked, 1):
        run += sum(s["series"][enc]["stop"][i] for i in t12_idx)
        if k in (5, 10, 25, 50, 100, 200):
            curve.append({"top": k, "share": round(run / total, 3) if total else None})
    # "all"/"months_active" stop at the last complete month — the stop card does the same, and a
    # label reading "Since 2023" must mean the same span in both places (stops-review.md F2).
    top = [{"id": s["id"], "name": s["name"], "supe": s["supe"],
            "t12": sum(s["series"][enc]["stop"][i] for i in t12_idx),
            "all": sum(s["series"][enc]["stop"][:-1]),
            "months_active": sum(1 for v in s["series"][enc]["stop"][:-1] if v),
            "on_list": s["id"] in listed} for s in ranked[:50]]
    with open(os.path.join(DATA, "citywide.json"), "w") as f:
        json.dump({"signal": enc, "window": [t12[0], t12[-1]], "sheltered_stops": len(sheltered),
                   "sheltered_with_zero": sum(1 for s in sheltered if not any(s["series"][enc]["stop"][:-1])),
                   "total_t12": total, "concentration": curve, "top": top}, f, indent=1)
    print(f"citywide.json: top sheltered stop {top[0]['name']} ({top[0]['t12']} in 12 mo); "
          f"top 10 = {curve[1]['share']:.0%}")

    # ── provenance ──
    prov = {"generated": TODAY.isoformat(), "history_start": HISTORY_START,
            "stops_dataset": {"id": "i28k-bkz6", "name": DATASET_NAME["i28k-bkz6"],
                              "shelter_as_of": next((s["shelter_as_of"] for s in stops.values() if s["shelter_as_of"]), None),
                              "url": "https://data.sf.gov/Transportation/Muni-Stops/i28k-bkz6"},
            "gtfs": {"url": "https://gtfs.sfmta.com/transitdata/google_transit.zip",
                     "note": "stop_id = DataSF stopid; routes served + nearest same-route alternative stop "
                             "(straight-line metres, slight understatement of the walk)."},
            "geometry": {"stop_radius_m": STOP_RADIUS_M, "ring_m": RING_M, "neighbour_m": NEIGHBOUR_M,
                         "intersection_snap_m": INTERSECTION_SNAP_M},
            "signals": {}}
    for key, sig in SIGNALS.items():
        prov["signals"][key] = {
            "label": sig["label"], "short": sig["short"], "dataset_id": sig["dataset"],
            "dataset_name": DATASET_NAME[sig["dataset"]], "filter": sig["where"],
            "verbatim_from": sig["source"], "caveat": sig["caveat"],
            "geo": "311 point → nearest stop ≤25 m" if sig["geo_kind"] == "latlong" else "911 intersection → all stops at it",
            "query_url": query_url(sig), "stop_query_template": stop_query_template(sig),
            "stop_total_template": stop_total_template(sig),
        }
    with open(os.path.join(DATA, "provenance.json"), "w") as f:
        json.dump(prov, f, indent=1)
    print("provenance.json written")


if __name__ == "__main__":
    full = "--full" in sys.argv
    p = os.path.join(HERE, "concern_list.tsv" if full else "concern_list.public.tsv")
    if "--concern" in sys.argv:
        p = sys.argv[sys.argv.index("--concern") + 1]
    if full and not os.path.exists(p):
        raise SystemExit(f"--full asked for but {p} is missing (it is gitignored; keep it locally)")
    main(p, full)
