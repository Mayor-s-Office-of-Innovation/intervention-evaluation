# Dashboard review — post-refresh (2026-07-14 data pull)

Reviewed: `drug/`, `unhoused/`, `theft/` + homepage, after refreshing to 2026-07 data
(commit `f96f972`). Source integrity was independently confirmed: `validation/trace.py`
reconciles every signal against its declared Socrata query at **0.00%** drift, and
`validate_build.py` + `parity.mjs` + all e2e suites pass. So Dimensions 1 & 4 (primary-source
verification, source-link coverage) are satisfied by the harness; this pass focused on
recency/consistency, denominator integrity, partial-month handling, and tone.

## Findings

| # | Finding | Dimension | Severity | Status |
|---|---------|-----------|----------|--------|
| 1 | unhoused displacement map folds the partial current month (Jul, ~43% elapsed) into its 3-month "now" rate, undisclosed → false-cooling bias | 3 Recency / 6 Fidelity | **High** | **Done (option A)** |
| 2 | drug and unhoused displacement maps use different now-window conventions for the same visual (drug excludes partial month, unhoused includes it) | 3 Consistency | Medium | **Resolved by #1** |
| 3 | theft `~7×` 2024-crackdown claim is a baked narrative number (historical/settled — not stale, but the one hardcoded stat in the decks) | 6 Fidelity | Low | Keep (no change) |
| 4 | `theft/build/__pycache__/*.pyc` is tracked in git; no `__pycache__` ignore rule | hygiene | Low | Deferred (user: don't worry about it) |

**Resolution (2026-07-14):** #1 fixed via option A — `INCLUDE_PARTIAL_MONTH = False` in
`unhoused/build/04_transitions.py`, transitions rebuilt, revalidated (invariants + parity + e2e all
pass). Effect: encampment `emerged` 176→211, `cooled` 93→90, district tides rose (Central 2.45→3.0,
Mission 1.78→2.13) — confirming the partial month had been suppressing the "now" rate. #2 resolved by
the same change (both maps now analyze through the last complete month). #3 kept (factual, settled).
#4 deferred per user.

---

### 1. Partial current month distorts the unhoused displacement map (High)
**Location:** [unhoused/build/04_transitions.py:51](unhoused/build/04_transitions.py#L51)
(`INCLUDE_PARTIAL_MONTH = True`); map rendered from `unhoused/data/transitions/*.json`.
No consumer reads the `latest_month_partial` flag in `_meta.json` (grep of `unhoused/js/*.js`
+ `shared/*.js` finds no reference), so the map gives the viewer no partial-month cue —
unlike the time-series chart, which fades + labels the partial bar ([shared/chart.js:108](shared/chart.js#L108)).

**The problem:** the map's "now" rate = trailing 3 months ÷ 3, and the newest month is the
in-progress July. As of this build July has ~14 days of data:

| month | encampment reports |
|-------|--------------------|
| 2026-04 | 598 |
| 2026-05 | 618 |
| 2026-06 | 611 |
| 2026-07 | **264** (partial) |

nowRate with partial July = (618+611+264)/3 ≈ **498/mo**; with the three *complete* months
(Apr–Jun) it's ≈ **609/mo** — a **~18% downward bias**. Because cells are classified against a
fixed hot-rate threshold, this systematically pushes cells toward **cooled** and away from
persistent/emerged, and drags the per-district "tide" numbers down.

**Why it misleads:** the map reads as "activity is cooling across the city since Lurie" when much
of the drop is just the half-empty current month. The bias is worst right after a **mid-month**
refresh and self-heals as the month fills in.

**Why it looks fine in the code:** the flag was set 2026-06-29, when the partial month (June) was
~97% complete — the bias was then negligible. The choice ("freshness over the partial-month
false-drop guard") was reasonable *at end-of-month* but is materially distorting *mid-month*.

**Proposed change (pick one, needs your call — accuracy change, not auto-applied):**
- **(A) Recommended — set `INCLUDE_PARTIAL_MONTH = False`.** Analyze through the last *complete*
  month (Jun), matching drug. Costs ≤1 month of freshness on the map only; removes the bias and
  the inconsistency in one move. Rebuild `04_transitions.py` + revalidate.
- **(B) Keep True but guard**: only include the partial month once it's ≥~90% elapsed (e.g. skip it
  before day ~27); otherwise fall back to last complete month.
- **(C) Keep True, disclose**: surface a visible "now window ends in an in-progress month
  (Jul, partial — rate reads low)" caveat on the map and have the frontend read
  `_meta.latest_month_partial`. Keeps freshness but arms the viewer.

### 2. Two maps, two now-window conventions (Medium)
**Location:** drug/build/04_transitions.py (last complete month) vs
[unhoused/build/04_transitions.py:51](unhoused/build/04_transitions.py#L51) (includes partial).
Same visual (the "since-Lurie" hot/cold displacement map), two different definitions of "now."
Resolving #1 via option (A) also resolves this. If #1 is resolved via (B)/(C), document the
divergence in both plan.md files so it reads as a deliberate choice, not drift.

### 3. theft `~7×` crackdown claim is baked prose (Low)
**Location:** [theft/index.html:90](theft/index.html#L90) — "a 2024 crackdown spiked arrests ~7×
while business reports barely moved." This is a fixed historical statement about 2024 (settled
data), so the refresh does **not** invalidate it, and the tone is factual (not editorial) — **keep
as-is**. Logged only because it is the single hardcoded quantitative claim across the three decks;
worth re-verifying against the data on any future methodology edit so it can't silently drift.

### 4. Tracked `.pyc` build artifact (Low, hygiene — not a dashboard-accuracy issue)
**Location:** `theft/build/__pycache__/signals.cpython-314.pyc` (changed in `f96f972`); root
`.gitignore` has no `__pycache__` rule. It re-churns on every build and adds noise to data-refresh
diffs. Proposed: add `__pycache__/` + `*.pyc` to `.gitignore` and `git rm -r --cached` the tracked
copies. (drug/ and unhoused/ `__pycache__` are already untracked — only theft's slipped in.)

---

## Not findings (checked, clean)
- **Headline KR cards** (all three dashboards + homepage) are computed live from `aggregates.json`
  and shade the partial/unsettled month — they auto-update correctly with the refresh.
- **Denominator integrity:** no funnel/ratio conflation introduced; combined signals (drug
  `arrest_mix`, unhoused `cfs_presence`) expose their components per the provenance convention.
- **Tone:** intensifier sweep across the three `index.html` files found only benign UI-label
  "only"s and the factual theft description — no editorializing headers.
- **Homepage:** reads each dashboard's `aggregates.json` live; district emerging signals fetched
  live in-browser. Nothing baked, nothing stale.
