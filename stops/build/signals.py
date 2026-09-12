"""Signal registry for the stops tool (plan D2/D3).

Four community-reported signals, each viewed on its own — never blended. The 311/911 filters are
VERBATIM copies of the registries in ../../unhoused/build/signals.py and ../../drug/build/signals.py
so a count here equals the same count on those dashboards for the same place and month
(validation/validate_stops.py asserts the parity).

Every signal carries the fields 01_pull needs (dataset, select, where, date col) and the
fields 04_rollup needs for provenance (label, caveat, runnable query builders).
"""
import urllib.parse

HISTORY_START = "2023-01-01"          # same epoch as drug/ and unhoused/
STOP_RADIUS_M = 25                    # 311 → stop (plan D6)
RING_M = 250                          # displacement annulus (25–250 m)
NEIGHBOUR_M = 400                     # attribution baseline: 3 nearest unsheltered stops within this
INTERSECTION_SNAP_M = 100             # stop → parent 911 intersection centroid (plan D6), nearest fallback
INTERSECTION_NAME_M = 160             # …but prefer a centroid whose name carries the stop's on+at streets

DATASET_NAME = {
    "vw6y-z8j6": "SF 311 Cases",
    "2zdj-bwza": "SFPD Calls for Service (Dispatched)",
    "i28k-bkz6": "Muni Stops",
}

# ── verbatim from unhoused/build/signals.py ──
_ENCAMPMENT_WHERE = (
    "(service_name IN ('Encampment','Encampments') "
    "OR (service_name='General Request' AND lower(service_subtype) LIKE '%homeless%'))"
)
_CFS_COMMUNITY = "onview_flag IN ('N','HSOC') AND dup_cad_number IS NULL"
_CFS_PRESENCE_WHERE = (
    "call_type_final_desc IN ('SIT/LIE ENFORCEMENT','HOMELESS COMPLAINT') AND " + _CFS_COMMUNITY
)
# ── verbatim from drug/build/signals.py ──
_DRUG_TOKENS = ["DRUG", "DEALER", "SALES", "METH"]
_CFS_DRUG_NOTES = "(" + " OR ".join(
    f"upper(call_type_original_notes) LIKE '%{t}%' OR upper(call_type_final_notes) LIKE '%{t}%'"
    for t in _DRUG_TOKENS
) + ")"
_CFS_DRUG_WHERE = (
    "call_type_final_desc = 'SUSPICIOUS PERSON' AND onview_flag IN ('N','HSOC') "
    f"AND {_CFS_DRUG_NOTES}"
)
# ── this tool's own: 311 cases explicitly tagged to a transit shelter/platform ──
_SHELTER_WHERE = (
    "(upper(service_subtype) LIKE '%TRANSIT_SHELTER%' OR upper(service_subtype) LIKE '%TRANSIT SHELTER%' "
    "OR upper(service_details) LIKE '%TRANSIT_SHELTER%' OR upper(service_details) LIKE '%TRANSIT SHELTER%')"
)


def _311(where, **extra):
    return {
        "dataset": "vw6y-z8j6", "domain": "data.sf.gov",
        "date_col": "requested_datetime", "id_col": "service_request_id",
        "geo_kind": "latlong", "point_col": "point",
        "select": "service_request_id, requested_datetime, lat, long, service_name, service_subtype",
        "where": where, **extra,
    }


def _cfs(where, **extra):
    return {
        "dataset": "2zdj-bwza", "domain": "data.sf.gov",
        "date_col": "received_datetime", "id_col": "cad_number",
        "geo_kind": "point", "point_col": "intersection_point",
        "select": "cad_number, received_datetime, intersection_point, intersection_name, call_type_final_desc",
        "where": where, **extra,
    }


SIGNALS = {
    "encampment": _311(
        _ENCAMPMENT_WHERE,
        label="311 encampment & unhoused reports",
        short="311 encampment",
        source="unhoused/build/signals.py · encampment",
        caveat="Community 311 reports of encampments (tents/structures) unioned with the unhoused-individual "
               "requests SF split out in mid-2025. Counts who reports, not harm; a burst can be one neighbour. "
               "Attached to the nearest stop within 25 m of the geocoded point — 311 points snap to the "
               "intersection, so part of a stop's count is the corner's count.",
    ),
    "shelter_maint": _311(
        _SHELTER_WHERE,
        label="311 shelter maintenance (cleaning · graffiti · damage · litter)",
        short="311 shelter-tagged",
        source="stops/build/signals.py (this tool)",
        caveat="311 cases whose subtype/details are explicitly tagged to a transit shelter or platform: "
               "Street & Sidewalk Cleaning, Graffiti, Damaged Property, Litter Receptacle. About the "
               "structure itself — the public maintenance load, not presence.",
    ),
    "cfs_presence": _cfs(
        _CFS_PRESENCE_WHERE,
        label="911 unhoused-presence calls (Sit/Lie + Homeless Complaint)",
        short="911 unhoused",
        source="unhoused/build/signals.py · cfs_sitlie + cfs_homeless",
        caveat="Community-reported SFPD calls (onview N or HSOC, SF-flagged dups dropped). 911 points are "
               "intersection centroids, so calls attach to every stop at the same intersection and are "
               "labelled 'at this intersection', never 'at this stop'. Mid-block stops get none.",
    ),
    "cfs_drug": _cfs(
        _CFS_DRUG_WHERE,
        label="911 drug-activity reports (Suspicious Person, drug-noted)",
        short="911 drug",
        source="drug/build/signals.py · cfs_drug",
        caveat="Community 'Suspicious Person' calls whose notes mention drugs/dealing/meth — the drug "
               "dashboard's headline channel (~95% drug-related). Intersection-resolution like the other "
               "911 signal.",
    ),
}

STOPS_DATASET = {"dataset": "i28k-bkz6", "domain": "data.sf.gov"}


def _q(domain, dataset, soql):
    return f"https://{domain}/resource/{dataset}.json?" + urllib.parse.urlencode({"$query": soql})


def query_url(sig):
    """Runnable citywide monthly series for a signal (provenance, plan §5)."""
    soql = (f"SELECT date_trunc_ym({sig['date_col']}) AS month, count(*) AS reports "
            f"WHERE {sig['where']} AND {sig['date_col']} >= '{HISTORY_START}T00:00:00' "
            f"GROUP BY month ORDER BY month")
    return _q(sig["domain"], sig["dataset"], soql)


def stop_query_template(sig):
    """Per-stop runnable query with {lat}/{lng}/{intersection} placeholders the page fills in.
    311: within_circle on the case point (25 m). 911: exact intersection_name match."""
    if sig["geo_kind"] == "latlong":
        soql = (f"SELECT date_trunc_ym({sig['date_col']}) AS month, count(*) AS reports "
                f"WHERE {sig['where']} AND {sig['date_col']} >= '{HISTORY_START}T00:00:00' "
                f"AND within_circle({sig['point_col']}, {{lat}}, {{lng}}, {STOP_RADIUS_M}) "
                f"GROUP BY month ORDER BY month")
    else:
        soql = (f"SELECT date_trunc_ym({sig['date_col']}) AS month, count(*) AS reports "
                f"WHERE {sig['where']} AND {sig['date_col']} >= '{HISTORY_START}T00:00:00' "
                f"AND intersection_name = '{{intersection}}' "
                f"GROUP BY month ORDER BY month")
    # Leave placeholders unencoded so the page can substitute, then encode.
    return f"https://{sig['domain']}/resource/{sig['dataset']}.json?$query=" + soql
