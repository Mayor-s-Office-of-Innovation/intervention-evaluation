# Findings — does the shoplifting hotspot "what moved" map hold up?

**Question.** Workstream C of [plan-property-crime-expansion.md](plan-property-crime-expansion.md) proposes
porting the drug/unhoused [[transition-map-hotcold-method]] — a recent-vs-prior "what moved since Lurie"
map that classifies corners as persistently hot / newly emerged / cooled. Earlier feasibility work
([map-and-vehicle-findings.md](map-and-vehicle-findings.md) Q1) established shoplifting *concentrates*
(one dominant corner per district). This is the deeper go/no-go: **is the corner-level *change* signal
real, or reporting-regime noise?** — plus a build-feasibility check on coordinates.

**Source.** SFPD `wg3w-h783`, shoplifting only (`incident_subcategory='Larceny Theft - Shoplifting'`),
native `police_district` + `intersection` fields. Baseline window CY2024 vs recent 12mo
(2025-06→2026-05). Reproduce block at end.

## Coordinates: available and clean ✅

Grouping by `intersection, latitude, longitude` returns exactly one lat/lng per corner (consistent, valid
SF coords). **Marker placement needs no geocoding and no baked cross-street index** — the native fields
suffice. Build-feasibility for the *map rendering* is not the blocker.

## The change signal: reporting-regime churn, not crime movement ❌

The dominant corners almost entirely **swap** between the baseline and recent windows:

| District | 2024 #1 corner | Recent (25-06→26-05) | What the map would say |
|---|---|---|---|
| Northern | Ellis/Webster **378** | → drops out (<6) | "cooled" |
| Northern | California/Polk 11 | → **134** | "newly emerged" |
| Tenderloin | Market/Powell **118** | → gone | "cooled" |
| Tenderloin | 9th/Jessie 10 | → **78** | "newly emerged" |
| Central | Eddy/Powell 57 | → gone | "cooled" |
| Mission | 24th/Potrero 83 | → gone | "cooled" |

Pulling the **monthly** series for the swing corners shows unambiguous **step-functions**, not organic
ramps:

- **Ellis/Webster (Northern):** ~1–3/mo through 2023 → **18, 66, 65, 70, 38** Jan–May 2024 → collapses →
  **~0 from 2025 on**. A single store's reporting switched on in early 2024 and off by 2025.
- **California/Polk (Northern):** dead through 2024 → **switches on mid-2025** (3, 12, 14, 9, 18, 14, 31,
  21…). A different store's reporting turned on.
- **Market/Powell (Tenderloin):** steady ~5–16/mo in 2023 → one **56** spike Sep 2024 → **~0 in 2025**.

Crime does not turn on in February and off in December at a single corner. These are **loss-prevention
reporting regimes** (a store opening/closing, an LP contract starting/ending, a reclassification), toggling
on and off. A recent-vs-prior classification would label them "emerged"/"cooled" and invite the reader to
read crime movement or intervention effect into what is one retailer's paperwork decision — the exact
[[crime-effectiveness-enforcement-reflexivity]] misattribution this project is built to avoid.

## Why the method transfers to drug/unhoused but not shoplifting

The [[transition-map-hotcold-method]] works on 311/CFS signals because a corner aggregates **many
independent reporters** — its count is a real measure of on-street conditions and moves organically. A
shoplifting corner is essentially **one big-box retailer**; the count is that single store's reporting
decision. **Denominator of independent observers ≈ 1.** That is a structural break, not a threshold to
tune — no min-count floor fixes it, because the high-count corners are precisely the single-store
artifacts.

## What survives

- **District-level victim-reported trend** (the existing signal cards) — fine; store-level reporting noise
  averages out across the district. This is the KR and it stands.
- **A *static* current-concentration map** (recent-window counts, pin/marker only, ranked list) is
  *defensible* with a hard caveat ("a hot corner ≈ one store; counts reflect reporting regimes"), but its
  marginal value over the ranked top-corners numbers already in
  [map-and-vehicle-findings.md](map-and-vehicle-findings.md) is low, and it de-facto names individual
  stores.
- **The recent-vs-prior "what moved / since Lurie" transition classification does NOT survive** for
  shoplifting.

## Recommendation

- **Drop Workstream C** as designed (the transition/"what moved" map). Do not ship hot/emerged/cooled
  classification for shoplifting.
- **Reconsider Workstream E (scrubber)** — its primary job was to drive the transition map's window. With
  no transition map, the scrubber is largely decorative; recommend dropping or deferring it too.
- If a map is still wanted for orientation, ship only a **static current-concentration marker map** with
  the reporting caveat — but treat it as optional polish, not a headline analytic, and expect it to add
  little beyond the ranked list.

## Reproduce

Base `https://data.sfgov.org/resource/wg3w-h783.json?$query=<SoQL>`, `incident_subcategory='Larceny Theft - Shoplifting'`:

```sql
-- Corner counts per district, a window at a time (swap dates: CY2024 vs 2025-06→2026-06)
SELECT police_district, intersection, count(*) AS n
WHERE incident_subcategory='Larceny Theft - Shoplifting'
  AND police_district in('Northern','Central','Mission','Tenderloin')
  AND incident_date>='2025-06-01' AND incident_date<'2026-06-01'
GROUP BY police_district, intersection HAVING count(*)>=6 ORDER BY police_district, n DESC

-- Monthly series for a swing corner (confirms step-function reporting regimes)
SELECT date_trunc_ym(incident_date) AS ym, count(*) AS n
WHERE incident_subcategory='Larceny Theft - Shoplifting'
  AND police_district='Northern' AND intersection LIKE '%ELLIS%WEBSTER%'
  AND incident_date>='2023-01-01' GROUP BY ym ORDER BY ym

-- Coordinates are one-per-intersection (no geocoding needed)
SELECT intersection, latitude, longitude, count(*) AS n
WHERE incident_subcategory='Larceny Theft - Shoplifting' AND police_district='Northern'
  AND incident_date>='2025-06-01' AND incident_date<'2026-06-01'
GROUP BY intersection, latitude, longitude ORDER BY n DESC
```

_Data pulled 2026-08-05._
