# Plan — Cross-street search v2: baked authoritative SF intersection index

Enhances the hybrid search shipped in [`plan-cross-street-search.md`](plan-cross-street-search.md).
That plan's tier-3 fallback (Nominatim free-text geocode) is the failure the user reported: Nominatim
has **no real intersection index**, so `geocodeSF("16th & Mission, San Francisco, CA")` returns `[]`
for many valid corners → users get a dead "No results in SF". Confirmed in
`shared/transition-map.js:417 geocodeSF()`.

## Root cause
Tier 1 (hotspot cell) and tier 2 (reported marker) work because we have local coordinates. Tier 3
only fires for corners with **zero tracked activity** — exactly the corners not in our data — and it
delegates to a geocoder that can't do intersections. So the fallback fails precisely when it's needed.

## Decision (recommended)
Replace the flaky external fallback with a **baked, authoritative, complete SF intersection index**
pulled from DataSF at build time. Corners then resolve from a local file — instant, offline, no
runtime external dependency, same provenance ecosystem the dashboards already cite.

### Source (verified 2026-07-14)
`data.sfgov.org` dataset **`jfxm-zeee` — "Intersections by Each Cross Street Permutation"**
- 21,051 permutation rows over **9,430 distinct intersection nodes (`cnn`)**, **0 null coords**.
- Fields: `street_name_1`, `street_name_2`, `latitude`, `longitude`, `cnn`, `zip_code`.
- Refreshed daily (matched the 2026-07-14 refresh of the sibling Street Nodes/Centerline sets).
- Naming convention (`MISSION ST`, `16TH ST`, `LEAVENWORTH ST`) is the **same family** as the CFS
  `intersection_name` our markers already carry (`LEAVENWORTH ST / SUTTER ST`), so the existing
  `streetTokens()` normalizer (suffix-strip + ordinal-normalize) reconciles them with **no new
  matching logic**. Verified: `MISSION ST / 16TH ST` → tokens `{mission,16}` ⇔ query "16th & mission".
- Lists both name orderings; our matching is already order-independent (token sets), so we dedupe.

Nominatim is **removed entirely** (user decision 2026-07-14): search becomes purely local/offline.
The city index covers every real SF corner, which is the feature's entire purpose; single
addresses/landmarks were never the goal and were exactly where Nominatim was unreliable.

Rejected alternatives:
- **Keep/tune Nominatim** — it fundamentally lacks intersections; tuning the query won't fix `[]`.
- **Overpass API (compute street crossings live)** — accurate but adds a second external dependency,
  rate limits, and geometry math; a baked DataSF table is simpler and removes the network entirely.
- **DataSF `xhx7-spt9`/`gmfx-8h6i`** — `xhx7-spt9` is a dead legacy geo view (SODA 404); `gmfx-8h6i`
  is single-street nodes, not cross-street pairs. `jfxm-zeee` is purpose-built for this lookup.

## Build (new stage, shared across dashboards)
Intersections are signal- and dashboard-independent, so bake **once** into a shared asset.
- New script `build/build_intersections.py` (repo-root `build/`, or `shared/build/` — mirror existing
  build conventions). Pulls all `jfxm-zeee` rows (paged), dedupes by **sorted normalized token-pair**
  (drops the redundant reversed permutations; collapses 3-way nodes to their distinct pairs), keeps
  one lat/lng + a display name per pair.
- Output `shared/data/sf-intersections.json`, lean format mirroring the marker files:
  `{ "coordScale":100000, "rows": [[latE5, lngE5, "MISSION ST / 16TH ST"], ...] }`
  (~9–10k rows; est. ~450 KB raw → ~100 KB gzipped over GH Pages).
- Reuse the existing `httpget.get_json` + `$order=:id`/`$offset` paging pattern (see
  `drug/build/01_pull.py`); stdlib only. Record source + query + row count in `provenance.json`.
- **Deploy**: `.github/workflows/deploy.yml:82` copies only `shared/*.js` → add a step to copy
  `shared/data/` → `_site/shared/data/`, or the asset 404s in production.

## Frontend (shared, both dashboards + extensible to theft)
`shared/transition-map.js`
- Add a **lazy loader** `ensureCityIntersections()` — fetch once, cache; resolve the URL
  module-relative via `new URL('./data/sf-intersections.json', import.meta.url)` so it works from any
  dashboard without per-page wiring. Loaded only on a search **miss** against local activity data, so
  **zero page-load cost**.
