#!/usr/bin/env python3
"""End-to-end data sanity trace (the "is it externally TRUE?" check).

Unlike the build-invariant and JS==Python parity checks (which prove the system is internally
CONSISTENT), this proves it is externally TRUE: it re-derives a headline number straight from the
source — by running the dashboard's OWN declared query (provenance.query_url, the same "query ↗"
link the methodology shows users) — and reconciles it against the baked aggregates.json, then
(optionally, via Playwright) against the rendered number.

    Socrata (live)  ──①──▶  aggregates.json  ──②──▶  rendered UI number
       query_url               this script              e2e (separate)

A mismatch localizes the broken hop:
  ① live ≠ data file → build bug (filter drift, dedup, date field, settling)
  ② data file ≠ UI   → frontend bug (wrong series/index/format)   [checked in Playwright, not here]

Scope (deliberately small — a tracer/canary, not an audit):
  • CITYWIDE totals only (point signals get their district from a local spatial join the source
    can't replicate; citywide needs no join and still catches filter/dedup/date bugs).
  • SETTLED months only — skip the partial current month; creation-stamped signals (CFS/311) are
    compared exact, approval-lagged signals (arrests) get a tolerance and stop at latest_settled.

Usage:  python3 validation/trace.py drug cfs_drug
        python3 validation/trace.py drug                 # all signals that carry a query_url
Exit 0 = reconciled within tolerance, 1 = mismatch, 2 = couldn't run (network/contract gap).
"""
import json
import os
import ssl
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# Creation-stamped signals are exact; approval-lagged (arrest) signals drift as reports settle.
TOLERANCE_PCT = {"presence": 0.0, "enforcement": 0.03}
RECENT_TAIL_TOLERANCE = 0.02   # even creation-stamped months can gain a few late rows after the bake


def fetch_json(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "intervention-eval-trace/1.0"})
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return json.load(r)
    except (urllib.error.URLError, ssl.SSLError):
        # Some envs lack a usable cert store for urllib (macOS system Python); fall back to the
        # system curl, which uses the OS trust store. CI should prefer a proper cert bundle.
        out = subprocess.run(["curl", "-sS", "--max-time", str(timeout), url],
                             capture_output=True, text=True, timeout=timeout + 10)
        if out.returncode != 0:
            raise RuntimeError(f"curl fallback failed: {out.stderr.strip()[:200]}")
        return json.loads(out.stdout)


def live_monthly(query_url):
    """Run the dashboard's declared query; return {YYYY-MM: count}. The select aliases vary
    (month/reports, ym/n, …) so we read positionally: first col = month, last numeric col = count."""
    rows = fetch_json(query_url)
    out = {}
    for r in rows:
        keys = list(r.keys())
        ym = str(r[keys[0]])[:7]
        out[ym] = int(float(r[keys[-1]]))
    return out


def trace_signal(dash, key, agg, prov):
    sig_prov = prov["signals"].get(key)
    if not sig_prov or not sig_prov.get("query_url"):
        return ("skip", f"{key}: no query_url in provenance (contract gap)")
    series = agg["signals"][key]["series"].get("Citywide")
    if series is None:
        return ("skip", f"{key}: no Citywide series")

    months = agg["months"]
    settles = agg["signals"][key].get("settles") or sig_prov.get("axis") == "enforcement"
    ceiling = agg["latest_settled_month"] if settles else agg["latest_complete_month"]
    tol = TOLERANCE_PCT.get(sig_prov.get("axis"), 0.0)

    try:
        live = live_monthly(sig_prov["query_url"])
    except Exception as e:
        return ("error", f"{key}: query failed — {e}")

    rows, worst = [], 0.0
    for i, m in enumerate(months):
        if m > ceiling:
            continue                       # skip partial / unsettled tail
        if m not in live:
            continue
        baked, src = series[i], live[m]
        diff = src - baked
        pct = abs(diff) / src if src else (0.0 if baked == 0 else 1.0)
        # historic months should be exact; allow a hair on the most-recent settled month
        eff_tol = max(tol, RECENT_TAIL_TOLERANCE if i >= len(months) - 4 else 0.0)
        ok = pct <= eff_tol
        worst = max(worst, pct)
        if not ok:
            rows.append(f"    {m}: baked {baked} vs source {src}  (Δ {diff:+d}, {pct*100:.1f}%)")

    n = sum(1 for m in months if m <= ceiling and m in live)
    if rows:
        return ("fail", f"{key}: {len(rows)}/{n} settled months diverge (worst {worst*100:.1f}%) "
                        f"[dataset {sig_prov['dataset_id']}, ≤{ceiling}]\n" + "\n".join(rows))
    return ("ok", f"{key}: {n} settled months reconcile (worst Δ {worst*100:.2f}%) "
                  f"[dataset {sig_prov['dataset_id']}, ≤{ceiling}]")


def main():
    if len(sys.argv) < 2:
        print("usage: trace.py <dashboard> [signal]"); sys.exit(2)
    dash = sys.argv[1]
    agg = json.load(open(os.path.join(ROOT, dash, "data", "aggregates.json")))
    prov = json.load(open(os.path.join(ROOT, dash, "data", "provenance.json")))
    keys = [sys.argv[2]] if len(sys.argv) > 2 else list(prov["signals"].keys())

    print(f"── E2E source↔data trace · {dash} · baked {agg['generated']} ──")
    statuses = []
    for k in keys:
        status, msg = trace_signal(dash, k, agg, prov)
        mark = {"ok": "✓", "fail": "✗", "error": "⚠", "skip": "·"}[status]
        print(f"  {mark} {msg}")
        statuses.append(status)
    if "fail" in statuses:
        sys.exit(1)
    if "error" in statuses:
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
