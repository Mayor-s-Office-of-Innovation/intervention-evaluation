"""Build the Northern merchant-theft dashboard data.

Fetches pre-aggregated monthly counts from SFPD Incident Reports (wg3w-h783) via SoQL
(date_trunc_ym + count, grouped by resolution) — no raw-row paging, no point-in-polygon
(native police_district field; ../plan.md §4). Emits:

  theft/data/aggregates.json   — months axis + per-signal {reported, arrests, online} series
                                  for Northern, plus a citywide `reported` baseline.
  theft/data/provenance.json   — dataset id, exact filters, the excluded category, row counts.

Seasonal KPIs (trailing-12mo, YoY) are derived in the frontend (rollup.js) from these series.
Run:  python3 build/build.py
"""
import datetime
import json
import os
import urllib.parse

from httpget import get_json
from signals import (SIGNALS, EXCLUDED, DATASET, DOMAIN, DISTRICT, DATE_COL,
                     HISTORY_START, RES_REPORTED, RES_ARREST)

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
TODAY = datetime.date.today()

# Reports appear only after supervisor approval, so the latest calendar months under-report
# (../plan.md §5.4). The headline uses the latest *settled* month: this many complete months back.
SETTLE_LAG_MONTHS = 2


def query_url(soql_query):
    """A runnable Socrata JSON link for the exact query (for dashboard footnotes)."""
    return f"https://{DOMAIN}/resource/{DATASET}.json?" + urllib.parse.urlencode({"$query": soql_query})


# All merchant-theft subcategories together — used to measure the reporting lag.
MERCHANT_WHERE = ("incident_subcategory in('Larceny Theft - Shoplifting',"
                  "'Burglary - Commercial','Robbery - Commercial')")


