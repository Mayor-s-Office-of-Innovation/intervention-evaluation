"""Print a Markdown before→after headline-delta summary for the weekly data-refresh PR.

Compares the working-tree `*/data/aggregates.json` (freshly rebuilt) against the committed
version (`git show HEAD:<path>`) and emits a per-dashboard table of citywide headline values at
the latest settled month and the month before it — the "did late reports settle in / did anything
cliff?" sanity check a human skims before merging (see docs/plan-data-refresh-automation.md).

Stdlib only. **Always exits 0**: this runs *after* the validation gates, so a hiccup here must
never suppress the PR — any failure is reported inline in the Markdown instead of failing the step.

Usage:  python3 validation/refresh_delta.py   # writes Markdown to stdout
"""
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Dashboards to summarize, in homepage order. Path is relative to the repo root.
DASHBOARDS = [
    ("Drug", "drug/data/aggregates.json"),
    ("Unhoused", "unhoused/data/aggregates.json"),
    ("Theft", "theft/data/aggregates.json"),
]

# Flag any single-month citywide swing larger than this (old→new) as a possible cliff.
CLIFF_THRESHOLD = 0.40


def load_new(rel):
    with open(os.path.join(REPO, rel)) as f:
        return json.load(f)


def load_old(rel):
    """The committed version, or None if the file is new / unreadable at HEAD."""
    try:
        raw = subprocess.run(
            ["git", "show", f"HEAD:{rel}"],
            cwd=REPO, capture_output=True, text=True, check=True,
        ).stdout
        return json.loads(raw)
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return None


def anchor_month(agg):
    """The month the headline evaluates: latest settled if the dashboard settles, else latest complete."""
    return agg.get("latest_settled_month") or agg.get("latest_complete_month")


def citywide_at(agg, sig_key, month):
    """Sum a signal's district series at `month`. Theft series are {reported, arrests} — use reported
    (the headline axis; arrests are context). Returns None if the month/series isn't present."""
    months = agg.get("months") or []
    if month not in months:
        return None
    i = months.index(month)
    series = agg.get("signals", {}).get(sig_key, {}).get("series", {})
    total, seen = 0, False
    for val in series.values():
        arr = val.get("reported") if isinstance(val, dict) else val
        if isinstance(arr, list) and i < len(arr) and isinstance(arr[i], (int, float)):
            total += arr[i]
            seen = True
    return total if seen else None


def fmt_cell(old, new):
    """old→new with % change and a ⚠️ on a big swing."""
    if new is None and old is None:
        return "—"
    if old is None:
        return f"— → **{new}** (new)"
    if new is None:
        return f"{old} → — (gone)"
    if old == 0:
        arrow = "" if new == 0 else " ⚠️" if new else ""
        return f"{old} → **{new}** (new activity){arrow}" if new else f"{old} → {new}"
    pct = (new - old) / old
    flag = " ⚠️" if abs(pct) > CLIFF_THRESHOLD else ""
    return f"{old} → **{new}** ({pct:+.0%}){flag}"


def prev_month(agg, month):
    months = agg.get("months") or []
    if month in months:
        i = months.index(month)
        if i > 0:
            return months[i - 1]
    return None


def dashboard_section(name, rel):
    out = [f"### {name}"]
    new = load_new(rel)
    old = load_old(rel)

    gen_new = new.get("generated", "?")
    gen_old = old.get("generated", "?") if old else "—"
    anc_new = anchor_month(new)
    anc_old = anchor_month(old) if old else None
    out.append(f"- `generated`: {gen_old} → **{gen_new}**")
    out.append(f"- headline month: {anc_old or '—'} → **{anc_new or '?'}**")

    if old is None:
        out.append("\n_(no committed version at HEAD — first build; all values are new.)_")
        return "\n".join(out)

    # Anchor on the NEW latest-settled month + the one before it. Both exist in the new axis;
    # the earlier month also existed last week, so its old→new move is the "settle fill-in" check.
    months_to_show = [m for m in (prev_month(new, anc_new), anc_new) if m]
    if not months_to_show:
        out.append("\n_(could not resolve headline months.)_")
        return "\n".join(out)

    sig_keys = list(new.get("signals", {}).keys())
    header = "| Signal | " + " | ".join(months_to_show) + " |"
    rule = "|" + "---|" * (len(months_to_show) + 1)
    out += ["", header, rule]
    for k in sig_keys:
        label = new["signals"][k].get("label", k)
        cells = []
        for m in months_to_show:
            cells.append(fmt_cell(citywide_at(old, k, m), citywide_at(new, k, m)))
        out.append(f"| {label} | " + " | ".join(cells) + " |")
    return "\n".join(out)


