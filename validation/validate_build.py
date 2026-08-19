#!/usr/bin/env python3
"""V1 + V3 · build-output invariants. Turns silent bad data into a failed check: runs after the build
(or in CI) over a dashboard's pre-baked JSON and asserts the structural guarantees the frontend relies
on. Catches negative/None counts, length mismatches, citywide/district reconciliation, a non-contiguous
month axis, and the transitions↔aggregates axis-alignment landmine (V3) the client tide read depends on.

    python3 validation/validate_build.py drug
    python3 validation/validate_build.py            # all dashboards with a data/aggregates.json
Exit 0 = all invariants hold, 1 = one or more violations (each printed).
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Generous SF bounding box — cell/marker coords must fall inside it.
SF_BBOX = (37.70, 37.84, -122.52, -122.35)   # lat_min, lat_max, lng_min, lng_max
CATS = {"persistent", "cooled", "emerged", None}


def load(dash, *parts):
    return json.load(open(os.path.join(ROOT, dash, "data", *parts)))


_JS_DISTRICTS = None
def js_districts():
    """Parse the canonical DISTRICTS array out of shared/districts.js so the baked
    aggregates can't silently drift from the single source of truth the frontend uses."""
    global _JS_DISTRICTS
    if _JS_DISTRICTS is None:
        src = open(os.path.join(ROOT, "shared", "districts.js")).read()
        m = re.search(r"export\s+const\s+DISTRICTS\s*=\s*\[(.*?)\]", src, re.DOTALL)
        _JS_DISTRICTS = set(re.findall(r"['\"]([^'\"]+)['\"]", m.group(1))) if m else set()
    return _JS_DISTRICTS


def month_seq_ok(months):
    """Contiguous, monotonic YYYY-MM with no gaps."""
    if not all(re.fullmatch(r"\d{4}-\d{2}", m) for m in months):
        return False
    for a, b in zip(months, months[1:]):
        ay, am = int(a[:4]), int(a[5:7])
        nxt = (ay + 1, 1) if am == 12 else (ay, am + 1)
        if (int(b[:4]), int(b[5:7])) != nxt:
            return False
    return True


def week_seq_ok(weeks):
    """Contiguous Monday-start YYYY-MM-DD axis: each entry a valid date, consecutive 7 days apart."""
    import datetime
    if not all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", w) for w in weeks):
        return False
    try:
        ds = [datetime.date.fromisoformat(w) for w in weeks]
    except ValueError:
        return False
    return all((b - a).days == 7 for a, b in zip(ds, ds[1:]))


def check_aggregates(dash, errs):
    agg = load(dash, "aggregates.json")
    months = agg["months"]
    n = len(months)
    if not month_seq_ok(months):
        errs.append(f"{dash}: aggregates.months is not a contiguous YYYY-MM sequence")
    for key in ("latest_complete_month", "current_partial_month", "latest_settled_month"):
        if key in agg and agg[key] not in months:
            errs.append(f"{dash}: aggregates.{key}={agg[key]} not in months")

    # Weekly axis (homepage 2wk YoY chip) — present only on dashboards that baked series_weekly.
    weeks = agg.get("weeks")
    nw = len(weeks) if weeks else 0
    if weeks is not None:
        if not week_seq_ok(weeks):
            errs.append(f"{dash}: aggregates.weeks is not a contiguous Monday-start YYYY-MM-DD sequence")
        for key in ("latest_complete_week", "current_partial_week", "latest_settled_week"):
            if agg.get(key) is not None and agg[key] not in weeks:
                errs.append(f"{dash}: aggregates.{key}={agg[key]} not in weeks")

    target = set(agg.get("districts", []))
    # The baked district list must match shared/districts.js (the frontend's single source of truth),
    # or a district pill would route to a dashboard with no data for it (or vice-versa).
    if target and target != js_districts():
        errs.append(f"{dash}: aggregates.districts {sorted(target)} != shared/districts.js "
                    f"{sorted(js_districts())}")
    for sk, sig in agg.get("signals", {}).items():
        if not isinstance(sig, dict) or "series" not in sig:
            continue   # non-standard aggregate schema (e.g. the hypothesis/okr-map tools) — out of scope
        series = sig["series"]
        for dist, val in series.items():
            if dist == "citywide":
                continue
            # Handle both flat arrays and nested {reported: [...], arrests: [...]} structures
            if isinstance(val, dict):
                arrays_to_check = [(k, v) for k, v in val.items() if isinstance(v, list)]
            else:
                arrays_to_check = [(None, val)]
            for subkey, arr in arrays_to_check:
                label = f"{dist}.{subkey}" if subkey else dist
                if len(arr) != n:
                    errs.append(f"{dash}/{sk}: series[{label}] length {len(arr)} != months {n}")
                if any((v is None or not isinstance(v, (int, float)) or v < 0) for v in arr):
                    errs.append(f"{dash}/{sk}: series[{label}] has a negative/None/non-numeric value")
        # citywide counts ALL districts, so it must be ≥ the sum of the target-district series each month
        if "Citywide" in series and target and not sig.get("citywide_only"):
            cw = series["Citywide"]
            for i in range(n):
                dsum = sum(series[d][i] for d in target if d in series)
                if cw[i] + 1e-9 < dsum:
                    errs.append(f"{dash}/{sk}: citywide {cw[i]} < sum(target districts) {dsum} at {months[i]}")
                    break

        # Weekly series (homepage 2wk chip) — same shape guards as the monthly series, keyed on weeks[].
        # Without this the sibling would be silently unvalidated (like series_tod).
        sw = sig.get("series_weekly")
        if sw:
            for dist, val in sw.items():
                if isinstance(val, dict):   # theft: {reported:[...]} (reported-only)
                    warrays = [(k, v) for k, v in val.items() if isinstance(v, list)]
                else:
                    warrays = [(None, val)]
                for subkey, arr in warrays:
                    label = f"{dist}.{subkey}" if subkey else dist
                    if len(arr) != nw:
                        errs.append(f"{dash}/{sk}: series_weekly[{label}] length {len(arr)} != weeks {nw}")
                    if any((v is None or not isinstance(v, (int, float)) or v < 0) for v in arr):
                        errs.append(f"{dash}/{sk}: series_weekly[{label}] has a negative/None/non-numeric value")
            # Citywide≥sum per week only when a flat Citywide exists (skips theft's reported-only district shape)
            if "Citywide" in sw and isinstance(sw["Citywide"], list) and target and not sig.get("citywide_only"):
                cw = sw["Citywide"]
                for i in range(nw):
                    dsum = sum(sw[d][i] for d in target if d in sw and isinstance(sw[d], list))
                    if cw[i] + 1e-9 < dsum:
                        errs.append(f"{dash}/{sk}: weekly citywide {cw[i]} < sum(target districts) {dsum} at {weeks[i]}")
                        break
    return agg