def first_of_month(months_back):
    total = TODAY.year * 12 + (TODAY.month - 1) - months_back
    return datetime.date(total // 12, total % 12 + 1, 1)


def reporting_lag():
    """Measure incident→report-filed lag over a fully-settled 12-mo window (ended ≥12mo ago),
    so the dashboard can show why recent months are incomplete with real, current numbers."""
    lo, hi = first_of_month(24), first_of_month(12)
    where = (f"({MERCHANT_WHERE}) AND police_district='{DISTRICT}' "
             f"AND {DATE_COL} >= '{lo}' AND {DATE_COL} < '{hi}'")
    rows = soql(select="incident_date, report_datetime", where=where)
    lags = []
    for r in rows:
        if r.get("incident_date") and r.get("report_datetime"):
            d = (datetime.date.fromisoformat(r["report_datetime"][:10])
                 - datetime.date.fromisoformat(r["incident_date"][:10])).days
            if d >= 0:
                lags.append(d)
    lags.sort()
    n = len(lags)
    pctile = lambda p: lags[min(n - 1, int(p / 100 * n))] if n else None
    within = lambda d: round(sum(1 for x in lags if x <= d) / n * 100) if n else None
    return {
        "ref_window": f"{lo:%b %Y}–{first_of_month(13):%b %Y}",
        "n": n,
        "median_days": pctile(50),
        "within_7_pct": within(7),
        "within_30_pct": within(30),
        "within_60_pct": within(60),
        "p90_days": pctile(90),
    }


def soql(select, where, group=None, order=None):
    params = {"$select": select, "$where": where, "$limit": "50000"}
    if group:
        params["$group"] = group
    if order:
        params["$order"] = order
    url = f"https://{DOMAIN}/resource/{DATASET}.json?" + urllib.parse.urlencode(params)
    return get_json(url)


def month_axis(start_ym, end_ym):
    sy, sm = int(start_ym[:4]), int(start_ym[5:7])
    ey, em = int(end_ym[:4]), int(end_ym[5:7])
    months, y, m = [], sy, sm
    while (y, m) <= (ey, em):
        months.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            m, y = 1, y + 1
    return months


def monthly_by_resolution(where):
    """{ym: {resolution: n}} for incidents matching `where` in the target district."""
    full = f"({where}) AND police_district='{DISTRICT}' AND {DATE_COL} >= '{HISTORY_START}'"
    rows = soql(
        select=f"date_trunc_ym({DATE_COL}) AS ym, resolution, count(*) AS n",
        where=full, group="ym, resolution", order="ym",
    )
    out = {}
    for r in rows:
        ym = r["ym"][:7]
        out.setdefault(ym, {})[r.get("resolution", "")] = int(r["n"])
    return out


def monthly_count(where, extra=""):
    """{ym: n} for incidents matching `where` (+ optional extra clause) in the district."""
    full = f"({where}) AND police_district='{DISTRICT}' AND {DATE_COL} >= '{HISTORY_START}'"
    if extra:
        full += f" AND {extra}"
    rows = soql(
        select=f"date_trunc_ym({DATE_COL}) AS ym, count(*) AS n",
        where=full, group="ym", order="ym",
    )
    return {r["ym"][:7]: int(r["n"]) for r in rows}


def monthly_count_citywide(where):
    full = f"({where}) AND resolution='{RES_REPORTED}' AND {DATE_COL} >= '{HISTORY_START}'"
    rows = soql(
        select=f"date_trunc_ym({DATE_COL}) AS ym, count(*) AS n",
        where=full, group="ym", order="ym",
    )
    return {r["ym"][:7]: int(r["n"]) for r in rows}


def series(months, lookup):
    return [lookup.get(mo, 0) for mo in months]


if __name__ == "__main__":
    cur_ym = f"{TODAY.year:04d}-{TODAY.month:02d}"
    months = month_axis(HISTORY_START[:7], cur_ym)
    latest_complete = months[-2]                     # current month is partial
    latest_settled = months[-2 - SETTLE_LAG_MONTHS]  # + recent months still under-reporting

    def signal_query(where):
        return (f"SELECT date_trunc_ym({DATE_COL}) AS month, resolution, count(*) AS n "
                f"WHERE ({where}) AND police_district='{DISTRICT}' AND {DATE_COL} >= '{HISTORY_START}' "
                f"GROUP BY month, resolution ORDER BY month")

    agg = {
        "generated": TODAY.isoformat(),
        "dataset": DATASET,
        "district": DISTRICT,
        "months": months,
        "latest_complete_month": latest_complete,
        "latest_settled_month": latest_settled,
        "settle_lag_months": SETTLE_LAG_MONTHS,
        "current_partial_month": cur_ym,
        "settling": reporting_lag(),
        "signals": {},
        "excluded": [{"code": e["code"], "reason": e["reason"]} for e in EXCLUDED],
    }
    print(f"reporting lag (settled ref {agg['settling']['ref_window']}, n={agg['settling']['n']}): "
          f"median {agg['settling']['median_days']}d · {agg['settling']['within_30_pct']}% ≤30d · "
          f"p90 {agg['settling']['p90_days']}d")
    provenance = {
        "generated": TODAY.isoformat(),
        "dataset": DATASET, "domain": DOMAIN, "district": DISTRICT,
        "dataset_url": f"https://{DOMAIN}/d/{DATASET}",
        "history_start": HISTORY_START,
        "latest_settled_month": latest_settled,
        "settle_note": (f"Headline uses the latest settled month ({latest_settled}); the {SETTLE_LAG_MONTHS} "
                        "most recent complete months are still accruing late-approved reports and are "
                        "shown shaded on the charts."),
        "axes": {
            "reported": {"where": f"resolution = '{RES_REPORTED}'",
                         "why": "Incidents resolved 'Open or Active' are reports filed by a victim/merchant "
                                "with no on-scene arrest — a measure of theft businesses actually experience "
                                "and report. This is the success metric (we want it down) and it is robust to "
                                "enforcement levels because it excludes arrests."},
            "arrests": {"where": f"resolution = '{RES_ARREST}'",
                        "why": "Incidents resolved 'Cite or Arrest Adult' are enforcement actions. Shown as "
                               "context, not a success target: more arrests can help when theft is high, but "
                               "if deterrence works arrests should fall alongside reports."},
        },
        "signals": {}, "excluded": [],
    }

    for key, sig in SIGNALS.items():
        print(f"Building '{key}' …")
        by_res = monthly_by_resolution(sig["where"])
        reported = series(months, {ym: d.get(RES_REPORTED, 0) for ym, d in by_res.items()})
        arrests = series(months, {ym: d.get(RES_ARREST, 0) for ym, d in by_res.items()})
        online = series(months, monthly_count(sig["where"], "filed_online = true"))
        city_reported = series(months, monthly_count_citywide(sig["where"]))

        node = {
            "label": sig["label"], "desc": sig["desc"],
            "northern": {"reported": reported, "arrests": arrests, "online": online},
            "citywide": {"reported": city_reported},
        }
        # commercial: keep the burglary/robbery split so it can decompose on demand (../plan.md D1)
        if "components" in sig:
            node["components"] = {
                name: series(months, monthly_count(w)) for name, w in sig["components"].items()
            }
        agg["signals"][key] = node

        provenance["signals"][key] = {
            "label": sig["label"], "why": sig["why"], "filter": sig["where"],
            "query_url": query_url(signal_query(sig["where"])),
            "northern_reported_total": sum(reported),
            "northern_arrests_total": sum(arrests),
        }
        print(f"  reported={sum(reported):,}  arrests={sum(arrests):,}  online={sum(online):,}")

    for e in EXCLUDED:
        eq = (f"SELECT incident_year, count(*) AS n WHERE ({e['where']}) "
              f"AND police_district='{DISTRICT}' GROUP BY incident_year ORDER BY incident_year")
        provenance["excluded"].append({**e, "query_url": query_url(eq)})

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "aggregates.json"), "w") as f:
        json.dump(agg, f, separators=(",", ":"))
    with open(os.path.join(DATA, "provenance.json"), "w") as f:
        json.dump(provenance, f, indent=2)

    size = os.path.getsize(os.path.join(DATA, "aggregates.json"))
    print(f"\naggregates.json: {size/1024:.1f} KB · months {months[0]}…{months[-1]} "
          f"(latest complete {latest_complete})")
