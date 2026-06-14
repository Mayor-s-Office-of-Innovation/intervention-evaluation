"""Signal registry for the DRUG-ACTIVITY dashboard build.

A drug-specific re-scope of ../../unhoused/build/signals.py (see ../plan.md). The build
mixes TWO kinds of signal:

  • "point" signals  — raw rows pulled + point-in-polygon district assignment + the
                       fixed-Lurie transition map (01_pull → 02_assign → 04 → 05).
                       Only the PRESENCE headline (cfs_drug) needs this — it's the map signal.
  • "agg_only" signals — no raw points, no map; 03_rollup fetches pre-grouped monthly
                       counts straight from Socrata (count(distinct id) by month × district).
                       The enforcement/arrest signals + needles. Keeps the build small.

THREE datasets, and TWO freshness rules (../plan.md D8):
  • SFPD CFS 2zdj-bwza   — community drug-activity calls. Creation-stamped → no settle lag.
                           Coords in intersection_point (geo). Native police_district is UPPERCASE.
  • SFPD incidents wg3w-h783 — drug arrests. Report-approval SETTLES (theft-style buffer).
                           Native police_district is Title Case. Count DISTINCT incident_id
                           (one row per charge → a multi-substance dealer = several rows; D §4).
  • SF 311 vw6y-z8j6     — needle/syringe reports. Creation-stamped. Citywide only (excluded
                           from the trend read; route-shift caveat — D5).

TWO co-headline cards, opposite desired directions (../plan.md D9):
  • cfs_drug      ↓ = good  (the problem: community-reported drug activity)
  • dealer_arrests ↑ = good (supply disruption — elevated to a goal given the fentanyl crisis)
"""

DOMAIN = "data.sfgov.org"
# 2023 onward — matches the emergent-map drug-activity window; the fixed-Lurie split sits inside it.
HISTORY_START = "2023-01-01T00:00:00"

# Canonical district keys are UPPERCASE (the unhoused/emergent-map convention + the qgnn-b9vv
# geojson properties). The agg_only signals canonicalize their native police_district to UPPER
# to match, so the 2zdj-bwza (UPPER) vs wg3w-h783 (Title) casing difference is absorbed.
TARGET_DISTRICTS = ["NORTHERN", "MISSION", "CENTRAL", "TENDERLOIN"]
DISTRICT_LABEL = {
    "NORTHERN": "Northern", "MISSION": "Mission",
    "CENTRAL": "Central", "TENDERLOIN": "Tenderloin",
}

# Fixed Lurie-inauguration split the transition map (D11/D12) is built on.
LURIE_INAUGURATION = "2025-01-08"

# wg3w-h783 incident reports settle (report-approval lag). MEASURED (drug offenses, 2026-06): median 0d /
# p90 0d — drug arrests are officer-generated and reported same-day, so unlike theft's victim reports they
# barely settle (corrects the D8 assumption of a theft-style 2-mo buffer). We hold back just ONE month as a
# light hedge for late approvals; CFS/311 hold back none beyond the partial current month.
SETTLE_LAG_MONTHS = 1

DATASET_NAME = {
    "2zdj-bwza": "SFPD Calls for Service (Dispatched)",
    "wg3w-h783": "SFPD Incident Reports",
    "vw6y-z8j6": "SF 311 Cases",
}

# ── cfs_drug headline filter — emergent-map's 🔴 "Suspicious Person, drug-noted" channel verbatim (D1) ──
_DRUG_TOKENS = ["DRUG", "DEALER", "SALES", "METH"]
_CFS_DRUG_NOTES = "(" + " OR ".join(
    f"upper(call_type_original_notes) LIKE '%{t}%' OR upper(call_type_final_notes) LIKE '%{t}%'"
    for t in _DRUG_TOKENS
) + ")"
_CFS_DRUG_WHERE = (
    "call_type_final_desc = 'SUSPICIOUS PERSON' AND onview_flag IN ('N','HSOC') "
    f"AND {_CFS_DRUG_NOTES}"
)
_CFS_SELECT = ("cad_number, received_datetime, intersection_point, intersection_name, "
               "call_type_final_desc, call_type_original_desc, call_type_original_notes, "
               "call_type_final_notes, disposition, priority_final")
