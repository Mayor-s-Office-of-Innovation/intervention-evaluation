# Plan — make district figures reproducible via their query link

**Goal (plain version):** when a reader clicks the "query ↗" link next to a district number, the query that opens should return **that number** (or essentially it). Today it doesn't.

**Source finding:** `docs/dashboard-review-findings.md` → U1 / U3.
**Standing conventions:** user runs all git/gh himself; no fixes applied without confirmation.

---

## The problem, concretely

- District figures (e.g. Tenderloin encampment = **642/mo**) are computed in the build by a hand-rolled **point-in-polygon** (`unhoused/build/02_assign.py`) against the `qgnn-b9vv` "Current Police Districts" boundary.
- The "query ↗" links shown on each district page ([unhoused/js/app.js:512-527](../unhoused/js/app.js#L512-L527), sourced from `provenance.json`) are **citywide, monthly** queries — they have **no district filter**. So on the Tenderloin page, the link returns a *citywide* series, not 642.
- Net: a skeptical reader can't verify any district number. (Nothing here has been changed yet — the links are still citywide.)

## What we established (see U1 for full table)

- Our point-in-polygon reproduces the authoritative Socrata spatial join `:@computed_region_qgnn_b9vv` (same `qgnn-b9vv` boundary) to **<0.5% in every district**, Tenderloin included (baked 642 vs computed-region 645).
- The `police_district` **text** field is a *different* assignment (~10% off in TL) — **we are not using it.**
- Both `vw6y-z8j6` (311) and `2zdj-bwza` (911) carry the `:@computed_region_qgnn_b9vv` column, so every point-based signal can get a district-filtered query link.
- Region→district code map (2026-06, to re-verify before baking): **1=Southern, 3=Mission, 4=Northern, 5=Tenderloin, 6=Central** (+ the outer districts for any we display).

---

## Two ways to close it — **decision needed**

### Option A — keep every displayed number exactly as-is; add a district-filtered "≈" link
- Add `AND :@computed_region_qgnn_b9vv = '<code>'` to each district's query link (bake a per-district `query_url` in `provenance.json`).
- Clicking Tenderloin's 642 opens a query returning **645** — footnote it: "boundary spatial join; within ~0.5% of our point-in-polygon count."
- **Pro:** zero change to any published number; low risk. **Con:** not an *exact* round-trip (off by a few reports); needs the honest ± footnote.

### Option B — make the district count itself the computed-region number (exact round-trip) ⭐ recommended
- Change the baked district **counts/series** to come from the `:@computed_region_qgnn_b9vv` Socrata GROUP BY (what the link returns), so clicking 645 returns **645** exactly — the skill's gold standard.
- Keep point-in-polygon **only** for map-cell placement (the hexbin needs each report's lat/lng); footnote that map cells sum to ±0.5% of the headline.
- **Pro:** true exact verifiability; lets the district-count path stop depending on the hand-rolled polygon. **Con:** displayed district numbers shift by **<0.5%** (e.g. TL 642→645, Northern 1146→1145, Central 611→610, Mission 1267→1267) — tiny, but it *is* a number change, so it needs your explicit sign-off.

> My lean: **B.** The change is negligible (≤3 reports/district/month) and it's the only option where "click the number → get the number" is literally true. But A is a legitimate choice if you'd rather freeze the published numbers.

---

## ✅ DECISION (2026-07-28): **Option A** (user — "A seems fine and less work")

Freeze every displayed number exactly as-is; add a district-filtered computed-region link that returns ~the number, footnoted "≈ boundary spatial join, <0.5% vs our point-in-polygon." **Zero metric change.** Implementation follows "Common to both" + "Option A only" steps below. Skip all Option B steps.

---

## Implementation (steps depend on A vs B)

### Common to both
1. **Resolve the region→district code map authoritatively** — query each displayed district's known boundary count and lock the numeric code (don't trust the 2026-06 snapshot alone). Store the map in the build.
2. **Bake per-district `query_url`s** into `unhoused/data/provenance.json` for every point-based signal, each with `... AND :@computed_region_qgnn_b9vv = '<code>'` and the district's date window frozen in.
3. **Render the district-specific link** on each district page instead of the citywide one ([unhoused/js/app.js:512-527](../unhoused/js/app.js#L512-L527)) — pick the `query_url` for the `active` district.

### Option A only
4a. Add the ± footnote next to the district source links ("boundary spatial join; ~0.5% vs our point-in-polygon").

### Option B only
4b. In `unhoused/build/03_rollup.py`, source district **counts/series** from the computed-region query rather than the point-in-polygon tally; keep point-in-polygon for cell placement only. Footnote the map-vs-headline ±0.5%.
5b. **Stop-and-report** the exact before/after number delta per district before committing (expected <0.5%, but confirm no surprise).

### Verification (both)
- Rebuild → `python3 validation/validate_build.py`, `node validation/parity.mjs unhoused`, `python3 validation/trace.py unhoused` (green).
- **Manually click each new district link** and confirm the returned count matches the displayed number (exact for B, within footnoted ± for A).
- `npx playwright test --project=unhoused`, then `npm test`.

---

## Scope note — same pattern elsewhere (not in this plan unless you want it)
The identical "link doesn't reproduce the displayed number" issue also appears as:
- **DR2** (drug): signals lack adjacent reproducible source links. → **planned below.**
- **H1** (homepage): the 2wk chip isn't reproducible on any dashboard.
- **Theft dim-4:** source-link coverage not yet swept.

These share the fix philosophy (add a link that returns the shown number) but touch different files. Recommend doing **unhoused first** (this plan), then folding the others in once the pattern is proven. Flag if you want them bundled here instead.

---

# DR2 — reproducible district source links on the DRUG dashboard

**Status:** plan drafted 2026-07-28, verification done, **awaiting go-ahead**. Same philosophy as unhoused U1 above; the drug dashboard is *per-page district* (no in-page Citywide view — `active` is always a concrete district set from the URL hash), so the UI wiring is simpler.

## What's wrong today
`drug/js/app.js` `renderMethodology` (the `row()` helper, [drug/js/app.js:453-456](../drug/js/app.js#L453)) renders `p.query_url` from `provenance.json` — a **citywide, monthly** query for every signal. On the Tenderloin page, clicking a signal's "query ↗" returns a *citywide* series, not the district number shown. No district figure is reader-verifiable.

## Key insight — drug splits into two assignment methods, so two link kinds
| Signal(s) | Dataset | Baked district count comes from | District-scoped link | Round-trip |
|---|---|---|---|---|
| `dealer_arrests`, `paraphernalia`, `other_drug_arrests` | `wg3w-h783` | `rollup_agg` `GROUP BY police_district` (native field) | `AND police_district = '<Title>'` | **EXACT** |
| `cfs_drug` | `2zdj-bwza` | hand-rolled point-in-polygon (`_assigned.json`) | `AND :@computed_region_qgnn_b9vv = '<code>'` | **~0.5%** (spatial-join approx) |
| `needles` | `vw6y-z8j6` | citywide only (no district split) | none — keep citywide `query_url` | n/a |

## Verified live (2026-07-28, month 2026-05)
- **Arrests round-trip EXACTLY:** dealer filter + `police_district = 'Tenderloin'`, `count(distinct incident_id)` → **43**, matches baked `dealer_arrests.Tenderloin[2026-05] = 43`. `police_district` values are **Title Case** ("Tenderloin", "Mission", "Central", "Northern") — an exact match for the dashboard's district labels.
- **cfs_drug via computed-region matches:** cfs_drug filter + `:@computed_region_qgnn_b9vv = '5'` → **201**, matches baked `cfs_drug.Tenderloin[2026-05] = 201` (tied exactly this month; footnote ~0.5% since the spatial join is an approximation of the point-in-polygon, not guaranteed exact every month).
- **Region code map (re-verified, same as U1):** Northern=4, Mission=3, Central=6, Tenderloin=5.

## Changes

### Build — `drug/build/signals.py`
1. Add `DISTRICT_REGION = {"NORTHERN":"4","MISSION":"3","CENTRAL":"6","TENDERLOIN":"5"}`.
2. Extend `query_url(sig, where=None, region=None, district=None)`:
   - `region` → append `AND :@computed_region_qgnn_b9vv = '<region>'`.
   - `district=(field,value)` → append `AND <field> = '<value>'`.
   - Precedence-safe: every `where` is a chain of top-level ANDs (dealer's `AND (a OR b)`, other's `AND NOT (…)`, cfs's ANDs), so appending one more `AND term` needs no extra parens.

### Build — `drug/build/03_rollup.py`
3. Import `DISTRICT_REGION`; add `query_url_by_district(sig, where=None)`:
   - `district_field` present (arrests) → `{label: query_url(sig, where, district=(dfield, label))}` (exact).
   - `kind == "point"` (cfs_drug) → `{label: query_url(sig, where, region=code)}` (~0.5%).
   - else (`citywide_only`, needles) → `None`.
4. `_store_provenance`: add `"query_url_by_district": query_url_by_district(sig)`. (Optionally the `arrest_mix` group members in `build_groups` too — the composition note only, low priority.)

### UI — `drug/js/app.js`
5. In `renderMethodology`, add `const scoped = p => (p.query_url_by_district && p.query_url_by_district[active]) || p.query_url;` and use `scoped(p)` in `row()`. `needles` has no `query_url_by_district`, so it correctly falls back to citywide.
6. Add a one-line disclosure to the methodology: *on a district page, arrest queries are scoped by SFPD's own `police_district` field (returns the exact number shown); the community-report (cfs_drug) query is scoped by the police-district boundary spatial join (`:@computed_region_qgnn_b9vv`), within ~0.5% of the point-in-polygon figure shown.*

## The one decision — how to regenerate provenance without a metric change ✅ DECIDED
`query_url_by_district` is a **pure function of `signals.py`** (dataset + where + region/field) — it needs no fetched data. But `03_rollup.py` regenerates `aggregates.json` **and** `provenance.json` together from a fresh live pull, which risks shifting displayed numbers (settling) as an unwanted side effect of DR2.
- **✅ DECISION (2026-07-28, user): Option 1 — patch `provenance.json` only.** A tiny no-refetch script imports `signals.py` + the new `query_url_by_district` and injects the key into the existing `provenance.json`. `aggregates.json` stays byte-identical → **zero metric change**. The build-code change (steps 1-4) is the durable fix that the next real rebuild will carry.
- ~~Option 2: re-run `03_rollup.py` (fresh pull) then diff — not chosen (couples DR2 to a data refresh).~~

## ✅ DR2 DONE (2026-07-28)
All checklist steps complete and verified:
1. ✅ `signals.py` — added `DISTRICT_REGION` + `region=`/`district=` params on `query_url`.
2. ✅ `03_rollup.py` — added `query_url_by_district(sig)` (in `signals.py`) + stores it in `_store_provenance`.
3. ✅ No-refetch patch (`/tmp/patch_provenance_dr2.py`, Option 1) → `provenance.json` gained `query_url_by_district`; `aggregates.json` **byte-identical (sha-verified)**.
4. ✅ `drug/js/app.js` — `scoped(p)` helper in `renderMethodology` + the exact-vs-~0.5% disclosure paragraph.
5. ✅ Verified: `validate_build.py` green (4 dashboards); `trace.py drug` all 5 signals Δ0.00%; **all 16 district links round-trip at worst Δ0.00%** (cfs_drug computed-region tied exactly, beating the disclosed ~0.5%); `node --check` OK; `npm test` 48/48 pass (1 skipped).
6. ✅ `docs/dashboard-review-findings.md` DR2 row + detail section flipped to Done.

## Verification
- `python3 validation/validate_build.py` (+ `trace.py drug` if it checks provenance links) green.
- Re-click Tenderloin's cfs_drug + dealer links → confirm 201 / 43 (already spot-checked).
- `node --check drug/js/app.js`; `npx playwright test --project=drug`; then `npm test`.
- Update `docs/dashboard-review-findings.md` DR2 row → Done.
