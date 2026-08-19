# Dashboard review — all-districts expansion (`alldistricts`)

> Review of the reader-facing changes in commit `00406bb` before opening the PR to `main`.
> Scope: what a viewer actually sees change. **Headline: the expansion is accurate, correctly
> sourced, and honestly framed.** No accuracy defects found. The items below are minor
> clarity/cleanup calls — none block the PR.

## What actually changed for a reader

The changeset is mostly rebuilt *data* (all 10 districts baked into every artifact). But the
frontends were almost untouched, so the reader-facing surface is narrow:

| Surface | Districts shown to reader | Changed? |
|---|---|---|
| `districts/` view | **10 + Citywide** (reads `state.agg.districts` dynamically) | **Yes — the one live surface** |
| homepage / `drug` / `unhoused` / `theft` | still the hardcoded **4** | No (intentional Phase-1 data-first split) |
| verify-link region codes (all provenance) | 6 new codes baked | Baked, **not yet rendered** (big-three show 4) |
| theft "run the query" footnote | correct district | Improved (see F3) |

## Verifications that PASSED (recorded so they aren't re-litigated)

- **Region codes — all 10 correct.** Re-verified live against `wg3w-h783` (2024→present, dominant
  `:@computed_region_qgnn_b9vv` per district): Southern 1, Bayview 2, Mission 3, Northern 4,
  Tenderloin 5, Central 6, Park 7, Richmond 8, Ingleside 9, Taraval 10 — exact match to the values
  committed in `*/build/signals.py`. The plan's "verified 2026-08-14" claim holds.
- **Citywide is a true independent count, not a sum.** `districts/build/03_rollup.py` pulls Citywide
  straight from Socrata unfiltered. Denominator-clean — numerator (district) and denominator
  (citywide) are the same universe.
- **No silent 10-district leak.** homepage/drug/unhoused/theft frontends iterate their hardcoded
  4-list, never baked `agg.districts`; drug's "citywide context" reads `series.Citywide` (unchanged
  by the expansion). Nothing on those surfaces changed numerically.
- **Tone is neutral.** `districts/` methodology is descriptive ("Observational, not causal — counts
  reflect reporting behavior as well as conditions on the ground"); no editorial drama introduced.

---

## Findings (ranked)

| # | Finding | Dimension | Severity | Status |
|---|---|---|---|---|
| F1 | 10 district cards + a Citywide card invite a sum that lands ~0.1–0.35% short | Denominator integrity / clarity | Low–Med | **Done** |
| F2 | `districts/` has no per-signal runnable "run the query" verify link | Source-link coverage | Low (pre-existing) | Deferred |
| F3 | Baked theft `query_url` still hardcodes `'Northern'` (frontend ignores it) | Source-link hygiene | Low (cleanup) | **Done** |
| F4 | Data/UI phase mismatch: data has 10, three dashboards show 4 | Consistency / scope | Info | No change (intended) |

> **Applied 2026-08-18.** F1 + F3 fixed and verified: `py_compile` + `node --check` pass,
> `signal_query` fully removed (no dangling refs), theft source-trace reconciles at 0.00% on all 3
> signals, and 14/14 districts+theft e2e tests pass (incl. theft footnote runnable-query links).
> No numbers changed. F2/F4 left for Phase 2 per discussion.

---

### F1 — The 10-districts + Citywide layout invites a sum that doesn't quite reconcile
**Location:** `districts/js/app.js:162–177` (card grid + `${(sh*100).toFixed(0)}% of citywide` sublabel)
**Problem:** With only 4 districts shown, no reader would sum them to citywide. Now that all 10 SFPD
districts are shown (they tile the whole city) alongside a Citywide card *and* each card shows
"X% of citywide," a skeptical reader will naturally add the 10 cards / 10 shares and expect them to
equal the Citywide card / 100%.

They don't, quite. Sum-of-10 vs true Citywide (last 12 baked months):

| Signal | sum/city |
|---|---|
| encampment | 99.65% |
| encampment_only | 99.76% |
| waste | 99.92% |
| needles | 99.83% |
| cfs_sitlie | 99.97% |
| cfs_homeless | 99.92% |
| hsoc | 99.94% |

**Why it (mildly) misleads:** the gap is real and *correct* — a few tenths of a percent of reports
have imprecise coordinates that fall outside every district polygon, and Citywide counts them while
the districts can't. But the new layout newly invites a reconciliation, and a viewer who does the
math and finds 99.7% may distrust the numbers rather than understand the geocoding gap.
**Proposed change:** one sentence in `renderMethodology()` (matches the existing honest tone), e.g.
*"Reports are assigned to a district by point-in-polygon; a small share with imprecise coordinates
fall outside all district boundaries, so district counts won't sum exactly to the citywide total."*
No number changes. **This is the only finding I'd actively recommend acting on before launch.**

### F2 — `districts/` exposes dataset links + method prose, but no per-signal runnable query
**Location:** `districts/index.html:104–112`, `districts/js/app.js:300` (`renderMethodology`)
**Problem:** Unlike drug/unhoused/theft (which give a "run the exact query ↗" link per signal), the
`districts/` view offers only top-level dataset links (`vw6y-z8j6`, `qgnn-b9vv`) plus a prose method
note. A reader can't one-click reproduce a shown district number.
**Why it's low:** (a) pre-existing — not introduced by this branch; (b) these signals are assigned by
local point-in-polygon, so *no* single Socrata link round-trips exactly anyway (the methodology
already says so). **Proposed change (optional):** add a citywide "verify: all SF reports of this
type ↗" link that returns ≈ the Citywide number, and label district counts as point-in-polygon
derived. Defer unless you want parity with the other three.

### F3 — Baked theft `query_url` still hardcodes `'Northern'`
**Location:** `theft/build/build.py:488` — `query_url(signal_query(sig["where"], "Northern"))`
**Problem:** The plan intended to fix this alongside `vehicle_detail_queries` (:315). It's still
Northern-hardcoded in the baked provenance.
**Why it's low (not the reader-facing bug it looks like):** the theft frontend deliberately **ignores**
this field and rebuilds the "run the query" link client-side per active district
(`theft/js/app.js:381–393`, `districtQueryUrl(s.filter, active)`), and the trace harness uses the
separate `citywide_query_url`. So no reader ever sees a wrong-district link. It's a vestigial baked
field. **Proposed change:** either parameterize it per-district (like `detail_queries`) or drop the
field entirely so the JSON doesn't carry a misleading value. Cleanup, not a correctness fix.

### F4 — Data/UI phase mismatch (informational)
**Location:** repo-wide — 10 districts baked; `js/app.js:5`, `drug/js/app.js:38`,
`unhoused/js/app.js:40`, `theft/js/app.js:14` still list 4.
**Problem:** none for a reader today — no surface shows both, so there's no visible inconsistency.
Recording it so it's not mistaken for a bug: this is the intended Phase-1 (data-first) state per
`docs/plan-all-districts.md`. The 6 new districts become discoverable only when Phase 2 lands the
`shared/districts.js` refactor + dropdown. **No change** — flagged so a future reviewer doesn't
"fix" the 4-lists piecemeal and half-ship it.

---

## Recommendation
Ship the PR. Consider **F1** (a one-line methodology sentence) before/with launch since it's the only
item touching what a reader could misread; **F3** is a good cleanup to fold in; **F2/F4** are
defer-able. No numbers need changing.
