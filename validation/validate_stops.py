#!/usr/bin/env python3
"""Build invariants + filter parity for the stops tool (stops/plan.md §10).

  python3 validation/validate_stops.py
Exit 0 = all checks hold, 1 = violations (each printed).

Parity: the encampment / 911-presence / 911-drug filters in stops/build/signals.py must be byte-identical
to the registries they were copied from (unhoused/, drug/) — a count on the stop card must equal the same
count on those dashboards (plan D3).
"""
import importlib.util
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SF_BBOX = (37.70, 37.84, -122.52, -122.35)


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, os.path.dirname(path))
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.path.pop(0)
    return mod


def data(*parts):
    return json.load(open(os.path.join(ROOT, "stops", "data", *parts)))


def main():
    errs = []
    stops_sig = load_module(os.path.join(ROOT, "stops", "build", "signals.py"), "stops_signals")
    unh = load_module(os.path.join(ROOT, "unhoused", "build", "signals.py"), "unhoused_signals")
    drug = load_module(os.path.join(ROOT, "drug", "build", "signals.py"), "drug_signals")

    # ── parity (D3) ──
    if stops_sig.SIGNALS["encampment"]["where"] != unh.SIGNALS["encampment"]["where"]:
        errs.append("parity: stops.encampment filter != unhoused.encampment filter")
    sitlie = unh.SIGNALS["cfs_sitlie"]["where"]
    homeless = unh.SIGNALS["cfs_homeless"]["where"]
    gate = re.search(r"AND (onview_flag.*)$", sitlie).group(1)
    expect = f"call_type_final_desc IN ('SIT/LIE ENFORCEMENT','HOMELESS COMPLAINT') AND {gate}"
    if stops_sig.SIGNALS["cfs_presence"]["where"] != expect:
        errs.append("parity: stops.cfs_presence filter != unhoused sit/lie + homeless union")
    if re.search(r"AND (onview_flag.*)$", homeless).group(1) != gate:
        errs.append("parity: unhoused sit/lie and homeless gates differ (registry drift)")
    if stops_sig.SIGNALS["cfs_drug"]["where"] != drug.SIGNALS["cfs_drug"]["where"]:
        errs.append("parity: stops.cfs_drug filter != drug.cfs_drug filter")
    if stops_sig.HISTORY_START[:10] != unh.HISTORY_START[:10]:
        errs.append(f"epoch: stops HISTORY_START {stops_sig.HISTORY_START} != unhoused {unh.HISTORY_START}")

    # ── structure ──
    S = data("stops.json")
    months = S["months"]
    for a, b in zip(months, months[1:]):
        ay, am = int(a[:4]), int(a[5:7])
        if (int(b[:4]), int(b[5:7])) != ((ay + 1, 1) if am == 12 else (ay, am + 1)):
            errs.append(f"months not contiguous at {a}→{b}")
    if S["latest_complete_month"] not in months or S["current_partial_month"] != months[-1]:
        errs.append("latest_complete/current_partial month not aligned with axis")
    ids = set()
    for s in S["stops"]:
        ids.add(s["id"])
        if not (SF_BBOX[0] <= s["lat"] <= SF_BBOX[1] and SF_BBOX[2] <= s["lng"] <= SF_BBOX[3]):
            errs.append(f"stop {s['id']} outside SF bbox")
        for nb in s["neighbours"]:
            if nb == s["id"]:
                errs.append(f"stop {s['id']} is its own neighbour")
        for k, v in s["t12"].items():
            if v is not None and v < 0:
                errs.append(f"stop {s['id']} negative t12 {k}")
    if len(ids) != len(S["stops"]):
        errs.append("duplicate stop ids")
    n_shelter = sum(1 for s in S["stops"] if s["shelter"])
    if not 800 <= n_shelter <= 1200:
        errs.append(f"sheltered count {n_shelter} outside expected 800–1200 (snapshot drift?)")
    no_gtfs = [s["id"] for s in S["stops"] if not s["in_gtfs"]]
    if len(no_gtfs) > 0.05 * len(S["stops"]):
        errs.append(f"{len(no_gtfs)} stops not in GTFS (>5%) — feed/snapshot mismatch")

    # series shards cover every stop, right length, non-negative
    sdir = os.path.join(ROOT, "stops", "data", "series")
    covered = set()
    by_id = {s["id"]: s for s in S["stops"]}
    for fn in os.listdir(sdir):
        for sid, ser in json.load(open(os.path.join(sdir, fn))).items():
            covered.add(sid)
            for key in S["signals"]:
                for part in ("stop", "ring"):
                    v = ser[key][part]
                    if v is None:
                        errs.append(f"stop {sid} {key}.{part} is null")
                        continue
                    if len(v) != len(months):
                        errs.append(f"stop {sid} {key}.{part} length {len(v)} != {len(months)}")
                    if any(x < 0 for x in v):
                        errs.append(f"stop {sid} {key}.{part} negative")
    if covered != ids:
        errs.append(f"series shards cover {len(covered)} stops, stops.json has {len(ids)}")

    # D6 sanity: far-side stops on Market must not all be zero on 911 now that we join by intersection
    probe = [by_id[i] for i in ("5683", "5676") if i in by_id]
    for s in probe:
        if s["intersection"] is None:
            errs.append(f"D6: {s['name']} ({s['id']}) has no parent intersection")

    # overlay
    C = data("concern.json")
    for r in C["rows"]:
        if r["matched"] and r["id"] not in ids:
            errs.append(f"concern row {r['code']} marked matched but stop {r['id']} missing")
        if C.get("detail") and r["matched"] and not r.get("basis_types"):
            errs.append(f"concern row {r['code']} has no basis type")
        if not C.get("detail") and any(k in r for k in ("basis", "basis_types", "removal_requested", "missed_servicing_rank", "precinct")):
            errs.append(f"concern row {r['code']} carries list details but concern.json is marked public (D15)")
    P = data("provenance.json")
    for key in S["signals"]:
        if key not in P["signals"] or "query_url" not in P["signals"][key]:
            errs.append(f"provenance missing {key}")

    for e in errs:
        print("✗", e)
    print("stops: OK" if not errs else f"stops: {len(errs)} violation(s)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
