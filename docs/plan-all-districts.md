# Expand dashboards to all 10 SF police districts

> Grow the site from the current **4 districts** (Northern, Central, Mission, Tenderloin) to **all 10
> SFPD districts**, across the homepage (`index.html`) and the three linked dashboards
> (`./unhoused`, `./drug`, `./theft`) — plus the auxiliary `./districts` view, which reuses the same
> baked data.

**Base branch:** this work lives on branch **`alldistricts`** (cut off `main`). The `aisummary`
feature is unrelated and out of scope — see [§AI summaries](#ai-summaries--deferred).

---

## Status — updated 2026-08-14 · **Phase 1 shipped ✅**

> **Fresh-session pickup:** Phase 1 (data) is complete and validated on branch `alldistricts`. All 10
> SFPD districts are baked into every artifact; the three big dashboards' frontends still hardcode the
> original 4 (intended data-first split). **Next up is Phase 2** (centralize the district list + swap
> tab rows for a Citywide-default dropdown). Start there.

### What's done (Phase 1)

| Item | State |
|---|---|
| `TARGET_DISTRICTS`/`DISTRICTS` widened to all 10 in `{drug,unhoused,theft,districts}/build/signals.py` | ✅ |
| 6 new `DISTRICT_REGION` codes added (Southern 1, Bayview 2, Park 7, Richmond 8, Ingleside 9, Taraval 10) — verified vs `wg3w-h783` | ✅ |
| Theft hardcoded `'Northern'` bug fixed — `vehicle_detail_queries(sig, district)` now per-district; frontend indexes by active district (`theft/js/app.js:292`) | ✅ |
| All 4 pipelines rebuilt (aggregates, provenance, points, markers, transitions, 10-feature geojson, shoplifting map) | ✅ |
| True-citywide confirmed independent of shown-district set (theft citywide 11,703 vs sum-of-10 11,675, as designed) | ✅ |
| Validation clean — `validate_build.py`, `parity.mjs`, `trace.py` all reconcile at 0.00% | ✅ |
| Stale `districts/tests/smoke.spec.js` assertions fixed (5→11 cards & focus tabs; districts view auto-follows data) | ✅ |
| Full e2e + validation suite: **52 passed, 1 skipped, 0 failed** | ✅ |

### Build/run notes for next session

- **TLS:** Python.org 3.14 framework build lacks CA certs — **`export SSL_CERT_FILE=/etc/ssl/cert.pem`**
  is required for every build, `trace.py`, and `npx playwright test`.
- **`cd` persists** between Bash tool calls — use repo-relative paths (e.g. `unhoused/build`) when hopping between build dirs.
- **Commit still pending:** Phase 1 edits + regenerated data are uncommitted (git mutations are run by
  the user). Suggested: `git add docs/plan-all-districts.md {drug,unhoused,theft,districts}/ && git commit`.

### Next up — Phase 2 (see full detail below)

1. **`shared/districts.js`** — canonical ordered list + area groups + hash/lowercase helpers; delete the
   ~5 duplicated frontend `DISTRICTS` arrays (`index.html`→`js/app.js:5`, `drug/js/app.js:39`,
   `unhoused/js/app.js:41`, `theft/js/app.js:16`, `districts/js/app.js`). Add a `validate_build.py`
   assert that the JS list == baked `aggregates.json.districts` so they can't drift.
2. **Dropdown + Citywide default** — replace `.district-tabs` with a grouped `<wa-select>` whose first
   option is "Citywide (all)"; extend the existing hash router with `#citywide`/empty as default.
3. **Citywide landing** — homepage KR tickers read `series['Citywide']`; emerging-signal live query
   drops the `AND police_district=…` clause when Citywide is active.
4. **Saved-interventions filter** — point it at `shared/districts.js` so the 6 new districts stop
   bucketing to `'Other'`.

---

## Locked decisions (from kickoff Q&A)

| Decision | Choice |
|---|---|
| **District navigation** | Replace the horizontal tab row with a **dropdown** (`<wa-select>`), grouped by area, **plus an explicit "Citywide / All" option that is the default landing**. Citywide = **true citywide** (all SF incidents), *not* the sum of the shown districts. |
| **Per-district KR#3** | **Omit** the bespoke 3rd theft-OKR KR for the 6 new districts. Keep `DISTRICT_KR3` only where it already exists (Northern/Central/Mission/Tenderloin). New districts launch with the 2 shared KRs. |
| **Rollout** | **Data-first, phased.** P1 rebuild all baked data → P2 centralize district list + nav → P3 polish. Each phase independently shippable. |
| **AI summaries** | **Deferred / graceful-empty** for new districts. The summaries feature itself lives on the `aisummary` branch and is not part of this work. |

---

## The 10 districts + verified region codes

The full 10-district boundary set **already exists** upstream at
`../emergent-map/data/sidecar/police_districts.geojson` (dataset `qgnn-b9vv`, "Current Police
Districts"). Today the builds **trim** it to `TARGET_DISTRICTS`; expanding is mostly a matter of
widening that list and rebaking.

`:@computed_region_qgnn_b9vv` codes below were re-derived from `wg3w-h783` (dominant code per
district, 2024→present). The existing 4 match the baked `DISTRICT_REGION` maps exactly. These codes
feed the **reader-facing verify links only** — they do not change any displayed number.

| District | Region code | In scope today? |
|---|---|---|
| Southern | 1 | **new** |
| Bayview | 2 | **new** |
| Mission | 3 | existing |
| Northern | 4 | existing |
| Tenderloin | 5 | existing |
| Central | 6 | existing |
| Park | 7 | **new** |
| Richmond | 8 | **new** |
| Ingleside | 9 | **new** |
| Taraval | 10 | **new** |

Suggested dropdown grouping (area labels, cosmetic only):
- **Central/North:** Central, Northern, Tenderloin
- **South/East:** Southern, Mission, Bayview, Ingleside
- **West:** Park, Richmond, Taraval

---

## Current state — what has to change (grounding)

**Two different district-assignment mechanisms** (both must scale, but neither needs redesign):
- **Point-in-polygon** (ray-cast in `02_assign.py`) — `unhoused`, `drug`'s `cfs_drug` point signal,
  and `districts`. The Socrata `WHERE` filters by *topic*, not district; district is assigned locally
  after the pull. Adding districts = keeping more points + drawing more polygons. Build-time cost only.
- **Native `police_district` field, server-side** — `theft` (all signals) and `drug`'s arrest
  signals (`wg3w-h783`). Adding districts = more loop iterations over the district list.

**The 4-district list is duplicated in ~7 places** (no single source of truth) — this is the biggest
correctness hazard and the main P2 refactor:

| Location | What it is |
|---|---|
| `index.html`→`js/app.js:5` | homepage `DISTRICTS` |
| `drug/js/app.js:39` | dashboard `DISTRICTS` |
| `unhoused/js/app.js:41` | dashboard `DISTRICTS` |
| `theft/js/app.js:16` | dashboard `DISTRICTS` |
| `districts/js/app.js` | dashboard district list |
| `drug/build/signals.py:34` | `TARGET_DISTRICTS` + `DISTRICT_REGION:47` |
| `unhoused/build/signals.py:21` | `TARGET_DISTRICTS` + `DISTRICT_REGION:32` |
| `theft/build/signals.py:19` / `theft/build/build.py:459` | `DISTRICTS` loop |

**Homepage-only coupled structures** (`js/app.js`):
- `DISTRICT_KR3` (line ~46) — bespoke 3rd theft KR per district. Per decision: **do not** add the 6.
- `EMERGING_SIGNALS` (~93) / `KR_TO_OKR` (~80) — only touched if a new KR#3 signal is introduced;
  since we're omitting KR#3 for new districts, **no change needed** here.
- `savedInterventions` filter (~532) buckets unknown districts to `'Other'` → they never show. Once
  the 6 are valid districts this self-resolves, but verify the filter uses the centralized list.

**Frontend geometry:** `drug/js/app.js:576` and the unhoused/districts maps fetch
`./data/police_districts.geojson` (the trimmed file). The build rewrites this file, so it auto-expands
to 10 once `TARGET_DISTRICTS` grows. `theft` has no geojson (intersection lat/lng only).

**One live-query path:** `shared/recent-activity.js` fetches recent rows live within the active
district's bbox and does client-side point-in-polygon against the dashboard's own geojson. Works
per-district already; just needs bboxes/geometry for the new districts (comes free from the expanded
geojson).

**Data footprint** grows ~2.5×. Today: `unhoused/data` 16M, `districts/data` 9M, `drug` 2.1M, `theft`
88K — all point/marker files are **deferred-loaded** per district, so first paint is unaffected, but
repo size and the `dist/` snapshot grow. Watch this in P1.

---

## Phase 1 — Data (builds) · *ship first*

Goal: every baked artifact carries all 10 districts. No UI changes yet; dashboards keep showing 4
until P2 widens the frontend list, but the data is ready and validated.

1. **Widen the build district sets** (keep existing order, append the 6):
   - `drug/build/signals.py` `TARGET_DISTRICTS` + `DISTRICT_REGION`
   - `unhoused/build/signals.py` `TARGET_DISTRICTS` + `DISTRICT_REGION`
   - `theft/build/signals.py` `DISTRICTS`
   - `districts/build/signals.py` district list
   - New `DISTRICT_REGION` entries: `Southern:1, Bayview:2, Park:7, Richmond:8, Ingleside:9, Taraval:10`.
2. **Fix theft's hardcoded `'Northern'`** in verify/provenance links (`theft/build/build.py:315`
   `vehicle_detail_queries`, and `:487`) — these currently emit Northern's query regardless of the
   district shown. Parameterize by the active district. (Latent bug; expansion is the moment to fix.)
3. **Rebuild each pipeline** (per each dashboard's README):
   - `drug`, `unhoused`, `districts`: 5-stage `01_pull → 02_assign → 03_rollup → 04_transitions →
     05_markers` (run from `<dash>/build/`). `02_assign` auto-writes the 10-district
     `police_districts.geojson`.
   - `theft`: single `python3 theft/build/build.py`.
4. **Confirm a true-citywide aggregate exists** in each dashboard's `aggregates.json` for the
   homepage's Citywide default (P2 needs `series['Citywide']` for drug/unhoused/theft KR tickers).
   Citywide = the **unfiltered** count (all SF), not a sum of the shown districts — see the locked
   decision under Risks. `districts` already emits Citywide; verify/add it for the other three in
   `03_rollup` / `build.py`.
5. **Validate — stop and report on any mismatch** (per repo refresh policy):
   ```
   python3 validation/validate_build.py
   node validation/parity.mjs drug        # and unhoused
   python3 validation/trace.py drug       # and unhoused — headline numbers re-derived from Socrata
   ```
6. **Record the data-weight delta** (`du -sh */data`) in the PR; if any single deferred point file gets
   unreasonably large, note a follow-up (e.g. thinning old points) — do not silently ship a size cliff.

---

## Phase 2 — District list + navigation (UI)

Goal: surface all 10 districts through a scalable selector, defaulting to Citywide.

1. **Centralize the district list.** New module `shared/districts.js` exporting the canonical ordered
   list (+ area groups + lowercase/hash helpers). Import it in `index.html`/`js/app.js` and each
   dashboard `app.js`; delete the local `DISTRICTS` arrays. Builds keep their own Python list, but it
   must match order — add a validation assert (`validate_build.py`) that the JS list == the baked
   `aggregates.json.districts` for each dashboard so they can't drift.
2. **Replace the tab row with a dropdown + Citywide** (shared pattern, applied on homepage + all
   dashboards):
   - `<wa-select>` with grouped `<wa-option>`s; first option **"Citywide (all)"**.
   - Keep the existing **hash router** (`#mission`, …) and add `#citywide` (or empty hash) as the
     Citywide default. `popstate` + `syncUrlHash` already exist — extend, don't replace.
   - Retire `.district-tabs`/`.district-tab` CSS; add `.district-select` styles (light + dark, listens
     to the existing `themechange` event where redraws are involved).
3. **Citywide landing behavior:**
   - **Homepage:** OKR cards + KR tickers read `series['Citywide']`. Emerging-signal live query drops
     the `AND police_district=…` clause when Citywide is active.
   - **Dashboards:** Citywide = the existing all-district aggregate (the `./districts` view already
     models this). Maps show all polygons; per-district drill stays via the dropdown.
4. **Saved-interventions filter:** ensure it uses `shared/districts.js`; the 6 new districts stop
   falling into the `'Other'` bucket automatically once they're valid list members.
5. **Optional:** add a homepage link to `./districts` (currently unlinked) if the Citywide view should
   be reachable there too — decide during P2.

---

## Phase 3 — Polish

1. **AI summaries — graceful-empty** for the 6 new districts (see below). Card hides or shows a
   "summary not yet available" state; no generation in this work.
2. **Verify links** use the new `DISTRICT_REGION` codes (already added in P1) — spot-check a couple of
   new-district verify links round-trip to the baked number (<0.5%, per the point-in-polygon note).
3. **e2e tests:** extend Playwright specs (`*/tests/`, `tests/` homepage) to cover a new district
   (e.g. Bayview) and the Citywide default — dropdown selection, hash routing, KR tickers populate.
4. **README:** update the district count / scope language.

---

## AI summaries — deferred

The AI-summary feature (`shared/ai-summary.js`, `shared/ai-summaries/*.json`, `docs/plan-ai-summaries.md`)
is **experimental and lives on the `aisummary` branch** — it should have branched off `main` and is not
part of the all-districts expansion. This plan targets `main`, so on the all-districts branch the
summary card is either absent (if built from `main` before that feature merges) or shows a graceful
empty state for districts without a baked summary. Generating summaries for the 6 new districts is a
**follow-up**, to be done after the summaries feature itself lands on `main`.

---

## Risks & open questions

- **Citywide semantics — LOCKED: true citywide.** "Citywide" means *all SF incidents* (the unfiltered
  count / all 10 districts), **not** the sum of only the districts with tabs. This matters even
  mid-rollout: Citywide is correct from day one regardless of how many districts have their own view.
  Homepage KR tickers still need a `series['Citywide']` in drug/unhoused/theft aggregates — produce in
  P1 (item 4) as the unfiltered aggregate, matching `./districts`. For the point-in-polygon signals
  (unhoused/drug cfs), "citywide" = every retained point regardless of which polygon it fell in (or
  the raw pulled count); for native-field signals (theft/drug arrests), drop the `police_district`
  clause entirely rather than summing per-district queries.
- **Data weight.** ~2.5× growth; deferred-loaded so CWV-safe, but repo + `dist/` snapshot grow. Measure
  in P1; thin points only if a file is egregious.
- **Point-in-polygon build time** for unhoused/districts grows with more retained points — build-time
  only, acceptable.
- **10-option dropdown UX** on mobile — verify `<wa-select>` grouping + dark mode; the current tab CSS
  is being retired, so no half-migrated state.
- **Region-code drift** — codes re-verified 2026-08-14 against `wg3w-h783`; re-verify if the boundary
  version (`qgnn-b9vv`) ever changes.

---

## Files touched (checklist)

**P1 (data):** `{drug,unhoused,theft,districts}/build/signals.py` · `theft/build/build.py`
(hardcoded Northern) · rebuilt `*/data/aggregates.json`, `*/data/provenance.json`, `*/data/points/*`,
`*/data/markers/*`, `*/data/transitions/*`, `{drug,unhoused,districts}/data/police_districts.geojson` ·
`validation/validate_build.py` (list↔data assert).

**P2 (UI):** new `shared/districts.js` · `js/app.js` (homepage) · `{drug,unhoused,theft,districts}/js/app.js`
· `styles.css` + `{drug,unhoused,theft,districts}/styles.css` (dropdown in, tabs out) · saved-interventions
filter.

**P3 (polish):** AI-summary empty state · e2e specs (`*/tests/`, homepage `tests/`) · `README.md`.

---

## Validation & rollout

- Per-phase: `python3 validation/validate_build.py`, `node validation/parity.mjs {drug,unhoused}`,
  `python3 validation/trace.py {drug,unhoused}`, `npm test` (all e2e + invariants + parity).
- On any validation mismatch (source drift or count cliff): **stop and report**, don't auto-commit.
- Deploy is test-gated GitHub Pages (`.github/workflows/deploy.yml`); nightly source↔data trace
  (`trace.yml`).

---

## Getting this doc onto a branch off `main`

The working tree is on `aisummary` with uncommitted changes; this doc is a new untracked file. To land
**only this doc** on a fresh branch off `main` without disturbing the `aisummary` WIP:

```bash
git branch all-districts main                       # branch off main (don't switch yet)
git stash push -u -- docs/plan-all-districts.md      # set the doc aside
git checkout all-districts
git stash pop
git add docs/plan-all-districts.md
git commit -m "Plan: expand dashboards to all 10 SF police districts"
# back to your experimental work when ready:
git checkout aisummary
```
