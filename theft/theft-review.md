# Theft dashboard — pre-share review

Reviewed 2026-08-06 against the `dashboard-review` skill (accuracy > clarity > never reach for drama).
Scope: the full theft dashboard as rendered (Northern default), including the new completeness/settle
work. Source of truth: `theft/data/aggregates.json` + `provenance.json`, reconciled live by
`validation/trace.py theft`.

## Headline

**Accuracy is in good shape.** `trace.py theft` reconciles every baked monthly series (shoplifting,
commercial, vehicle — reported + arrests + citywide) against live Socrata at **0.00%** through the latest
settled month, and modeled figures (completeness %, lag percentiles) are labeled as estimates. No wrong
numbers found. Findings below are **clarity / consistency / verifiability**, not bad data — ranked by how
much they could mislead or erode trust.

## Ranked findings

| # | finding | dimension | severity | status |
|---|---------|-----------|----------|--------|
| 1 | Completeness/lag figures (97% ≤30d, median 0d, p90 6d, n=408, ~98% complete) have **no reader-facing source link** — the one figure family a skeptic can't check | 4 verifiability | **Medium** | ✅ Done |
| 2 | Methodology footnote renders **both** the "solid" bar and June's completeness as "~98%" — the rule reads circular, and disagrees with the card note's "~98.5%" | 3/6 consistency | **Medium** | ✅ Done |
| 3 | Vehicle card shows **"11% ▲ vs 11% all-time avg"** — up-arrow contradicts two equal displayed numbers | 3/5/6 encoding | Med-Low | ✅ Done |
| 4 | July peek shows **"0 · ~96% complete"** for commercial — a completeness tag on a zero count reads as "more coming" | 6 headline fidelity | Low | ✅ Done |
| 5 | Reclassification stated as near-certainty ("almost certainly reclassified"; "reflects reclassification … not a real change") — an inference presented as established mechanism | 7 tone / 1 accuracy | Low | ✅ Done |
| 6 | Settled-month explanation told ~3× (callout + methodology footnote) in heavily overlapping language | 8 earn-its-place | Low | ✅ Done |
| 7 | Vehicle type bars unsorted (Auto/Truck/Motorcycle/Other, but Motorcycle 14% > Truck 7%) | 5 encoding | Low (optional) | ✅ Done |

## Resolution log (applied 2026-08-06 — all 7 confirmed by user)

- **1 & 6 (combined).** `reporting_lag()` now bakes a `lag_query_url` (reported + arrests axes) — the raw incident/report-date rows over the exact reference window; verified round-trip (reported → 408 rows = baked `n`; arrests → 238). The `settle_note` footnote was rewritten to be the **methods home** (window + n, both runnable links, completeness labeled *derived*, arrest p90) and no longer restates the callout's plain-language "why". The callout ([app.js](js/app.js) `renderReportingNote`) gained a `how we measure this ↗` `.fnref` to `#fn-settled`.
- **2.** `settle_note` prints the bar via `~{solid_threshold_pct}%` (→ **98.5%**) instead of `:.0f` (→ 98%); June stays `~98%`. Bar now matches the card note and no longer looks circular.
- **3.** Share arrow ([app.js](js/app.js) `renderCard`) now compares the **rounded displayed** integers (`Math.round(share*100)`), so "▲ vs" only shows when the printed numbers actually differ; equal → `▬`.
- **4.** Peek gated on `reported[completeIdx] > 0`; commercial (newest-month 0) now suppresses its peek. e2e updated: 1–3 peeks, each with a non-zero count.
- **5.** [signals.py](build/signals.py) `EXCLUDED`: "almost certainly reclassified" → "consistent with reclassification"; "reflects reclassification … not a real change" → "consistent with reclassification … rather than a real change".
- **7.** Vehicle type bars sort by count descending, with the "Other" residual pinned last.

**Verification:** `build.py` clean; `trace.py theft` = 0.00% (series unchanged); theft e2e 9/9; homepage e2e 6/9 (+1 pre-existing CLS skip).

---

## Detail

### 1. Completeness/lag figures have no reader-facing source link  *(Dimension 4 — Medium)*
- **Location:** `#reporting-note` callout + methodology "Latest settled month" footnote.
- **Problem:** Every card *count* exposes a "run the query ↗" link, but the reporting-lag / completeness
  family — "97% within 30 days (median 0d, p90 6d)", "n=408", "~98% complete", "p90 242d" for arrests —
  has none. It's the one set of figures a skeptic can't independently check.
- **Why it matters:** Dimension 4 treats verifiability as a core deliverable, and says reviewer-side
  verification isn't sufficient — the *reader* needs the path. These are also the figures that justify
  the whole settled-month choice, so they're worth backing.
- **Proposed change:** Add a "how this is measured ↗" link next to the lag stat that runs the reporting-lag
  pull (the Aug 2024–Jul 2025 window: `SELECT incident_date, report_datetime WHERE (merchant subcats) AND
  police_district='Northern' AND resolution='Open or Active' AND incident_date >= <lo> AND < <hi>`),
  labeled as the raw data behind the derived percentiles. The completeness % itself is modeled (no single
  query returns it) → label it derived and point at the method (plan doc / the lag query), don't fake an
  exact-match link.

