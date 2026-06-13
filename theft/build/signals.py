"""Signal registry for the Northern merchant-theft dashboard build.

Source: SFPD Incident Reports 2018→present (wg3w-h783). District comes from the
native `police_district` field (verified reliable for Northern — see ../plan.md §4),
so NO point-in-polygon is needed. v1 has no map, so we fetch pre-aggregated monthly
counts straight from Socrata rather than paging raw rows.

Two signals (../plan.md D1):
  • shoplifting — Larceny Theft - Shoplifting (the enforcement-reflexive core signal)
  • commercial  — Burglary-Commercial + Robbery-Commercial, lumped (../plan.md §3.2)

Each is read on two axes (../plan.md §3.5 / D7):
  • reported = victim/business reports  → resolution = 'Open or Active'   (good = down)
  • arrests  = enforcement actions       → resolution = 'Cite or Arrest Adult' (good = up)
"""

DATASET = "wg3w-h783"
DOMAIN = "data.sfgov.org"
DISTRICT = "Northern"
DATE_COL = "incident_date"
HISTORY_START = "2018-01-01"

# Resolution buckets → the two axes. Other resolutions (Exceptional, Unfounded) are
# negligible for Northern and intentionally excluded from both axes.
RES_REPORTED = "Open or Active"
RES_ARREST = "Cite or Arrest Adult"

SIGNALS = {
    "shoplifting": {
        "label": "Shoplifting",
        "desc": "Theft of goods from a store (Larceny Theft – Shoplifting). The highest-volume "
                "merchant-theft type and the only one whose counts swing with enforcement intensity.",
        "where": "incident_subcategory = 'Larceny Theft - Shoplifting'",
        "why": "Shoplifting is the most direct measure of theft from retail merchants and the "
               "highest-volume merchant-theft category in the data. It is the one type whose totals "
               "are heavily enforcement-driven (a 2024 crackdown spiked arrests ~7× while business "
               "reports barely moved), which is exactly why we track the business-reported portion "
               "separately from arrests.",
    },
    "commercial": {
        "label": "Commercial burglary & robbery",
        "desc": "Forcible theft against business premises: break-ins (Burglary – Commercial, usually "
                "after-hours) plus holdups (Robbery – Commercial, force/threat against staff). Lumped "
                "into one signal; both are victim-reported and trend together.",
        "where": "incident_subcategory in('Burglary - Commercial','Robbery - Commercial')",
        "why": "These are forcible thefts against business premises — breaking into a closed store "
               "(burglary) or holding up staff (robbery). We combine them because both are almost "
               "entirely victim-reported (you cannot file a robbery online), they trend together, and "
               "individually each is too low-volume in one district to read month to month. Keeping "
               "them together gives a steadier signal; the build retains the subcategory so they can "
               "be split back apart on demand.",
        "components": {
            "burglary": "incident_subcategory = 'Burglary - Commercial'",
            "robbery": "incident_subcategory = 'Robbery - Commercial'",
        },
    },
}

# Excluded category — surfaced as a visible dashboard footnote (../plan.md D9).
EXCLUDED = [{
    "code": "Theft from Merchant or Library",
    "where": "incident_description = 'Theft from Merchant or Library'",
    "reason": "A fading legacy code: Northern reports peaked in 2018–20 (~17–28/yr) and are now ~1–6/yr, "
              "almost certainly reclassified into the Shoplifting taxonomy. Too small and too "
              "declining-for-reporting-reasons to be a trustworthy signal, so it is excluded here.",
    "why": "A reader might reasonably expect a literal 'theft from merchant' code to be included. We "
           "exclude it because its usage has collapsed (peaked at ~28/yr in Northern in 2018–20, now "
           "~1–6/yr) — the drop reflects reclassification into the Shoplifting taxonomy, not a real "
           "change on the ground, so trending it would mislead. Run the query to see the decline.",
}]