- In `buildIntersectionIndex()` / `searchIntersections()`: after tier-1/2 local match fails, search
  the baked city index (same token-subset match + ranking already used). New result status:
  `{ status:'city', lat,lng,name }`.
- **Remove Nominatim entirely** (user decision 2026-07-14). Delete `geocodeSF()`, `SF_VIEWBOX`, the
  `fetch` to nominatim.openstreetmap.org, and the OSM/Nominatim attribution wording added for it.
  Search is now purely local/offline: local activity index → baked city index → `none`. A query with
  no city match (gibberish, typo, or a non-intersection address/landmark) returns `status:'none'`.

`shared/hotspots-panel.js`
- Route `status:'city'` → `showSearchResult(lat,lng,name)` + honest note
  **"No tracked activity at this corner."** (same wording intent as the old tier-3, now backed by an
  authoritative match rather than a lucky geocode).
- `status:'none'` now genuinely means "not a real SF corner" (e.g. gibberish / typo) — keep that copy.

## Known limitation — block-level attribution can undercut the "no activity" note (VALIDATED)
CFS dispatch snaps each call to the nearest **named street-network node**. Where a busy location sits
between nodes (e.g. the **16th & Mission BART plaza**), its activity is attributed to the adjacent
alley corners, not the marquee cross-street. Validated against source `2zdj-bwza` (within ~130 m of
16th/Mission): `16TH ST \ WIESE ST` = 33,011 calls, `16TH ST \ HOFF ST` = 7,795, `16TH ST \ CAPP ST`
= 5,920 (an "emerged" hotspot cell) — and **zero** under `16TH ST \ MISSION ST` (no such node gets
the calls). So a search for "16th & Mission" resolves to the real Mission-St node via the city index
and honestly-but-misleadingly reports "No tracked activity at this corner," when heavy activity sits
~30 m east under Wiese/Hoff/Capp.

This is a pre-existing property of the block-level data model (not introduced by this change), but it
undercuts the tier-3 note. **Proposed mitigation (optional, needs sign-off):** when a city-index hit
is within ~60–80 m of any tracked marker/cell in the active view, soften the note to e.g. *"No
activity logged at this exact corner — see nearby markers"* (or snap/zoom so the adjacent dots are
visibly in frame) instead of a flat "No tracked activity." Keeps the tier-3 note honest without
implying absence.

## Honesty guardrails (unchanged intent)
- "No tracked activity" only appears once we've located a **real** SF corner via the authoritative
  index — never implies absence of activity when we merely failed to match.
- Notes remain window/signal-scoped for tiers 1–2; city-index tier is activity-agnostic by definition.

## Acceptance criteria
- [ ] The user's confirmed Nominatim-failure corners now resolve from the index (verified present):
      **Laguna & Ellis** → `LAGUNA ST / ELLIS ST` (37.7830, -122.4276),
      **Fillmore & Clay** → `FILLMORE ST / CLAY ST` (37.7907, -122.4342).
- [ ] A real, zero-activity SF corner (e.g. a quiet residential intersection) now pans/zooms there
      with "No tracked activity at this corner" — the previously-failing case.
- [ ] "16th & Mission" / "Mission & 16th" still select the tracked hotspot (tier 1 unaffected).
- [ ] An active-but-not-hotspot corner still shows tier-2 note (tier 2 unaffected).
- [ ] Gibberish → "No results in SF"; index/network failure degrades gracefully (map never breaks).
- [ ] Baked index loads lazily (Network tab: not fetched until first search miss); shared by drug +
      unhoused; light + dark; no console errors; result marker still clears on Escape/new/district/scrub.
- [ ] `provenance.json` records the `jfxm-zeee` source + query + row count.

## Verify
- Build: run the new stage; assert `sf-intersections.json` row count ≈ 9–10k, spot-check that
  `MISSION ST / 16TH ST`, a known quiet corner, and a multi-way corner are present with correct coords.
- E2E (extend `validation/` trace + Playwright, both dashboards): quiet-corner success (the fix),
  hotspot match, active non-hotspot, gibberish; assert marker cleanup on district switch; 0 console errors.
- Confirm the previously-failing intersections the user saw (Nominatim `[]`) now resolve from the index.

## Rollout notes
- One-time size bump of the repo (~one baked JSON). If size is a concern, gzip is served by GH Pages;
  can also shard by first-street initial, but a single lazy file is simplest and well under budget.
- Extend to the theft dashboard trivially later (same shared asset + `wireSearch`).