def check_transitions(dash, agg, errs):
    meta_path = os.path.join(ROOT, dash, "data", "transitions", "_meta.json")
    if not os.path.exists(meta_path):
        return   # not every dashboard has a map (e.g. theft)
    meta = load(dash, "transitions", "_meta.json")
    tmonths = meta["months"]
    if not month_seq_ok(tmonths):
        errs.append(f"{dash}: transitions months not contiguous")
    # V3 — axis alignment: every transitions month must exist in aggregates.months (same start, same order),
    # else the client tide read (which maps a window YM→aggregates index) silently mis-indexes.
    aset = set(agg["months"])
    if not all(m in aset for m in tmonths):
        errs.append(f"{dash}: transitions months not a subset of aggregates months (axis misalignment)")
    if agg["months"][:len(tmonths)] != tmonths:
        errs.append(f"{dash}: transitions months are not a prefix of aggregates months")

    labels = set(agg.get("districts", []))
    for sk, sm in meta["signals"].items():
        dm = sm.get("district_monthly")
        if not dm:
            errs.append(f"{dash}/{sk}: meta missing district_monthly")
        else:
            for d, arr in dm.items():
                if len(arr) != len(tmonths):
                    errs.append(f"{dash}/{sk}: district_monthly[{d}] length {len(arr)} != transitions months {len(tmonths)}")
        cells = load(dash, "transitions", f"{sk}.json")
        for c in cells:
            if len(c["monthly"]) != len(tmonths):
                errs.append(f"{dash}/{sk}: a cell's monthly length {len(c['monthly'])} != {len(tmonths)}"); break
            if sum(c["monthly"]) > c["total"]:
                errs.append(f"{dash}/{sk}: cell sum(monthly) {sum(c['monthly'])} > total {c['total']}"); break
            if c["category"] not in CATS:
                errs.append(f"{dash}/{sk}: bad category {c['category']}"); break
            if labels and c["district"] not in labels:
                errs.append(f"{dash}/{sk}: cell district {c['district']} not a known district"); break
            la, lo = c["lat"], c["lng"]
            if not (SF_BBOX[0] <= la <= SF_BBOX[1] and SF_BBOX[2] <= lo <= SF_BBOX[3]):
                errs.append(f"{dash}/{sk}: cell coord ({la},{lo}) outside SF bbox"); break


def check_provenance(dash, errs):
    path = os.path.join(ROOT, dash, "data", "provenance.json")
    if not os.path.exists(path):
        return
    prov = load(dash, "provenance.json")
    for sk, p in prov.get("signals", {}).items():
        if p.get("records", 1) <= 0:
            errs.append(f"{dash}/{sk}: provenance records == 0")


def validate(dash):
    errs = []
    agg = check_aggregates(dash, errs)
    check_transitions(dash, agg, errs)
    check_provenance(dash, errs)
    if errs:
        print(f"✗ {dash}: {len(errs)} violation(s)")
        for e in errs:
            print("   " + e)
        return False
    nsig = len(agg["signals"])
    print(f"✓ {dash}: {len(agg['months'])} months, {nsig} signals — all invariants hold")
    return True


def main():
    if len(sys.argv) > 1:
        dashes = sys.argv[1:]
    else:
        dashes = [d for d in os.listdir(ROOT)
                  if os.path.exists(os.path.join(ROOT, d, "data", "aggregates.json"))]
    ok = all(validate(d) for d in sorted(dashes))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