def stops_section():
    """Stops tool: concern-list totals per signal over the trailing-12-month window, committed → rebuilt,
    plus coverage counts. Reads stops/data/{stops,concern,provenance,mapillary}.json."""
    out = ["### Muni stops & shelters"]
    new_s, new_c, new_p = load_new("stops/data/stops.json"), load_new("stops/data/concern.json"), load_new("stops/data/provenance.json")
    old_s, old_c = load_old("stops/data/stops.json"), load_old("stops/data/concern.json")
    out.append(f"- `generated`: {(old_s or {}).get('generated', '—')} → **{new_s.get('generated', '?')}**")
    out.append(f"- data through: {(old_s or {}).get('latest_complete_month', '—')} → **{new_s.get('latest_complete_month', '?')}** · "
               f"routes (GTFS) as of **{new_s.get('gtfs_as_of') or 'n/a'}** · shelter flag as of **{new_p.get('stops_dataset', {}).get('shelter_as_of') or 'n/a'}**")
    n_sh = sum(1 for x in new_s["stops"] if x.get("shelter"))
    o_sh = sum(1 for x in old_s["stops"] if x.get("shelter")) if old_s else None
    out.append(f"- stops: {len(old_s['stops']) if old_s else '—'} → **{len(new_s['stops'])}** · sheltered: {o_sh if o_sh is not None else '—'} → **{n_sh}**")
    try:
        m = load_new("stops/data/mapillary.json")["stops"]
        out.append(f"- Mapillary images: **{sum(1 for v in m.values() if v)}** of {len(m)} resolved stops")
    except Exception:
        pass
    if old_s is None:
        out.append("\n_(no committed version at HEAD — first build; all values are new.)_")
        return "\n".join(out)

    def totals(S, C):
        listed = {r["id"] for r in C["rows"] if r.get("matched")}
        by = {x["id"]: x for x in S["stops"]}
        return {k: sum((by[i]["t12"].get(k) or 0) for i in listed if i in by) for k in S["signals"]}, len(listed)
    tn, ln = totals(new_s, new_c)
    to, lo = totals(old_s, old_c) if old_c else ({}, 0)
    w = new_s.get("t12_window", ["?", "?"])
    out += ["", f"Concern list ({lo} → **{ln}** stops), reports within the trailing 12 months ({w[0]}…{w[1]}), summed over listed stops:", "",
            "| Signal | committed → rebuilt |", "|---|---|"]
    for k in new_s["signals"]:
        out.append(f"| {new_p['signals'][k]['label']} | {fmt_cell(to.get(k), tn.get(k))} |")
    return "\n".join(out)


def main():
    parts = [
        "## Weekly data refresh",
        "",
        "Citywide headline totals, **committed → freshly rebuilt**, at the latest settled month and the "
        "month before it. Prior-month moves are late reports settling in (expect small, upward). A ⚠️ "
        f"marks a swing over {CLIFF_THRESHOLD:.0%} — eyeball it for an upstream cliff before merging.",
        "",
    ]
    for name, rel in DASHBOARDS:
        try:
            parts.append(dashboard_section(name, rel))
        except Exception as e:  # never fail the step — report inline
            parts.append(f"### {name}\n\n⚠️ _delta summary failed: {e!r}_")
        parts.append("")
    try:
        parts.append(stops_section())
    except Exception as e:
        parts.append(f"### Muni stops & shelters\n\n⚠️ _delta summary failed: {e!r}_")
    parts.append("")
    parts.append("---\n_Diff should be limited to `*/data/**` (incl. `stops/data/**`). Merge to deploy; a ⚠️ or an unexplained "
                 "move is a reason to investigate, not merge._")
    print("\n".join(parts))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"## Weekly data refresh\n\n⚠️ _delta report crashed: {e!r}_")
    sys.exit(0)
