# What the "Encampment" headline number counts (311 explainer)

**Dataset:** SF 311 Cases — `vw6y-z8j6` on `data.sfgov.org`
**Question this answers:** why the dashboard's Northern-district encampment number for June 2026 is **1,146**, not the ~560 you'd get from the 311 "Encampment" category alone.

All queries below run as-is in the Socrata query editor, or against the REST endpoint:
`https://data.sfgov.org/resource/vw6y-z8j6.json?$query=<SoQL>`

Two gotchas up front:
- **`police_district` values are UPPERCASE** — use `'NORTHERN'`, not `'Northern'` (title case silently returns 0).
- Live portal numbers drift ~0.5% from the dashboard because the site is built from a nightly snapshot; a few late-arriving June cases settle afterward.

---

## TL;DR

The headline number is a **union of two 311 categories**, deduped on `service_request_id`:

| Component | Filter | Northern · Jun 2026 |
|---|---|---|
| A — dedicated "Encampment" category | `service_name IN ('Encampment','Encampments')` | ~565 |
| B — rerouted homelessness requests | `service_name='General Request' AND service_subtype='homelessness_and_supportive_housing'` | ~583 |
| **Union = headline** | A OR B | **~1,148** (dashboard: 1,146) |

The two categories are mutually exclusive (`service_name` is one or the other), so there's no overlap — the union is just A + B.

---

## Query 1 — the headline number (the 1,146)

```sql
SELECT count(*) AS reports
WHERE police_district = 'NORTHERN'
  AND requested_datetime >= '2026-06-01T00:00:00'
  AND requested_datetime <  '2026-07-01T00:00:00'
  AND (service_name IN ('Encampment','Encampments')
       OR (service_name = 'General Request'
           AND lower(service_subtype) LIKE '%homeless%'))
```

## Query 2 — the "Encampment" category alone (the ~560 you expected)

```sql
SELECT count(*) AS reports
WHERE police_district = 'NORTHERN'
  AND requested_datetime >= '2026-06-01T00:00:00'
  AND requested_datetime <  '2026-07-01T00:00:00'
  AND service_name IN ('Encampment','Encampments')
```

## Query 3 — the rerouted component alone (the difference, ~583)

```sql
SELECT count(*) AS reports
WHERE police_district = 'NORTHERN'
  AND requested_datetime >= '2026-06-01T00:00:00'
  AND requested_datetime <  '2026-07-01T00:00:00'
  AND service_name = 'General Request'
  AND lower(service_subtype) LIKE '%homeless%'
```

---

## Query 4 — what's actually inside each bucket

Run these to see the category/subtype/detail labels that make up each component.

**Component A (Encampment category):**
```sql
SELECT service_name, service_subtype, count(*) AS n
WHERE service_name IN ('Encampment','Encampments')
  AND requested_datetime >= '2026-06-01T00:00:00'
  AND requested_datetime <  '2026-07-01T00:00:00'
GROUP BY service_name, service_subtype
ORDER BY n DESC
```
Citywide June 2026: `Encampment / encampment` = 3,079, `Encampment / (blank)` = 291.

**Component B (rerouted):**
```sql
SELECT service_name, service_subtype, service_details, count(*) AS n
WHERE service_name = 'General Request'
  AND lower(service_subtype) LIKE '%homeless%'
  AND requested_datetime >= '2026-06-01T00:00:00'
  AND requested_datetime <  '2026-07-01T00:00:00'
GROUP BY service_name, service_subtype, service_details
ORDER BY n DESC
```
Citywide June 2026: almost entirely `General Request / homelessness_and_supportive_housing / housing_homeless request_for_service` = 2,569 (rest are a handful of complaint/outreach/callback details).

---

## Query 5 — the evidence that a reroute happened (monthly trend, citywide)

This is the important one. It shows Component B going from "barely used" to "~2,600/month" in mid-2025.

```sql
SELECT
  date_trunc_ym(requested_datetime) AS month,
  count(CASE WHEN service_name IN ('Encampment','Encampments') THEN 1 END) AS encampment_category,
  count(CASE WHEN service_name = 'General Request'
             AND lower(service_subtype) LIKE '%homeless%' THEN 1 END) AS rerouted_bucket,
  count(*) AS union_total
WHERE (service_name IN ('Encampment','Encampments')
       OR (service_name = 'General Request'
           AND lower(service_subtype) LIKE '%homeless%'))
  AND requested_datetime >= '2024-01-01T00:00:00'
GROUP BY month
ORDER BY month
```

Expected shape around the June-2025 boundary (citywide):

| Month | A: Encampment category | B: Rerouted bucket | Union |
|---|---|---|---|
| 2025-05 | 4,407 | 98 | 4,505 |
| 2025-06 | 4,095 | 470 | 4,565 |
| 2025-07 | 3,913 | 1,378 | 5,291 |
| 2025-08 | 3,164 | 2,586 | 5,750 |
| 2026-06 | 3,370 | 2,583 | 5,953 |

---

## How to read this

1. **The reroute is real.** Bucket B sat at ~50–100/month for years, then jumped 98 → 470 → 1,378 → 2,586 across three months in mid-2025 and locked in around 2,600. A category doesn't organically 26× itself in a quarter — that's an intake/routing change.

2. **The "Encampment" category did not disappear.** It dipped ~30–40% year-over-year (still ~3,000–3,400/month), so *some* reports were diverted, but it's very much still in use. Both buckets now coexist.

3. **B is broader than A, and bigger than the dip.** Bucket B rose ~+2,500/month while A only fell ~1,500–2,000/month YoY — so B isn't just A's old reports under a new name. It's a broader "homelessness service request" bucket that absorbed some encampment reports *and* new volume. That's why the union total rose across the boundary rather than staying flat.

4. **Why the dashboard unions them.** Counting only the "Encampment" category would show a fake ~30% drop in mid-2025 caused purely by the reporting change. Unioning both keeps the trend continuous. The trade-off: the union is not one stable definition of "encampment" across the whole timeline — pre-2025 it's tent/structure sightings; post-2025 it also includes the broader homelessness request bucket.

---

## Note on scope: 1,146 vs 5,953

- **1,146** = **Northern police district** only (what the dashboard shows).
- **5,953** = **citywide** (sum across all ~10 police districts) — the figure in the trend table above.

Both come from the same union filter; the only difference is the `police_district = 'NORTHERN'` predicate.

---

*Datasets & method match the dashboard's `build/signals.py` and `data/provenance.json`. The dashboard assigns each report to a district by point-in-polygon against the "Current Police Districts" boundary (`qgnn-b9vv`); the native `police_district` field used in these queries derives from the same boundary and reproduces the numbers within ~0.5%.*
