"""Signal registry for the district encampment dashboard build.

Each signal is viewed INDIVIDUALLY in the UI (no combined index — see ../plan.md D4).
Encampment is the default. Filters survive SF311's 2024-06-13 taxonomy migration (D10)
via lower(...) LIKE and dual service_name spellings.

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

# Shared SFPD CFS gate: community-reported (onview N or HSOC), SF-flagged dups dropped.
_CFS_COMMUNITY = "onview_flag IN ('N','HSOC') AND dup_cad_number IS NULL"
_CFS_SELECT = "cad_number, received_datetime, intersection_point"


def _cfs(call_type):
    return {
        "dataset": "2zdj-bwza", "domain": "data.sfgov.org",
        "date_col": "received_datetime", "id_col": "cad_number",
        "geo_kind": "point", "geo_col": "intersection_point",
        "select": _CFS_SELECT,
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


_CLEANING = "service_name='Street and Sidewalk Cleaning'"

SIGNALS = {
    # ── Core: union across the June-2025 reroute (D12) ──
    "encampment": {
        **_311(
            "(service_name IN ('Encampment','Encampments') "
            "OR (service_name='General Request' AND lower(service_subtype) LIKE '%homeless%'))"
        ),
        "select": "service_request_id, requested_datetime, lat, long, service_name, service_subtype",
        "label": "Encampment & homelessness reports",
        "provenance_parts": {
            "encampment_only": "service_name IN ('Encampment','Encampments')",
            "rerouted": "service_name='General Request' AND lower(service_subtype) LIKE '%homeless%'",
        },
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

    # ── The dedicated 311 Encampment category on its own (a component of the union above) ──
    "encampment_only": {
        **_311("service_name IN ('Encampment','Encampments')"),
        "label": "Encampment category only (311)",
        "caveat": "The dedicated 311 'Encampment' service category by itself — a component of the "
                  "'Encampment & homelessness reports' union above. SF largely retired this category in "
                  "June 2025 and rerouted reports into a homelessness service-request category, so counts "
                  "drop sharply after mid-2025 for reporting reasons, NOT because encampments fell. Use the "
                  "union signal for a continuous trend; use this one to see the original category on its own.",
        "breaks": [{
            "month": "2025-06",
            "label": "category retired → reports rerouted out",
            "detail": (
                "This view counts only the dedicated 'Encampment' category, which SF largely stopped using "
                "around June 2025 — reports moved to 'General Request' / homelessness_and_supportive_housing. "
                "The drop after this date is that reporting change, not fewer encampments. The 'Encampment & "
                "homelessness reports' signal unions both to stay continuous."
            ),
        }],
    },

    # ── 311 co-located proxies (each viewed on its own) ──
    "waste": {
        **_311(f"{_CLEANING} AND (lower(service_details) LIKE '%human%' "
               "OR lower(service_details) LIKE '%urine%' OR lower(service_details) LIKE '%fece%')"),
        "label": "Human/animal waste & urine (311)",
        "caveat": "A co-located proxy for unhoused presence, not an encampment count. 311 bundles feces "
                  "with urine/animal waste and cannot isolate them.",
    },
    "needles": {
        **_311(f"{_CLEANING} AND (lower(service_details) LIKE '%needle%' OR lower(service_details) LIKE '%syringe%')"),
        "label": "Needles / syringes (311)",
        "caveat": "Needle reports have been in a multi-year citywide secular decline — compare a district "
                  "against the citywide line before reading a local drop as a local change.",
    },

    # ── SFPD 911 calls for service (community-reported), each on its own ──
    "cfs_sitlie": {
        **_cfs("SIT/LIE ENFORCEMENT"),
        "label": "911 Sit/Lie Enforcement",
        "caveat": "SFPD Calls for Service, community-reported. Cross-system unhoused-presence signal.",
    },
    "cfs_homeless": {
        **_cfs("HOMELESS COMPLAINT"),
        "label": "911 Homeless Complaint",
        "caveat": "SFPD Calls for Service, community-reported homeless-presence calls.",
    },
    # NOTE: '911 Blocked Sidewalk' (cfs_blocked) was DROPPED 2026-06-11 — only ~50% homeless-related
    # (HSOC routing), and that homeless-routed half is already captured in the HSOC signal. See plan.md §6.

    # ── City-response / context signal (caveat-heavy; not a measure of need) ──
    "hsoc": {
        "dataset": "2zdj-bwza", "domain": "data.sfgov.org",
        "date_col": "received_datetime", "id_col": "cad_number",
        "geo_kind": "point", "geo_col": "intersection_point",
        "select": _CFS_SELECT,
        "where": "onview_flag='HSOC' AND dup_cad_number IS NULL",
        "label": "HSOC outreach response (city action — context)",
        "caveat": "This is a CITY-RESPONSE signal (Healthy Streets Operation Center routing), not a measure "
                  "of need, and it OVERLAPS the other 911 signals rather than being separate. It's every call "
                  "routed to Healthy Streets regardless of type, so ~75% of it is the same records already in "
                  "Sit/Lie (~22k), Homeless Complaint (~14k), and Blocked Sidewalk (~3.8k); the rest is call "
                  "types not shown separately (Trespasser, Meet w/City Employee). Never add it to those signals "
                  "— you'd double-count. Read it as a cross-cutting view of how many calls the city routed to "
                  "homeless outreach, which rises as the program scales (program growth, not necessarily need).",
    },
}
