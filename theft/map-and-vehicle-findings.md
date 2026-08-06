# Findings — map clustering feasibility & vehicle-theft volume

**Purpose.** Two go/no-go research questions raised before expanding the theft dashboard
(designer mockups, 2026-07-31) toward the drug/unhoused feature set (hotspot "what moved" map,
day/night, scrubber) and a new **vehicle theft** category:

1. Do our current theft categories have enough spatial density to justify clustering them on a map?
2. How much auto/vehicle theft is actually happening — raw numbers, before we commit to the data?

**Source.** SFPD Incident Reports `wg3w-h783` on `data.sfgov.org`. District from the native
`police_district` field (Title-case here — e.g. `Northern` — *not* the UPPERCASE convention of the 311
dataset). Intersection from the native `intersection` field. Concentration figures below use the last 12
settled months (incident_date **2025-06-01 → 2026-05-31**), all resolutions. Reproduce block at the end.

---

## Q1 — Can we cluster the current categories on a map?

Counting reports vs. how many distinct intersections they spread across, per district:

| Category (district) | Reports/yr | Distinct corners | Hottest corner | Top-5 share |
|---|---:|---:|---|---:|
| **Shoplifting — Central** | 513 | 48 | O'Farrell/Powell **210** | ~52% |
| **Shoplifting — Mission** | 392 | 40 | Castro/Jersey **179** | ~59% |
| **Shoplifting — Northern** | 391 | 49 | California/Polk **134** | **71%** |
| **Shoplifting — Tenderloin** | 130 | 26 | 9th/Jessie **78** | ~77% |
| Commercial burglary & robbery — Northern | 118 | 62 | Fillmore/Sacramento **7** | ~24% |
| Motor vehicle theft — Northern | 419 | 264 | Eddy/Laguna **6** | ~6% |

### Shoplifting — clusters emphatically (YES)
In every district, shoplifting collapses onto **one or two dominant corners**, each of which is
effectively a single big-box retailer:
- **Northern** — California/Polk = **34%** of the whole district's shoplifting at one corner; top 5 = 71%.
- **Central** — O'Farrell/Powell = **41%** (Union Square).
- **Mission** — Castro/Jersey = **46%**.
- **Tenderloin** — 9th/Jessie = **60%** (low total, but one clear corner + a thin tail).

This is the strongest spatial signal in the dataset and is exactly why the designer's hotspot map reads so
cleanly. It works across all four districts, not just Northern. **A hotspot / "what moved" map is worth
building — for shoplifting.**

*Framing note:* because a hot corner ≈ one store, the map de-facto names a specific business. That's fine
for public crime data, but the block-level (intersection) aggregation and neutral tone should be kept.

### Commercial burglary & robbery — does NOT cluster (NO)
118 reports/yr smeared across 62 corners → **1.9 per corner**, hottest just **7/yr (≈0.6/month)**. A
recent-vs-prior "what moved" analysis on numbers this small is noise: a corner going 1→3 reads as a
"+200% newly emerged hotspot" and means nothing. **Do not give commercial its own map layer** — or gate it
behind a hard minimum-count floor and caveat heavily. Its monthly *trend* card is fine; its geography isn't.

### Motor vehicle theft — high volume but the MOST diffuse (NO, for short-window maps)
419 reports/yr across **264** corners → 1.6 per corner, hottest just **6/yr**. Cars are stolen wherever
they're parked, so MVT does not concentrate at intersections on a 12-month window. Only the **multi-year
all-time** top-intersections view holds up (8 years accumulate to ~49 at the top corner), and even that is
weak. **Show vehicle theft via its trend + type story and an all-time top-intersections bar — not on the
recent-vs-prior hotspot map.**

### Cross-cutting: small-denominator floor required
Even shoplifting has a California/Polk that went prior-12mo **2 → 134** = "+6600%". Technically true, useless
as a percentage. Any "newly emerged / cooled" transition classification needs a **minimum absolute count
floor** (e.g. require ≥ N in the current window) before a % change is shown, regardless of category.

---

## Q2 — How much vehicle theft is happening?

A lot by volume — and **falling fast**, which is a strong "improving" story on its own.

**Citywide Motor Vehicle Theft by year:**

| Year | Reports |
|---|---:|
| 2021 | 7,985 |
| 2022 | 8,225 |
| 2023 | **8,985** (peak) |
| 2024 | 7,252 |
| 2025 | **4,140** |
| 2026 | 1,928 (partial) |

**>50% drop from the 2023 peak to 2025.**