# Order = most useful first. The two notes fields are what matched the drug filter (the DRUG/DEALER/
# SALES/METH keyword lives in one of them), so they're surfaced prominently to show WHY a generic
# "Suspicious Person" call counts as drug activity.
_CFS_DETAIL = [
    ("intersection_name", "Intersection"),
    ("call_type_original_notes", "Reported notes"),
    ("call_type_final_notes", "Dispatch notes"),
    ("call_type_original_desc", "Reported as"),
    ("call_type_final_desc", "Final call type"),
    ("disposition", "Disposition"),
    ("priority_final", "Priority"),
]

# ── wg3w-h783 dealer filter — the §4 locked, live-verified description set (intent-to-distribute) ──
_DEALER_TOKENS = ["FOR SALE", "SALE", "SALES", "TRANSPORT", "FURNISH", "DELIV",
                  "MANUFACTUR", "TRAFFIC", "CULTIVAT", "MAINTAIN PREMISE", "MONEY OFFENSE",
                  "DRUG LAB APPARATUS"]
_DEALER_LIKE = "(" + " OR ".join(f"upper(incident_description) LIKE '%{t}%'" for t in _DEALER_TOKENS) + ")"
_PARA_LIKE = "upper(incident_description) LIKE '%PARAPHERNALIA%'"
# Shared arrest gate: a Drug-Offense initial report that resolved to an enforcement action
# (cite/arrest). wg3w-h783 has NO booked-vs-cited split (only 'Cite or Arrest Adult'), so this
# is the finest arrest gate available (../plan.md §4 Result 1).
_ARREST_GATE = ("incident_category = 'Drug Offense' AND report_type_description = 'Initial' "
                "AND resolution = 'Cite or Arrest Adult'")


def _cfs_point(where, label, **extra):
    """A point signal on 2zdj-bwza (raw pull + map)."""
    return {
        "kind": "point",
        "dataset": "2zdj-bwza", "domain": DOMAIN,
        "date_col": "received_datetime", "id_col": "cad_number",
        "geo_kind": "point", "geo_col": "intersection_point",
        "select": _CFS_SELECT, "detail": _CFS_DETAIL,
        "settles": False,
        "where": where, "label": label, **extra,
    }


def _incident_agg(where, label, **extra):
    """An aggregate-only signal on wg3w-h783 (grouped count(distinct incident_id), settles)."""
    return {
        "kind": "agg_only",
        "dataset": "wg3w-h783", "domain": DOMAIN,
        "date_col": "incident_datetime", "id_col": "incident_id",
        "distinct": True,            # count DISTINCT incident_id — rows are per-charge (D §4 Result 0)
        "district_field": "police_district",
        "settles": True,             # report-approval lag → settle buffer (D8)
        "where": where, "label": label, **extra,
    }


