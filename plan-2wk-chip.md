# Plan — 2-week YoY change chip on homepage OKR KR tickers (workstream G)

**Status: DONE + verified.** Part of the `refresh-data-plus-search-intersections` single-PR bundle
(order A✔ D✔ C✔ E✔ → **G✔** → B → F). This doc moves into `docs/` in workstream F.

## What shipped
Every homepage KR ticker now shows **three** year-over-year change chips — **2wk / 1mo / 3mo** (fresh→stale) —
where before it showed only 1mo/3mo. Two coupled changes:

1. **New weekly series** baked into each `data/aggregates.json` (there was no weekly data anywhere).
2. **All chips switched to each signal's latest _settled_ endpoint** (per-signal, not per-dashboard) —
   a correctness fix: laggy signals (theft ~2mo, drug arrests ~1mo) previously read still-accruing months.

**User decision (locked):** *Show settled, footnote it.* Laggy signals anchor their 2wk chip to the latest
settled fortnight (sits weeks in the past); a new homepage footnote defines "settled" + why YoY.

## Data model (each `data/aggregates.json`)
- Top-level **`weeks[]`** — Monday-start ISO dates (`YYYY-MM-DD`). Date axis (not `YYYY-Www`) so the
  ~52-week-prior partner is a `−364-day` lookup that survives 53-week years; contiguity is a `+7d` check.
- Sibling **`series_weekly`** mirroring the monthly `series` shape (so `getKRData`'s shape-dispatch is reused):
  drug/unhoused = flat `[...]` per district + `Citywide`; theft = `{reported:[...]}` (reported-only — KR cards
  never show weekly arrests). Sibling to `series`, exactly like the untouched `series_tod`.
- Pointers: all three write `latest_complete_week` + `current_partial_week`; **drug + theft also** write
  `latest_settled_week` (+ informational `settle_lag_weeks`). unhoused omits settled (creation-stamped).

## Build changes
- **`week_start` / `week_axis` (+ `settled_week` for drug/theft)** duplicated into all 3 build scripts (mirrors
  the already-triplicated `month_axis`; no shared Python util exists).
- **Point path (offline, ZERO network)** — drug `cfs_drug`, all unhoused: re-bucket the assigned cache's
  per-event `date` by Monday week alongside the monthly rollup; emit `series_weekly` over `weeks[]`.
- **agg_only path (new daily SoQL)** — drug `dealer_arrests` (gated by `weekly=True` in signals.py), all theft:
  Socrata has no `date_trunc_yw`, so fetch `date_trunc_ymd` daily counts and bucket to Monday weeks locally.
  Theft weekly = `reported`-only. `citywide_only` signals emit `{"Citywide":[...]}` only.
- **`latest_settled_week`** = last week whose week-end (Mon+6) is strictly before the month AFTER
  `latest_settled_month` — anchors the fortnight horizon to the same month buffer the 1mo/3mo cards trust.
  **NOT** derived from `settling.p90_days` (measured 0 drug / 48 theft — below the product buffers).
- `settle_note` copy extended in drug + theft provenance to mention the settled fortnight.

## validation/validate_build.py
- `week_seq_ok(weeks)` (valid dates, consecutive 7 days apart), week-pointer membership, and a
  `series_weekly` length/sign/Citywide≥sum guard block — guarded by `if sig.get("series_weekly")`
  (else silently unvalidated like `series_tod`). Handles theft's nested `{reported}` shape.

## Homepage wiring (js/app.js + styles.css)
- **`getKRData`**: per-signal settle = `signal.settles ?? (data.latest_settled_month != null)` (drug bakes an
  explicit per-signal `settles`; theft/unhoused fall back to dashboard-level pointer). Anchor every chip to
  `(settles && latest_settled_month) || latest_complete_month`. `change2wk` from `series_weekly[district]`
  (same `.reported` extraction) at `anchorWeek`, paired via `nearestWeekIndex(weeks, anchorWeek, -364)`.
- **`renderKRTicker`**: third badge + `2wk` header col that links to `#home-methodology`.
- **`fetchEmergingSignal`** (live wg3w-h783 KR3 badges): moved endpoint back 2 months to the settled boundary
  (⚠️ shifts existing 1mo/3mo emerging numbers ~2mo — intended per the locked decision), added a 14-day
  settled-fortnight pair (+ its −364d partner). Returns `change2wk`.
- **`renderMethodology`**: two new paragraphs defining "settled", why YoY, and the lag caveat.
- **styles.css**: `.kr-ticker__badges` is flexbox (not grid) with matching `2.8rem` min-widths, so a 3rd item
  aligns automatically — only added `.kr-ticker__col--link` styling for the `2wk` header link.

## Verification (all green)
- Rebuilt all 3 (no count cliffs). `validate_build.py` — weekly guards pass. `parity.mjs drug|unhoused` +
  `trace.py drug|theft` — unchanged (worst Δ 0.00%). Full `npm test` = **46 passed, 1 skipped** (the known
  pre-existing CLS `test.fixme`). New homepage e2e asserts header cols `['2wk','1mo','3mo']` + 3 badges on a
  baked row, with live emerging counts stubbed for a hermetic `errors===[]`.
- Spot-check of `change2wk` on real baked data: cfs_drug/encampment anchor the complete week; dealer_arrests
  (2026-05-25) / theft (2026-04-20) anchor their settled weeks; partners land exactly 52 weeks prior.
  (dealer_arrests 2wk swings hard — inherent small-denominator noise on a 2-week window, shown honestly.)

## Critical files
`js/app.js` · `styles.css` · `drug/build/03_rollup.py` · `drug/build/signals.py` ·
`unhoused/build/03_rollup.py` · `theft/build/build.py` · `validation/validate_build.py` ·
`homepage/tests/e2e.spec.js`
