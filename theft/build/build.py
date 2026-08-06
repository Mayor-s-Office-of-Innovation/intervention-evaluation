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
from signals import (SIGNALS, EXCLUDED, DATASET, DOMAIN, DISTRICTS, DATE_COL,
                     HISTORY_START, RES_REPORTED, RES_ARREST)

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
TODAY = datetime.date.today()

# Reports appear only after supervisor approval, so the latest calendar months under-report
# (../plan.md §5.4). The headline uses the latest *settled* month: this many complete months back.
#
# Per-resolution settling (plan-property-crime-expansion.md Workstream F): the two axes settle at very
# different speeds, so they get different buffers. REPORTED (victim/merchant reports) settles fast —
# ~98% within a month, p90≈9 days — so the reported headline holds back only ONE complete month.
# ARREST (Cite or Arrest Adult) carries a long enforcement tail (p90≈242 days), so it stays TWO months
# back to avoid showing an under-counted recent month as final. The reported buffer is the public
# default (`settle_lag_months`); the arrests context uses its own.
REPORTED_SETTLE_LAG = 1
ARREST_SETTLE_LAG = 2

# Settle rule v2 (plan-settle-completeness.md): instead of always holding the reported headline a fixed
# REPORTED_SETTLE_LAG months back, estimate the latest complete month's completeness from the measured
# incident→report lag CDF and its age today. Evaluate it once it clears this threshold; otherwise fall
# back one more month (always ≥31 days old ⇒ always mature). The −1 months we already trust sit ~98.7%
# complete, so 0.985 means "as solid as the months we already publish." Arrests stay at −2 regardless.
SOLID_COMPLETENESS = 0.985


def query_url(soql_query):
    """A runnable Socrata JSON link for the exact query (for dashboard footnotes)."""
    return f"https://{DOMAIN}/resource/{DATASET}.json?" + urllib.parse.urlencode({"$query": soql_query})


# All merchant-theft subcategories together — used to measure the reporting lag.
MERCHANT_WHERE = ("incident_subcategory in('Larceny Theft - Shoplifting',"
                  "'Burglary - Commercial','Robbery - Commercial')")


