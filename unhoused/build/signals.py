"""Signal registry for the UNHOUSED dashboard build.

A clean re-scope of ../../districts/build/signals.py down to a homeless-specific set
(see ../plan.md). Dropped vs districts: `needles` (→ drug-use project) and `waste`
(→ cleanliness project, could not confidently attribute to unhoused — plan §3).

Five signals remain, organized for the D14 three-tier layout:
  TIER 1 (headline, standalone): encampment  (+ encampment_only as a sub-view)
  TIER 2 (grouped, secondary):   cfs_sitlie + cfs_homeless  → group "cfs_presence"
  TIER 3 (context, NOT success): hsoc

Every signal carries its dataset id + human name; combined signals expose their parts,
and 03_rollup emits a runnable Socrata query link per signal/part (D7 — provenance must
make clear what each number, especially a combined one, ties back to).

Two datasets, two geometries:
  • 311 (vw6y-z8j6): coords in plain lat / long columns        → geo_kind 'latlong'
  • SFPD CFS (2zdj-bwza): coords in the intersection_point geo  → geo_kind 'point'
"""

TARGET_DISTRICTS = ["CENTRAL", "NORTHERN", "MISSION", "TENDERLOIN"]
DISTRICT_LABEL = {
    "CENTRAL": "Central", "NORTHERN": "Northern",
    "MISSION": "Mission", "TENDERLOIN": "Tenderloin",
}
HISTORY_START = "2023-01-01T00:00:00"

# The fixed Lurie-inauguration split that the transition map (D11/D12) is built on.
LURIE_INAUGURATION = "2025-01-08"

DATASET_NAME = {
    "vw6y-z8j6": "SF 311 Cases",
    "2zdj-bwza": "SFPD Calls for Service (Dispatched)",
}

# Shared SFPD CFS gate: community-reported (onview N or HSOC), SF-flagged dups dropped.
_CFS_COMMUNITY = "onview_flag IN ('N','HSOC') AND dup_cad_number IS NULL"
# `detail` (col → label) drives the hover overlay on the zoom-in individual markers (and the
# extra columns are pulled so 02_assign can carry them into the per-signal points file).
_CFS_SELECT = ("cad_number, received_datetime, intersection_point, intersection_name, "
               "call_type_final_desc, disposition, priority_final")
_CFS_DETAIL = [
    ("intersection_name", "Intersection"),
    ("call_type_final_desc", "Call type"),
    ("disposition", "Disposition"),
    ("priority_final", "Priority"),
]


def _cfs(call_type):
    return {
        "dataset": "2zdj-bwza", "domain": "data.sfgov.org",
        "date_col": "received_datetime", "id_col": "cad_number",
        "geo_kind": "point", "geo_col": "intersection_point",
        "select": _CFS_SELECT,
        "detail": _CFS_DETAIL,
        "where": f"call_type_final_desc = '{call_type}' AND {_CFS_COMMUNITY}",
    }


def _311(where):
    return {
        "dataset": "vw6y-z8j6", "domain": "data.sfgov.org",
        "date_col": "requested_datetime", "id_col": "service_request_id",
        "geo_kind": "latlong",
        "select": "service_request_id, requested_datetime, lat, long",
        "where": where,
    }


