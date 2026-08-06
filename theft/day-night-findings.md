# Findings — is a Day/Night split illuminative for theft?

**Question.** Before building the Day/Night toggle (Workstream D of
[plan-property-crime-expansion.md](plan-property-crime-expansion.md), a port of the drug/unhoused
[[time-of-day-filter-plan]]), check whether theft categories actually split by time of day in a way
that *tells the reader something* — or whether the toggle would be obvious, noisy, or misleading.

**Source.** SFPD Incident Reports `wg3w-h783`, `date_extract_hh(incident_datetime)`, citywide, last 12
settled months (`incident_date >= '2025-06-01' AND < '2026-06-01'`), all resolutions. Citywide (not
per-district) for a larger N; the hour-shape is the same per district. Day = 6am–8pm (hh 6–19),
Night = 8pm–6am (hh 20–23, 0–5), matching the drug/unhoused convention.

## Result

| Category | Day | Night | Shape |
|---|---:|---:|---|
| **Shoplifting** (the KR) | **89%** | 11% | smooth ramp from ~9am, peak **2–7pm** (max hh 18), near-zero overnight |
| Commercial burglary & robbery | 60% | 40% | roughly flat across the clock |
| Motor vehicle theft | 62% | 38% | evening peak + steady overnight floor |

## Conclusion — drop the Day/Night toggle for theft

A Day/Night toggle is **not illuminative here, and would be quietly misleading.** Two independent
reasons, one per group of categories:

1. **Shoplifting is ~90% daytime by definition** — stores are open in the daytime, so the split just
   restates store hours. Worse, the *only* interesting temporal structure is the smooth afternoon bulge
   (reports climb from ~9am and peak 2–7pm); a binary day/night switch destroys exactly that shape.
2. **Commercial & vehicle theft are where "night" would be interesting — and they're precisely the
   categories where reported hour ≠ occurrence hour.** A commercial burglary is discovered and reported
   the *next morning*; a stolen car is reported *whenever the owner returns to the curb*. Their ~40%
   "night" share measures when victims notice, not when crime happens. A toggle would chart reporting
   behavior and label it crime timing.

**Midnight (hour-0) artifact.** Shoplifting shows **91** reports at 00:00, flanked by **4** at 23:00 and
**4** at 01:00 — the classic "unknown time → coded 00:00" dump. It lands entirely on the *night* side,
inflating exactly the figure a Day/Night headline would lean on. (Discounting it, shoplifting is ~92%
day / 8% night.)

**Why day/night *does* work on drug/unhoused but not theft.** Those are direct-observation signals — a
311 call or CFS is filed when someone *sees* it happening — so reported ≈ occurrence and behavior
genuinely differs by hour. Theft breaks that assumption for 2 of 3 categories and is trivially
determined by store hours for the third.

## What to do instead

Keep the honest artifact we already bake: the **hour-of-day histogram in the vehicle-theft detail
section** (Workstream B), labeled **"reported hour."** It shows the smooth curve truthfully without
forcing a binary the data can't support. Net effect: **Workstream D is dropped** — less code, one fewer
misleading affordance.

## Reproduce

Base endpoint `https://data.sfgov.org/resource/wg3w-h783.json?$query=<SoQL>`, window
`incident_date >= '2025-06-01' AND incident_date < '2026-06-01'`:

```sql
-- swap the WHERE filter per category
SELECT date_extract_hh(incident_datetime) AS hh, count(*) AS n
WHERE incident_subcategory='Larceny Theft - Shoplifting'
  AND incident_date>='2025-06-01' AND incident_date<'2026-06-01'
GROUP BY hh ORDER BY hh
-- commercial:  incident_subcategory in('Burglary - Commercial','Robbery - Commercial')
-- vehicle:     incident_category='Motor Vehicle Theft'
```

_Data pulled 2026-08-05._