def first_of_month(months_back):
    total = TODAY.year * 12 + (TODAY.month - 1) - months_back
    return datetime.date(total // 12, total % 12 + 1, 1)


def reporting_lag(resolution, district="Northern"):
    """Measure incident→report-filed lag for ONE resolution axis over a fully-settled 12-mo window
    (ended ≥12mo ago), so the dashboard can show why recent months are incomplete with real, current
    numbers. Splitting by resolution matters: a mixed stat is dominated by the slow arrest tail and
    over-states how long *reported* theft takes to settle (plan-property-crime-expansion.md Workstream F)."""
    lo, hi = first_of_month(24), first_of_month(12)
    where = (f"({MERCHANT_WHERE}) AND police_district='{district}' "
             f"AND resolution='{resolution}' "
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
    # Empirical CDF F(k)=P(report filed within k days of incident), k=0..CDF_MAX — the basis for the
    # month-completeness estimate (plan-settle-completeness.md). Kept in the return for the caller;
    # popped before baking (the card shows the derived missing-% scalars, not the raw curve).
    cdf = [round(sum(1 for x in lags if x <= k) / n, 6) if n else 0.0 for k in range(CDF_MAX + 1)]
    return {
        "ref_window": f"{lo:%b %Y}–{first_of_month(13):%b %Y}",
        "n": n,
        "median_days": pctile(50),
        "within_7_pct": within(7),
        "within_30_pct": within(30),
        "within_60_pct": within(60),
        "p90_days": pctile(90),
        "cdf": cdf,
        # Reader-facing verifiability: the exact raw rows (incident vs report date) these percentiles
        # are computed from — the reader can eyeball the lag themselves. The completeness % is derived
        # from this curve (no single query returns it), so we link the raw data, not a fake exact-match.
        "lag_query_url": query_url(
            f"SELECT {DATE_COL}, report_datetime "
            f"WHERE ({MERCHANT_WHERE}) AND police_district='{district}' AND resolution='{resolution}' "
            f"AND {DATE_COL} >= '{lo}' AND {DATE_COL} < '{hi}' ORDER BY {DATE_COL}"),
    }


CDF_MAX = 120  # longest incident→report lag we model (days); tail beyond this is negligible for theft


def month_last_day(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return datetime.date(y + m // 12, m % 12 + 1, 1) - datetime.timedelta(days=1)


def month_len(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return (month_last_day(ym) - datetime.date(y, m, 1)).days + 1


def month_completeness(cdf, delta, days_in_month):
    """Estimated fraction of a month's reports that have arrived `delta` days after month-end.
    An incident on day d (1..D) is (delta + (D-d)) days old today, so averaging F(delta+j) over
    j=0..D-1 gives the month's expected completeness (convolving the lag CDF over the month)."""
    last = len(cdf) - 1
    return sum(cdf[min(delta + j, last)] for j in range(days_in_month)) / days_in_month


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


# ── weekly axis (homepage 2wk YoY chip; plan-2wk-chip) — Monday-start ISO dates. Theft reports SETTLE
# (report-approval lag), so the 2wk chip anchors to `latest_settled_week`, not the calendar-latest. ──
def week_start(iso):
    d = datetime.date.fromisoformat(iso[:10])
    return (d - datetime.timedelta(days=d.weekday())).isoformat()


def week_axis(start, end):
    w = start - datetime.timedelta(days=start.weekday())
    weeks = []
    while w <= end:
        weeks.append(w.isoformat())
        w += datetime.timedelta(days=7)
    return weeks


def settled_week(weeks, latest_settled_month):
    """Last week whose week-end (start+6d) falls strictly before the month AFTER latest_settled_month —
    anchoring the fortnight settle horizon to the same month buffer the 1mo/3mo cards trust."""
    y, m = int(latest_settled_month[:4]), int(latest_settled_month[5:7])
    cutoff = datetime.date(y + 1, 1, 1) if m == 12 else datetime.date(y, m + 1, 1)
    result = None
    for w in weeks:
        if datetime.date.fromisoformat(w) + datetime.timedelta(days=6) < cutoff:
            result = w
        else:
            break
    return result


def weekly_reported(where, district):
    """{week_start_iso: n} of REPORTED incidents, bucketed to Monday weeks from daily counts.
    KR cards never show weekly arrests, so this fetches `reported` only (skips the arrests query)."""
    full = (f"({where}) AND police_district='{district}' AND resolution='{RES_REPORTED}' "
            f"AND {DATE_COL} >= '{HISTORY_START}'")
    rows = soql(
        select=f"date_trunc_ymd({DATE_COL}) AS d, count(*) AS n",
        where=full, group="d", order="d",
    )
    out = {}
    for r in rows:
        out[week_start(r["d"])] = out.get(week_start(r["d"]), 0) + int(r["n"])
    return out


def monthly_by_resolution(where, district):
    """{ym: {resolution: n}} for incidents matching `where` in the target district."""
    full = f"({where}) AND police_district='{district}' AND {DATE_COL} >= '{HISTORY_START}'"
    rows = soql(
        select=f"date_trunc_ym({DATE_COL}) AS ym, resolution, count(*) AS n",
        where=full, group="ym, resolution", order="ym",
    )
    out = {}
    for r in rows:
        ym = r["ym"][:7]
        out.setdefault(ym, {})[r.get("resolution", "")] = int(r["n"])
    return out


def monthly_count(where, district, extra=""):
    """{ym: n} for incidents matching `where` (+ optional extra clause) in the district."""
    full = f"({where}) AND police_district='{district}' AND {DATE_COL} >= '{HISTORY_START}'"
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


def vehicle_detail(sig, district):
    """Vehicle-type mix, hour-of-day, and all-time top intersections for the vehicle-theft DETAIL
    section (../plan-property-crime-expansion.md workstream B). Uses the signal's own detail window
    (2018→present) for stable percentages, NOT the 2021-onward card window."""
    d = sig["detail"]
    base = f"({sig['where']}) AND police_district='{district}' AND {DATE_COL} >= '{d['start']}'"

    # Vehicle-type mix from incident_description. Recovered/attempted rows carry no type → untyped.
    buckets = {"auto": 0, "truck": 0, "motorcycle": 0, "other": 0}
    typed = untyped = 0
    for r in soql(select="incident_description, count(*) AS n", where=base,
                  group="incident_description", order="n DESC"):
        t = d["types"].get(r.get("incident_description", ""))
        if t:
            buckets[t] += int(r["n"]); typed += int(r["n"])
        else:
            untyped += int(r["n"])

    # Hour-of-day (reported hour) → 24 buckets.
    hours = [0] * 24
    for r in soql(select="date_extract_hh(incident_datetime) AS hh, count(*) AS n", where=base,
                  group="hh", order="hh"):
        if r.get("hh") is not None:
            hours[int(r["hh"])] = int(r["n"])

    # Top intersections all-time (drop null/blank corners), keep the top 7.
    top = [{"intersection": r["intersection"], "n": int(r["n"])}
           for r in soql(select="intersection, count(*) AS n", where=base,
                         group="intersection", order="n DESC") if r.get("intersection")][:7]

    return {
        "start": d["start"],
        "type_mix": {"buckets": buckets, "typed": typed, "untyped": untyped, "total": typed + untyped},
        "hours": hours,
        "top_intersections": top,
    }


# Mayor Lurie's term began Jan 2025 — the "Since Lurie" scrubber preset anchors here (matches the
# constellation's Lurie-split convention). Kept as data so the frontend needn't hard-code a date.
LURIE_MONTH = "2025-01"


def shoplifting_map(district):
    """Per-intersection MONTHLY reported-shoplifting counts + one representative coord per corner, for the
    static concentration map (../plan-property-crime-expansion.md Workstream C). The frontend sums each
    corner over the scrubber-selected window — this bakes the monthly breakdown, not a fixed total, so the
    window is a pure client-side re-aggregation. Reported axis only (the KR). Native `intersection` +
    native lat/lng (one clean pair per corner — see ../map-hotspot-findings.md), so NO geocoding."""
    base = (f"({SIGNALS['shoplifting']['where']}) AND police_district='{district}' "
            f"AND resolution='{RES_REPORTED}' AND {DATE_COL} >= '{HISTORY_START}' "
            f"AND intersection IS NOT NULL")
    rows = soql(
        select=(f"intersection, date_trunc_ym({DATE_COL}) AS ym, count(*) AS n, "
                f"max(latitude) AS lat, max(longitude) AS lng"),
        where=base, group="intersection, ym", order="intersection, ym",
    )
    corners = {}
    for r in rows:
        name = r.get("intersection")
        if not name:
            continue
        c = corners.setdefault(name, {"i": name, "lat": None, "lng": None, "m": {}})
        c["m"][r["ym"][:7]] = int(r["n"])
        if c["lat"] is None and r.get("lat") and r.get("lng"):
            c["lat"] = round(float(r["lat"]), 5)
            c["lng"] = round(float(r["lng"]), 5)
    # Only corners we can actually place; sort by all-time volume so the ranked list is stable.
    placed = [c for c in corners.values() if c["lat"] is not None]
    placed.sort(key=lambda c: sum(c["m"].values()), reverse=True)
    return placed


def shoplifting_map_query(district):
    """Runnable Socrata link behind the concentration map (dashboard provenance / methodology)."""
    return query_url(
        f"SELECT intersection, date_trunc_ym({DATE_COL}) AS month, count(*) AS n, "
        f"max(latitude) AS lat, max(longitude) AS lng "
        f"WHERE ({SIGNALS['shoplifting']['where']}) AND police_district='{district}' "
        f"AND resolution='{RES_REPORTED}' AND {DATE_COL} >= '{HISTORY_START}' AND intersection IS NOT NULL "
        f"GROUP BY intersection, month ORDER BY intersection, month")


def vehicle_detail_queries(sig):
    """Runnable Socrata links behind the DETAIL numbers ([[dashboard-source-provenance-footnotes]])."""
    d, w = sig["detail"], sig["where"]
    base = f"({w}) AND police_district='Northern' AND {DATE_COL} >= '{d['start']}'"
    return {
        "type_mix": query_url(f"SELECT incident_description, count(*) AS n WHERE {base} "
                              "GROUP BY incident_description ORDER BY n DESC"),
        "hours": query_url(f"SELECT date_extract_hh(incident_datetime) AS hh, count(*) AS n WHERE {base} "
                           "GROUP BY hh ORDER BY hh"),
        "top_intersections": query_url(f"SELECT intersection, count(*) AS n WHERE {base} "
                                       "GROUP BY intersection ORDER BY n DESC LIMIT 7"),
    }


def series(months, lookup):
    return [lookup.get(mo, 0) for mo in months]


if __name__ == "__main__":
    cur_ym = f"{TODAY.year:04d}-{TODAY.month:02d}"
    months = month_axis(HISTORY_START[:7], cur_ym)
    latest_complete = months[-2]                       # current month is partial

    # Reporting-lag curves (reused for both the public caveat stat and the completeness estimate).
    settling = reporting_lag(RES_REPORTED)             # reported-only — feeds the public caveat
    settling_arrests = reporting_lag(RES_ARREST)       # arrest tail — justifies the −2 arrest buffer
    rep_cdf = settling.pop("cdf")                      # keep the raw curve out of the baked JSON
    settling_arrests.pop("cdf", None)

    # Settle rule v2 (plan-settle-completeness.md): estimate the latest complete month's completeness
    # from the reported lag CDF + its age today; evaluate it once it clears SOLID_COMPLETENESS, else
    # fall back one more (always-mature) month. Arrests stay conservative at a fixed −2.
    def completeness_of(ym):
        delta = (TODAY - month_last_day(ym)).days
        return month_completeness(rep_cdf, delta, month_len(ym))

    comp_latest_complete = completeness_of(latest_complete)
    if comp_latest_complete >= SOLID_COMPLETENESS:
        latest_settled = latest_complete                       # newest complete month is already solid
    else:
        latest_settled = months[-2 - REPORTED_SETTLE_LAG]      # hold back one more (mature) month
    settled_completeness = completeness_of(latest_settled)
    eff_settle_lag = months.index(latest_complete) - months.index(latest_settled)  # 0 or 1 today
    latest_settled_arrests = months[-2 - ARREST_SETTLE_LAG]    # enforcement context — kept conservative

    weeks = week_axis(datetime.date.fromisoformat(HISTORY_START[:10]), TODAY)
    latest_settled_week = settled_week(weeks, latest_settled)
    settle_lag_weeks = (weeks.index(weeks[-2]) - weeks.index(latest_settled_week)
                        if latest_settled_week else None)

    def signal_query(where, district):
        return (f"SELECT date_trunc_ym({DATE_COL}) AS month, resolution, count(*) AS n "
                f"WHERE ({where}) AND police_district='{district}' AND {DATE_COL} >= '{HISTORY_START}' "
                f"GROUP BY month, resolution ORDER BY month")

    agg = {
        "generated": TODAY.isoformat(),
        "dataset": DATASET,
        "districts": DISTRICTS,
        "months": months,
        "latest_complete_month": latest_complete,
        "latest_settled_month": latest_settled,                  # reported (the headline axis)
        "latest_settled_month_arrests": latest_settled_arrests,  # arrests context (settles slower)
        "settle_lag_months": eff_settle_lag,                     # effective reported lag today (0 or 1)
        "settle_lag_months_arrests": ARREST_SETTLE_LAG,
        # Completeness estimates (plan-settle-completeness.md) — surfaced on the reporting-note card.
        "settled_completeness_pct": round(settled_completeness * 100, 1),
        "settled_missing_pct": round((1 - settled_completeness) * 100, 1),
        "latest_complete_completeness_pct": round(comp_latest_complete * 100, 1),
        "latest_complete_missing_pct": round((1 - comp_latest_complete) * 100, 1),
        "solid_threshold_pct": round(SOLID_COMPLETENESS * 100, 1),
        "current_partial_month": cur_ym,
        "weeks": weeks,
        "latest_complete_week": weeks[-2],
        "current_partial_week": weeks[-1],
        "latest_settled_week": latest_settled_week,
        "settle_lag_weeks": settle_lag_weeks,
        "settling": settling,                             # reported-only — feeds the public caveat
        "settling_arrests": settling_arrests,             # arrest tail — justifies the −2 arrest buffer
        "signals": {},
        "excluded": [{"code": e["code"], "reason": e["reason"]} for e in EXCLUDED],
    }
    print(f"reporting lag (settled ref {agg['settling']['ref_window']}, n={agg['settling']['n']}): "
          f"median {agg['settling']['median_days']}d · {agg['settling']['within_30_pct']}% ≤30d · "
          f"p90 {agg['settling']['p90_days']}d")
    print(f"settle rule: latest complete {latest_complete} est {comp_latest_complete*100:.1f}% complete "
          f"(threshold {SOLID_COMPLETENESS*100:.1f}%) → headline={latest_settled} "
          f"(lag {eff_settle_lag}mo, est {settled_completeness*100:.1f}% complete, "
          f"~{(1-settled_completeness)*100:.1f}% still to arrive); arrests={latest_settled_arrests}")
    provenance = {
        "generated": TODAY.isoformat(),
        "dataset": DATASET, "domain": DOMAIN, "districts": DISTRICTS,
        "dataset_url": f"https://{DOMAIN}/d/{DATASET}",
        "history_start": HISTORY_START,
        "latest_settled_month": latest_settled,
        "latest_settled_month_arrests": latest_settled_arrests,
        # Methods/verifiability home for the settled-month rule — the plain-language "why" lives in the
        # #reporting-note callout; this footnote carries only the incremental detail (exact window + n,
        # the runnable raw-lag rows, the derived-completeness method, arrest p90) so the two don't restate
        # each other (dashboard-review Fix 6). Bar printed at one-decimal so it never collides with a
        # month's rounded completeness (Fix 2).
        "settle_note": (
            f"<strong>Reported</strong> theft settles fast: in a fully-settled reference window "
            f"({agg['settling']['ref_window']}, n={agg['settling']['n']} Northern reports) "
            f"~{agg['settling']['within_30_pct']}% of reports are filed within 30 days of the incident "
            f"(median {agg['settling']['median_days']}d, p90 {agg['settling']['p90_days']}d) — "
            f"<a href=\"{agg['settling']['lag_query_url']}\" target=\"_blank\" rel=\"noopener\">the raw "
            f"incident→report rows behind these percentiles ↗</a>. Convolving that lag curve over a month's "
            f"incident dates gives its estimated completeness (a derived figure — no single query returns "
            f"it); we evaluate the newest month clearing ~{agg['solid_threshold_pct']}% complete, today "
            f"{latest_settled} (~{agg['settled_completeness_pct']:.0f}% complete, "
            f"≈{agg['settled_missing_pct']}% still to arrive). "
            f"<strong>Arrests</strong> carry a long enforcement tail (p90 "
            f"{agg['settling_arrests']['p90_days']}d — "
            f"<a href=\"{agg['settling_arrests']['lag_query_url']}\" target=\"_blank\" rel=\"noopener\">"
            f"arrest-lag rows ↗</a>), so the arrests context stays {ARREST_SETTLE_LAG} months back "
            f"({latest_settled_arrests}). The homepage 2-week figure reflects the latest settled fortnight "
            f"({latest_settled_week})."),
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
        city_reported = series(months, monthly_count_citywide(sig["where"]))

        node = {
            "label": sig["label"], "desc": sig["desc"],
            "context_only": sig.get("context_only", False),
            "no_arrests": sig.get("no_arrests", False),
            "reported_label": sig.get("reported_label", "Theft reported by businesses"),
            "noun": sig.get("noun", "thefts reported by businesses"),
            "series": {},
            "series_weekly": {},
            "citywide": {"reported": city_reported},
        }

        for district in DISTRICTS:
            print(f"  {district}…")
            by_res = monthly_by_resolution(sig["where"], district)
            reported = series(months, {ym: d.get(RES_REPORTED, 0) for ym, d in by_res.items()})
            arrests = series(months, {ym: d.get(RES_ARREST, 0) for ym, d in by_res.items()})
            node["series"][district] = {"reported": reported, "arrests": arrests}
            # Weekly reported-only series for the homepage 2wk chip (mirrors monthly `reported` shape).
            wk_reported = weekly_reported(sig["where"], district)
            node["series_weekly"][district] = {"reported": [wk_reported.get(w, 0) for w in weeks]}
            print(f"    reported={sum(reported):,}  arrests={sum(arrests):,}")

        # Vehicle-theft detail section (type mix / hour / all-time top corners), per district.
        if sig.get("detail"):
            node["detail"] = {d: vehicle_detail(sig, d) for d in DISTRICTS}
            print(f"    detail baked ({sig['detail']['start']}→present) for {len(DISTRICTS)} districts")

        agg["signals"][key] = node

        # Citywide REPORTED query — the exact SoQL behind node.citywide.reported. The E2E trace harness
        # (validation/trace.py) re-runs this against live Socrata to prove the baked citywide totals are
        # externally true (catches filter/date drift on any signal, incl. the new vehicle category).
        citywide_reported_query = (
            f"SELECT date_trunc_ym({DATE_COL}) AS month, count(*) AS n "
            f"WHERE ({sig['where']}) AND resolution='{RES_REPORTED}' AND {DATE_COL} >= '{HISTORY_START}' "
            f"GROUP BY month ORDER BY month")
        provenance["signals"][key] = {
            "label": sig["label"], "why": sig["why"], "filter": sig["where"],
            "dataset_id": DATASET,
            "query_url": query_url(signal_query(sig["where"], "Northern")),
            "citywide_query_url": query_url(citywide_reported_query),
        }
        if sig.get("detail"):
            provenance["signals"][key]["detail_start"] = sig["detail"]["start"]
            provenance["signals"][key]["detail_queries"] = vehicle_detail_queries(sig)

    for e in EXCLUDED:
        eq = (f"SELECT incident_year, count(*) AS n WHERE ({e['where']}) "
              f"GROUP BY incident_year ORDER BY incident_year")
        provenance["excluded"].append({**e, "query_url": query_url(eq)})

    # Shoplifting concentration map (Workstream C) — a separate, deferred-loaded artifact so the map's
    # per-corner monthly data never touches the dashboard's first paint ([[layout-shift-plan]]).
    print("Building shoplifting concentration map …")
    map_districts = {}
    for d in DISTRICTS:
        corners = shoplifting_map(d)
        map_districts[d] = corners
        print(f"  {d}: {len(corners)} placed corners "
              f"(top {corners[0]['i']}={sum(corners[0]['m'].values())})" if corners else f"  {d}: 0 corners")
    map_data = {
        "generated": TODAY.isoformat(),
        "dataset": DATASET,
        "signal": "shoplifting",
        "axis": "reported",
        "months": months,
        "lurie_month": LURIE_MONTH,
        "latest_complete_month": latest_complete,
        "latest_settled_month": latest_settled,
        "districts": map_districts,
    }
    provenance["shoplifting_map"] = {
        "note": ("Static concentration map: reported shoplifting per intersection, summed over the "
                 "selected time window. A hot corner ≈ a single store, whose loss-prevention reporting "
                 "can switch on or off — read counts as that store's reporting, not the whole block. "
                 "See ../map-hotspot-findings.md for why a 'what moved since Lurie' framing was rejected."),
        "queries": {d: shoplifting_map_query(d) for d in DISTRICTS},
    }

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "aggregates.json"), "w") as f:
        json.dump(agg, f, separators=(",", ":"))
    with open(os.path.join(DATA, "provenance.json"), "w") as f:
        json.dump(provenance, f, indent=2)
    with open(os.path.join(DATA, "shoplifting-map.json"), "w") as f:
        json.dump(map_data, f, separators=(",", ":"))

    size = os.path.getsize(os.path.join(DATA, "aggregates.json"))
    msize = os.path.getsize(os.path.join(DATA, "shoplifting-map.json"))
    print(f"\naggregates.json: {size/1024:.1f} KB · months {months[0]}…{months[-1]} "
          f"(latest complete {latest_complete})")
    print(f"shoplifting-map.json: {msize/1024:.1f} KB · "
          f"{sum(len(v) for v in map_districts.values())} corners across {len(DISTRICTS)} districts")