**By district, last 12mo:** Bayview 562 · Mission 463 · Ingleside 443 · **Northern 419** · Southern 417 ·
Taraval 326 · Central 296 · Tenderloin 259 · Richmond 183 · Park 171. In Northern, MVT (419) is essentially
**tied with shoplifting (391)** and larger than commercial burglary & robbery (118) — it is a genuine
property-crime driver, not a minor add-on.

**Vehicle type parse** — the `incident_description` field is trivially clean (literal `Vehicle, Stolen, Auto`,
`…, Truck`, `…, Motorcycle`, `…, Other Vehicle`). Citywide 2018→present:

| incident_description | n | typed? |
|---|---:|---|
| Vehicle, Stolen, Auto | 29,952 | ✅ auto |
| Vehicle, Stolen, Truck | 5,458 | ✅ truck |
| Vehicle, Stolen, Motorcycle | 4,820 | ✅ motorcycle |
| Vehicle, Stolen, Other Vehicle | 3,842 | ✅ other |
| Vehicle, Stolen, Mobile Home/Trailer | 172 | ✅ other |
| Vehicle, Stolen, Bus | 21 | ✅ other |
| Vehicle, Stolen & Recovered | 5,599 | — no type |
| Vehicle, Recovered, Stolen outside SF | 5,313 | — no type |
| Vehicle, Stolen, Attempted | 1,562 | — no type |

**Auto ≈ 68% of the typed subset** (44,265 typed), matching the designer's "69% / Auto" bar. The untyped
recovered/attempted rows are **~18%** of the grand total — exactly the "18% excluded from the mix" the
mockup calls out. The type breakdown, hour-of-day, and all-time top-intersections detail are all well
supported by the data.

---

## What this means for scope

- **Hotspot "what moved" map:** build it, **shoplifting-first**. Default (and possibly only) category is
  shoplifting; drop or floor+caveat commercial; keep vehicle theft off the recent-vs-prior map.
- **Vehicle theft:** add as a prominent category — high volume, clean multi-year decline (enforcement-robust,
  matches our victim-reported principle), clean type parse. Its **detail section** (type mix / hour / all-time
  top corners) is the most data-rich part of the deck and is justified precisely *because* its data supports
  a detail the merchant categories can't.
- **Commercial:** keep the trend card, no map layer.
- **Every transition %** needs a minimum-count floor.

Feeds → [plan-property-crime-expansion.md](plan-property-crime-expansion.md).

---

## Reproduce

Base endpoint: `https://data.sfgov.org/resource/wg3w-h783.json?$query=<SoQL>`. Window
`incident_date >= '2025-06-01' AND incident_date < '2026-06-01'` unless noted.

```sql
-- Shoplifting concentration, other districts
SELECT police_district, count(*) AS total, count(distinct intersection) AS intersections
WHERE incident_subcategory='Larceny Theft - Shoplifting'
  AND police_district in('Central','Mission','Tenderloin')
  AND incident_date>='2025-06-01' AND incident_date<'2026-06-01'
GROUP BY police_district ORDER BY total DESC

-- Top shoplifting corners (swap police_district)
SELECT intersection, count(*) AS n
WHERE incident_subcategory='Larceny Theft - Shoplifting' AND police_district='Northern'
  AND incident_date>='2025-06-01' AND incident_date<'2026-06-01'
GROUP BY intersection ORDER BY n DESC LIMIT 15

-- Commercial concentration (Northern)
SELECT count(*) AS total, count(distinct intersection) AS intersections
WHERE incident_subcategory in('Burglary - Commercial','Robbery - Commercial')
  AND police_district='Northern' AND incident_date>='2025-06-01' AND incident_date<'2026-06-01'

-- Vehicle theft concentration (Northern)
SELECT count(*) AS total, count(distinct intersection) AS intersections
WHERE incident_category='Motor Vehicle Theft' AND police_district='Northern'
  AND incident_date>='2025-06-01' AND incident_date<'2026-06-01'

-- Citywide MVT by year
SELECT date_extract_y(incident_date) AS yr, count(*) AS n
WHERE incident_category='Motor Vehicle Theft' AND incident_date>='2018-01-01'
GROUP BY yr ORDER BY yr

-- MVT by district, last 12mo
SELECT police_district, count(*) AS n
WHERE incident_category='Motor Vehicle Theft'
  AND incident_date>='2025-06-01' AND incident_date<'2026-06-01'
GROUP BY police_district ORDER BY n DESC

-- Vehicle type mix (all-time)
SELECT incident_description, count(*) AS n
WHERE incident_category='Motor Vehicle Theft' AND incident_date>='2018-01-01'
GROUP BY incident_description ORDER BY n DESC
```

_Data pulled 2026-08-05._
