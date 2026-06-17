# Time Scrubber + Validation Hardening — Implementation Plan

Status: **approved design, pre-implementation.** Built first on `drug`, then extracted to a shared
lib and adopted by `unhoused`; `theft` gets only the card chips (no map → no scrubber).

---

## 1. What we're adding

A **time scrubber** that lets a viewer choose the period being analyzed. The selected window
drives the hot/cold **map** (cells reclassify, markers filter); the **chart** *hosts* the selection
(it already shows all of time); the **cards** stay decoupled as a "where things stand now" header.

The map's difference-in-differences becomes **parametric**: instead of a single fixed Lurie split,
any analysis window is compared to a **fixed pre-Lurie 24-month baseline**, normalized by the
district tide recomputed over that window.

---

## 2. Design decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Baseline = fixed pre-Lurie 24-mo normal** (2023-01→2024-12), unchanged. | Long baseline washes out seasonality (2 summers). Anchors every comparison to the pre-intervention normal — the right frame for an *intervention-evaluation* tool. Equal-length-immediately-prior was rejected: short symmetric windows reintroduce seasonality. |
| D2 | **Analysis window** scrubbable, Lurie→latest, **min 3 months**, default = **full Lurie era** (Jan 2025→latest complete). | Min length guards short-window noise. Default makes the "since Lurie" label finally match the math (today it's mislabeled "last 3 months"). |
| D3 | **District tide recomputed over the selected window.** | Cancels the analysis window's own seasonality via the difference-in-differences (common seasonal movement cancels). |
| D4 | **Window drives only the MAP.** Chart hosts the selection (band); cards ignore it. | The chart already *is* the time axis — filtering it makes no sense. The map is a snapshot with no time axis, so the window must compute it. Cards = "now". |
| D5 | **Cards: latest-month total + verdict pill + 1/3/12 momentum chips.** | People value the latest-month number; keep it as the anchor. Chips = trailing-N total vs the prior N-month block (the 12-mo chip == today's trend). One consistent definition; short ones tooltip'd "not season-adjusted". Verdict stays the authoritative read. |
| D6 | **Chart = the scrubber**: brush (drag) + preset chips (`Since Lurie · Last 12 mo · Last 3 mo · All`). Band marks the selection; **bars stay fully lit** (no dimming). | Brush reuses the existing window-band scaffolding ([chart.js:74-80](js/chart.js#L74-L80)). Presets carry the common cases and make the chart's time-selectability discoverable. |
| D7 | **Cells: build emits ALL candidate blocks + full monthly; classification moves to the browser.** | Today only window-relevant cells are emitted ([04_transitions.py:138-161](build/04_transitions.py#L138-L161)), so arbitrary windows would miss blocks. The browser becomes the source of truth; Python becomes a parity oracle. |
| D8 | **Layout spine: cards → chart → map → dashboard panel → methodology.** Move drug's `composition` and unhoused's `hsoc-block` **below the map**. | Consistent interface across drug + unhoused. |
| D9 | **theft: no map → no scrubber.** Gets only the new card chips. | With cards decoupled and the chart not filtered, the window has zero consumers on theft (fixed-place stores, no displacement map). |
| D10 | **Reuse: build on `drug` → extract shared lib → adopt `unhoused` → theft chips only.** | Build-first-extract-later: the abstraction's seams aren't knowable until the feature exists. `data.js`/`rollup.js` are already byte-identical drug↔unhoused; `transition-map.js` ~3 lines apart. |

### Expected, intentional change
The default map colors **shift** (last-3-mo → whole Lurie era) because the default analysis window
changes. The **baseline is unchanged**, so this is not a regression — it's the "since Lurie" label
becoming honest. Methodology copy must be rewritten to describe the parametric window.

---

## 3. Information architecture

```
Cards    "where things stand now"  — latest month + verdict + 1/3/12 chips   [ignores window]
  ↓
Chart    all of time + the scrubbing instrument (brush + preset chips)        [HOSTS the window]
  ↓
Map      selected window vs fixed pre-Lurie baseline (cells + markers)        [DRIVEN by window]
  ↓
Panel    composition (drug) / hsoc-block (unhoused), below the map
  ↓
Methodology
```

The whole feature is, in one line: **a time-control for the map, operated on the chart.**

---

## 4. The parametric difference-in-differences (client-side classifier)

Port of [04_transitions.py:135-161](build/04_transitions.py#L135-L161) into `classify.js`:

For a chosen analysis window `[winLo, winHi]` and the fixed baseline `[baseLo, baseHi]` (pre-Lurie):
- `preRate = mean(cell.monthly[baseLo..baseHi])`, `nowRate = mean(cell.monthly[winLo..winHi])`
- `tide[district] = districtNowRate / districtPreRate` (from the aggregates district series, same window)
- `expected = preRate * tide[district]`; `rose = nowRate > expected*(1+BAND)`, `fell = <  expected*(1-BAND)`
- classify persistent / emerged / cooled exactly as the Python does; gate on `hot` rate + `FLOOR`.

**Guardrails:** min window length (3); clamp at history edges; floor scales with window length to
tame short-window noise; tide read uses the aggregates district series aligned to the cell axis.

⚠ **Axis-mismatch landmine:** `transitions/_meta.months` = 41 (ends 2026-05) but `aggregates.months`
= 42 (includes the partial 2026-06). The tide read MUST align these deliberately — see V3.

---

## 5. Implementation phases

**Phase 0 — Build emits the full cell universe (`drug`, reversible).**
Edit [04_transitions.py](build/04_transitions.py): drop the window-gated emit filter; emit *every*
block with all-time total ≥ FLOOR as `{lat,lng,name,district,total,monthly[]}`. Keep the baked
`category/preRate/nowRate/expected` as a **parity oracle**. Export knobs + `pre_window` in `_meta.json`.
Re-run; check cell-count growth (92 → few hundred) and JSON size.

**Phase 1 — Client classifier + parity gate (`drug`).**
`classify.js` (§4). Tide from `aggregates.signals[sig].series[district]`. **Gate:** default-preset
JS categories == baked Python, cell-by-cell, before anything user-facing ships. (See V2.)

**Phase 2 — Window state + chart-as-scrubber (`drug`).**
`win={lo,hi}` in app.js (default Jan 2025→latest, min 3, clamp right edge per signal settling).
Brush on `#chart` + preset chip row; debounced `setWindow`.

**Phase 3 — Map consumes the window (`drug`).**
Reclassify + recolor cells; refilter markers (window solid / baseline faded / outside hidden);
recompute tide note; rewrite map copy. Add `{lo,hi}` to the deep-link URL. Throttle redraw on drag.

**Phase 4 — Card redesign (`drug`, parallelizable).**
Latest-month total + verdict + new 1/3/12 chip row (`momentumN` helper in `rollup.js`; n=12 reuses
the trend math). Goal-aware coloring; tooltip on the short chips.

**Phase 5 — Layout reorg.** Move `composition` below the map (drug) and `hsoc-block` below the map
(unhoused) → shared spine (D8).

**Phase 6 — Extract shared lib + adopt `unhoused`.** `shared/`: `data.js`, `rollup.js`, `chart.js`,
`classify.js`, brush/scrubber, `transition-map.js`. `app.js` stays per-dashboard. Apply the same
`04_transitions.py` change to `unhoused/build`. Extract the shared build validator (V1).

**Phase 7 — `theft`.** Card chips only (no map, no scrubber). Uplift theft's older `chart.js` only if
needed for the chips.

---

## 6. Validation hardening (all levels)

Today validation is thin: no build-time checks (one `raise` in a helper), an implicit/unversioned
data contract, a single boot `try/catch`, and Playwright smoke tests that **don't run in CI** and —
for `drug` — **point at the wrong dashboard** ([drug/playwright.config.js:11](playwright.config.js#L11),
[drug/tests/e2e.spec.js:4](tests/e2e.spec.js#L4) both target `/unhoused`). Deploy is ungated.

### P1 — makes the port safe (build *with* the feature)

- **V1 · Build-time invariants** (`validate.py`, run at the end of stages 03/04; non-zero exit on
  violation): series length == months; counts ≥ 0 and non-None; `citywide ≥ sum(target districts)`;
  contiguous monotonic month axis; `latest_complete`/`latest_settled` ∈ months; `cell.monthly`
  length == axis and reconciles to `cell.total`; coords within the SF bbox; `provenance.records > 0`.
  Shared across drug/unhoused (Phase 6).
- **V2 · JS==Python parity harness.** Assert `classify.js` == baked Python at the default preset,
  cell-by-cell; then fuzz ~20 random windows for invariants (every classified cell ∈ candidate set;
  counts ≥ 0; no cell both emerged & cooled). Fast feedback for the classifier port.
- **V3 · One shared month-axis + explicit alignment assertion** so transitions↔aggregates indices
  cannot silently diverge (the 41-vs-42 landmine in §4).

### P2 — cheap, high leverage

- **V4 · Unit tests for the pure math** — `sumRange`/`windowYoY`, the new `momentumN`, and `classify`.
  Zero-dep, fast; currently nonexistent though they produce every number on the page.
- **V5 · Fix drug's e2e targeting** + add a guard so it can't recur silently: each suite asserts a
  dashboard-specific marker (its own title / a unique signal label) so a mis-pointed config fails loud.
- **V6 · `schema_version`** on the data files + a frontend check that refuses a mismatch with a clear
  message instead of throwing deep in render.
- **V7 · Offline UI↔data assertions (Playwright).** Load a district page; assert the rendered headline
  card / tooltip / detail numbers equal the `aggregates.json` values (incl. `toLocaleString`). This is
  hop ② of the trace below — deterministic, no network, every CI run. Directly guards the scrubber's
  index math (the 41-vs-42 axis, window slicing, classifier reads).

### P3 — infrastructure

- **V8 · CI test job** running all dashboard Playwright suites + unit (V4) + parity (V2) on PR/push,
  **gating deploy** (today [deploy.yml](../.github/workflows/deploy.yml) runs no tests).
- **V9 · Root `test:all`** so `npm test` covers the dashboards (today it runs only `hypothesis`).

### E2E source↔data trace (the "is it externally TRUE?" check) — **spiked, working**

The deepest check: re-derive a headline number straight from the source by running the dashboard's
*own declared query* (`provenance.query_url`), and reconcile it against the data file and the UI.
Catches the one class of bug invariants/parity can't: internally consistent but **false** (filter
drift, dedup, district casing, wrong index).

```
Socrata (live) ──①──▶ aggregates.json ──②──▶ rendered UI number
   query_url            trace.py (network)     Playwright (offline = V7)
```

- **Hop ① · source↔data (network, tolerant, NIGHTLY / on-demand):** [validation/trace.py](../validation/trace.py).
  Citywide settled months only; presence exact, enforcement 3% tolerance; curl fallback for cert gaps.
  **Spike result (2026-06-13 bake):** all 5 drug signals reconcile, worst Δ 0.00% — point *and*
  agg_only, settling *and* not. Provenance is a rich-enough contract.
- **Hop ② · data↔UI (offline, exact, EVERY CI run):** = V7 above.

Split by cadence: ② gates every PR (fast, deterministic); ① is a nightly canary (slow, flaky network),
never on the PR critical path. The same trace philosophy extends to the map: a cell's displayed
`nowRate` should reconcile to its `monthly[]` slice → to its point markers → to source.

### Scope into this feature vs. fast-follow
- **In this feature:** V1, V2, V3, V5, V7, V8 (the classifier-safety + frontend-index guards + CI gate)
  and the nightly hop-① canary (already spiked).
- **Fast-follow:** V4 (broaden unit coverage), V6 (schema_version), V9 (root runner) — valuable but not
  blocking the scrubber.

---

## 7. Testing strategy summary

| Test | Layer | Cadence | Catches |
|------|-------|---------|---------|
| Build invariants (V1) | build | every build | malformed/negative/misaligned data |
| JS==Python parity (V2) | classifier | every CI | classifier port drift |
| Axis alignment (V3) | build+client | every build/CI | the 41-vs-42 index landmine |
| Pure-math unit (V4) | rollup/classify | every CI | window/momentum/classify math |
| e2e structural + no-console-errors (V5) | UI | every CI | render regressions, mis-pointed suites |
| UI↔data exact (V7, hop ②) | UI↔data | every CI | wrong series/index/format |
| source↔data trace (hop ①) | source↔data | nightly | filter drift, dedup, "true but stale" |

---

## 8. Open risks

- **Python classifier becomes parity-only** — slight maintenance cost; mitigated by V2 keeping it honest.
- **Short-window noise** — mitigated by min-3-month floor + length-scaled floor + tide normalization.
- **Nightly trace flakiness** — slow `LIKE` scans on Socrata; keep off the PR path, generous timeout.
- **app.js drift** — the heaviest duplication; keep per-dashboard, extract only the stable core (Phase 6).