SIGNALS = {
    # ── TIER 1 · headline (standalone): the core union across the June-2025 reroute ──
    "encampment": {
        **_311(
            "(service_name IN ('Encampment','Encampments') "
            "OR (service_name='General Request' AND lower(service_subtype) LIKE '%homeless%'))"
        ),
        "select": ("service_request_id, requested_datetime, lat, long, service_name, service_subtype, "
                   "address, status_description, agency_responsible, source"),
        "detail": [
            ("address", "Address"),
            ("service_subtype", "Type"),
            ("status_description", "Status"),
            ("agency_responsible", "Handled by"),
            ("source", "Reported via"),
        ],
        "label": "Encampment & homelessness reports",
        "tier": 1,
        "caveat": "The critical standalone presence metric. Unions the dedicated 311 'Encampment' "
                  "category with the homelessness service-requests it was rerouted into in June 2025, so "
                  "the trend stays continuous.",
        # D7: combined signal → expose each part's filter so the union is auditable.
        "provenance_parts": {
            "encampment_only": "service_name IN ('Encampment','Encampments')",
            "rerouted": "service_name='General Request' AND lower(service_subtype) LIKE '%homeless%'",
        },
        "dedup_note": "Deduped on service_request_id across both parts of the union.",
        "breaks": [{
            "month": "2025-06",
            "label": "Encampment category folded into homelessness requests",
            "detail": (
                "Around June 2025 SF retired the dedicated 311 'Encampment' service category and began "
                "routing these reports to 'General Request' / homelessness_and_supportive_housing. This "
                "series unions both so the trend stays continuous, but the pre/post categories are not "
                "perfectly equivalent (pre = tent/structure sightings; post = broader homelessness service "
                "requests). Read counts straddling this date with that in mind, not as a real-world change."
            ),
        }],
    },

    # ── TIER 1 · sub-view: the dedicated Encampment category on its own (exposes the reroute) ──
    "encampment_only": {
        **_311("service_name IN ('Encampment','Encampments')"),
        "label": "Encampment category only (311)",
        "tier": 1,
        "subview_of": "encampment",
        "caveat": "A sub-view of 'Encampment & homelessness reports' showing only the dedicated 311 "
                  "'Encampment' category. SF largely retired this category in June 2025 and rerouted "
                  "reports into a homelessness service-request category, so counts drop sharply after "
                  "mid-2025 for reporting reasons, NOT because encampments fell. Use the headline union "
                  "for a continuous trend; use this to see the original category alone.",
        "breaks": [{
            "month": "2025-06",
            "label": "category retired → reports rerouted out",
            "detail": (
                "This view counts only the dedicated 'Encampment' category, which SF largely stopped using "
                "around June 2025 — reports moved to 'General Request' / homelessness_and_supportive_housing. "
                "The drop after this date is that reporting change, not fewer encampments."
            ),
        }],
    },

    # ── TIER 2 · grouped community-reported 911 presence calls (each viewed individually too) ──
    "cfs_sitlie": {
        **_cfs("SIT/LIE ENFORCEMENT"),
        "label": "911 Sit/Lie Enforcement",
        "tier": 2,
        "group": "cfs_presence",
        "caveat": "SFPD Calls for Service, community-reported. ~87% are routed to the Healthy Streets "
                  "Operation Center (homeless outreach), so this is overwhelmingly an unhoused-presence call.",
    },
    "cfs_homeless": {
        **_cfs("HOMELESS COMPLAINT"),
        "label": "911 Homeless Complaint",
        "tier": 2,
        "group": "cfs_presence",
        "caveat": "SFPD Calls for Service, community-reported homeless-presence calls. ~84% routed to "
                  "homeless outreach (HSOC).",
    },

    # ── TIER 3 · city-response / context signal (caveat-heavy; NOT a success metric, D8) ──
    "hsoc": {
        "dataset": "2zdj-bwza", "domain": "data.sfgov.org",
        "date_col": "received_datetime", "id_col": "cad_number",
        "geo_kind": "point", "geo_col": "intersection_point",
        "select": _CFS_SELECT,
        "where": "onview_flag='HSOC' AND dup_cad_number IS NULL",
        "label": "HSOC outreach response (city action — context)",
        "tier": 3,
        "caveat": "A CITY-RESPONSE signal (Healthy Streets Operation Center routing), NOT a measure of "
                  "need and NOT a success metric. It rises as the program scales. It OVERLAPS the 911 "
                  "signals above — it's every call routed to Healthy Streets regardless of type, so ~75% of "
                  "it is the same records already counted in Sit/Lie and Homeless Complaint. NEVER sum it "
                  "with those — you'd double-count.",
    },
}

# D14 — grouped stats. Members are summed (clean: distinct call types, deduped per cad_number,
# no overlap between them). Frontend can decompose to the members on a toggle.
GROUPS = {
    "cfs_presence": {
        "label": "911 calls about unhoused presence",
        "members": ["cfs_sitlie", "cfs_homeless"],
        "tier": 2,
        "note": "Sum of two distinct, non-overlapping SFPD CFS call types (Sit/Lie Enforcement + "
                "Homeless Complaint), each deduped per call. Summable because they are different "
                "call_type_final_desc values — unlike HSOC, which re-counts these and is never summed.",
    },
}


def query_url(sig_or_where, where=None, limit_rows=False):
    """Build a runnable Socrata REST query link for a signal dict or a (domain,dataset,where).

    Used by 03_rollup to write auditable per-signal / per-component query links into
    provenance.json (D7) so the page and the underlying data can't drift.
    """
    import urllib.parse
    if isinstance(sig_or_where, dict):
        domain, dataset, w, date_col = (
            sig_or_where["domain"], sig_or_where["dataset"],
            where or sig_or_where["where"], sig_or_where["date_col"],
        )
    else:
        raise ValueError("pass the signal dict")
    full = f"{w} AND {date_col} >= '{HISTORY_START}'"
    q = (f"SELECT date_trunc_ym({date_col}) AS month, count(*) AS reports "
         f"WHERE {full} GROUP BY month ORDER BY month")
    return f"https://{domain}/resource/{dataset}.json?" + urllib.parse.urlencode({"$query": q})