SIGNALS = {
    # ── CARD 1 · headline presence (↓ good) — the map signal ──
    "cfs_drug": _cfs_point(
        _CFS_DRUG_WHERE,
        "Drug-activity reports (911, community)",
        tier=1, axis="presence", goal="down",
        caveat="The headline read on the problem. SFPD Calls for Service flagged as a community report "
               "(onview N or HSOC) for a 'Suspicious Person' whose call notes mention drugs/dealing/meth — "
               "emergent-map's drug-activity channel, ~95% drug-related. Citizen-perception and robust to "
               "how hard the city is enforcing. Down = good.",
    ),

    # ── CARD 2 · headline enforcement (↑ good) — dealer arrests, the supply-disruption goal (D9) ──
    "dealer_arrests": _incident_agg(
        f"{_ARREST_GATE} AND {_DEALER_LIKE}",
        "Dealer arrests (SFPD)",
        tier=1, axis="enforcement", goal="up", group="arrest_mix",
        caveat="Drug arrests narrowed to DEALING/distribution charges (possession-for-sale, sale, "
               "transport, manufacture, trafficking) — not possession or use. Counted as distinct "
               "incidents (one arrest, not one row per charge). Normally enforcement is context not a "
               "target, but given the fentanyl crisis we want this to rise to disrupt supply (D9). "
               "Reflexivity caveat: a rise can reflect effort, not just more dealers.",
    ),

    # ── composition / context: what the rest of the drug-arrest volume actually is ──
    "paraphernalia": _incident_agg(
        f"{_ARREST_GATE} AND {_PARA_LIKE}",
        "Paraphernalia-possession arrests",
        tier=2, axis="enforcement", goal="context", group="arrest_mix",
        caveat="Arrests for possessing drug paraphernalia (pipes, needles, etc.). Catch-and-release that "
               "rarely leads to charges — NOT a measure of supply disruption. Shown to expose what the "
               "drug-arrest surge is actually made of: this category tripled while dealer arrests fell.",
    ),
    "other_drug_arrests": _incident_agg(
        f"{_ARREST_GATE} AND NOT ({_PARA_LIKE} OR {_DEALER_LIKE})",
        "Other drug arrests (possession / use / loitering)",
        tier=2, axis="enforcement", goal="context", group="arrest_mix",
        caveat="The remaining drug arrests — simple/ambiguous possession, under-the-influence, and "
               "loitering-where-sold. Like paraphernalia, these are user-level churn, not supplier "
               "disruption, and are excluded from the dealer-arrest metric.",
    ),

    # ── needles — kept in the build for PROVENANCE ONLY (the methodology footnote links its query).
    # NOT surfaced as a chart signal: per-district analysis (2026-06) found every district flat-to-down
    # (Northern −26% … Mission −2%, none rising), so there's no signal to show — only the route-shift
    # decline that would mislead. Removed from the dashboard, explained in a footnote (D5 superseded). ──
    "needles": {
        "kind": "agg_only",
        "dataset": "vw6y-z8j6", "domain": DOMAIN,
        "date_col": "requested_datetime", "id_col": "service_request_id",
        "distinct": True,
        "district_field": None,      # 311 has no reliable police district → citywide only
        "citywide_only": True,
        "settles": False,
        "excluded_from_trend": True,
        "where": ("service_name = 'Street and Sidewalk Cleaning' AND "
                  "((service_subtype = 'garbage_and_debris' AND "
                  "service_details IN ('needles_less_than_20','needles_20_or_more')) OR "
                  "(service_subtype = 'Medical Waste' AND service_details = 'Needles'))"),
        "label": "Needle / syringe reports (311)",
        "tier": 3, "axis": "presence", "goal": "context",
        "caveat": "A route-specific injection-drug indicator, shown citywide only and EXCLUDED from the "
                  "trend read: needle reports fell ~19% year-over-year (and ~4× since 2018) as drug use "
                  "shifted from injection to fentanyl smoking, so using them in a Lurie-era comparison "
                  "would falsely inflate 'improvement' (D5). Shown for transparency, never summed into the "
                  "headline.",
    },
}

# Composition group — the "what the drug-arrest surge is made of" stacked view (dealer vs churn).
GROUPS = {
    "arrest_mix": {
        "label": "What drug arrests are made of",
        "members": ["dealer_arrests", "paraphernalia", "other_drug_arrests"],
        "note": "All three are distinct-incident counts under the same arrest gate (Drug Offense, "
                "initial report, resolved Cite or Arrest Adult). A small number of incidents carry both a "
                "dealer and a paraphernalia charge (~1%), so the stacked total slightly exceeds unique "
                "incidents; the shape is unaffected.",
    },
}

# Signals the transition/displacement map is built on — PRESENCE only, never enforcement (D2).
MAP_SIGNALS = {
    "cfs_drug": ["cfs_drug"],
}


def query_url(sig_or_where, where=None):
    """Runnable Socrata REST query link for a signal dict (D7 provenance)."""
    import urllib.parse
    if not isinstance(sig_or_where, dict):
        raise ValueError("pass the signal dict")
    domain, dataset = sig_or_where["domain"], sig_or_where["dataset"]
    date_col = sig_or_where["date_col"]
    w = where or sig_or_where["where"]
    full = f"{w} AND {date_col} >= '{HISTORY_START}'"
    cnt = f"count(distinct {sig_or_where['id_col']})" if sig_or_where.get("distinct") else "count(*)"
    q = (f"SELECT date_trunc_ym({date_col}) AS month, {cnt} AS reports "
         f"WHERE {full} GROUP BY month ORDER BY month")
    return f"https://{domain}/resource/{dataset}.json?" + urllib.parse.urlencode({"$query": q})