### 2. "~98%" bar vs "~98%" value collision in the footnote  *(Dimension 3/6 — Medium)*
- **Location:** methodology "Latest settled month" footnote (from `provenance.settle_note`, `build.py`).
- **Problem:** The footnote uses `:.0f` on both the 98.5% threshold and June's 98.1% completeness, so it
  reads: *"evaluate the newest one that clears **~98%** complete. Today that is 2026-06 — estimated
  **~98%** complete."* Bar and value are printed identically, so June appears to "clear" a 98% bar at
  exactly 98% — the logic looks circular. The card `#reporting-note` says **"~98.5%"** for the same bar,
  so the two surfaces disagree.
- **Why it matters:** Undercuts trust in the very rule we just built; a careful reader notices the numbers
  don't add up.
- **Proposed change:** Print the threshold at one-decimal precision (`98.5%`) everywhere; keep June at
  `~98%`. One-line change to the `settle_note` f-string (drop `:.0f` on the threshold).

### 3. "11% ▲ vs 11% all-time avg" (vehicle share)  *(Dimension 3/5/6 — Med-Low)*
- **Location:** vehicle card "Northern share of SF" (`renderCard` share block, `shareArrow`).
- **Problem:** The arrow fires when `dShare > 0.005` (0.5pp), but both `shareNow` and `shareAvg` render at
  integer precision, so an 11.4% vs 10.9% gap shows as "11% ▲ vs 11%" — an up-arrow between two identical
  numbers.
- **Why it matters:** Reads as a contradiction / rendering bug and invites doubt about the other arrows.
- **Proposed change:** Gate the arrow on the *rounded displayed* values (show ▬/neutral when they're
  equal), or render share to one decimal so the arrow and numbers agree. Prefer the former (less visual
  noise). Same fix protects shoplifting/commercial from the same edge in future refreshes.

### 4. "0 · ~96% complete" July peek (commercial)  *(Dimension 6 — Low)*
- **Location:** `.primary__peek` on the commercial card (`renderCard`).
- **Problem:** Commercial's newest-month count is 0, so the peek shows "Jul 26 so far **0** · ~96%
  complete" — a completeness tag on a zero implies ~4% more is inbound when ~96%-of-0 is ~0.
- **Why it matters:** Minor, but reads oddly on a low-volume card and slightly overstates "data still
  arriving."
- **Proposed change:** Suppress the peek line (or drop just the % tag) when the newest-month count is 0.

### 5. Reclassification stated as near-certainty  *(Dimension 7 / 1 — Low)*
- **Location:** `#exclusion-note` ("almost certainly reclassified into the Shoplifting taxonomy") and the
  methodology "Excluded" footnote ("the drop reflects reclassification … not a real change on the ground").
- **Problem:** The collapse of the legacy code is real and query-backed, but *reclassification* is an
  inferred mechanism, stated as established fact.
- **Why it matters:** The skill prefers letting the data speak; an unproven causal mechanism asserted flatly
  is exactly the kind of over-claim to soften. Low because the inference is reasonable and the decline is
  linked.
- **Proposed change:** Soften to "consistent with reclassification into the Shoplifting taxonomy" / "most
  likely reclassification." Keep the runnable query.

### 6. Settled-month story told ~3×  *(Dimension 8 — Low)*
- **Location:** `#reporting-note` callout **and** methodology "Latest settled month" footnote — overlapping
  prose (both explain the lag curve, the ~98% bar, the arrests tail).
- **Why it matters:** Redundancy adds cognitive load; the skill biases toward removal.
- **Proposed change:** Keep the prominent callout as-is; trim the footnote to the *incremental* detail
  (exact reference window, arrests p90, the new source link from #1) rather than restating the whole rule.
  Low — the two audiences (at-a-glance vs. methods reader) partly justify the repeat, so this is optional.

### 7. Vehicle type bars unsorted  *(Dimension 5 — Low / optional)*
- **Location:** vehicle detail "What kind of vehicle" (Auto 69 / Truck 7 / Motorcycle 14 / Other 10).
- **Problem:** Bars aren't in descending order (Motorcycle 14% sits below Truck 7%).
- **Proposed change:** Sort descending (Auto, Motorcycle, Truck, Other), or leave if the vehicle-class
  ordering is intentional. Purely cosmetic; no accuracy impact.

---

## Verified as sound (no change)
- **Denominators (Dim 2):** "Northern share of SF" numerator (Northern reported, Open-or-Active) and
  denominator (citywide reported, Open-or-Active) are the same universe. No funnels, no overlapping sums.
- **Chart encoding (Dim 5):** line charts zero-based (0/42/84 etc.); map circles area-proportional
  (`r = 4 + 20·√(n/max)`). Vehicle type mix sums to 100% of typed with the ~18%-excluded caveat adjacent.
- **Recency (Dim 3):** "built 2026-08-06" as-of line; dataset + id named; arrests evaluated at their own
  −2 month so a fresher reported headline never marks provisional arrests as settled.
- **Tone (Dim 7):** section titles descriptive ("Where shoplifting reports concentrate", "How this is
  measured"); verdicts neutral ("held about flat"); no drama intensifiers.
- **Primary source (Dim 1):** `trace.py theft` = 0.00% across all series; the single-store reporting caveat
  is baked into the map's static HTML.
