# Dashboard-review — drug + unhoused post-refresh (2026-08-06)

Scope: data-accuracy double-check after the 2026-08-06 refresh (not a full from-scratch audit —
both dashboards were reviewed at build time). Focus dimensions: **primary-source verification,
recency/internal-consistency, round-trip link hygiene.**

## What's already solid (verified this pass)
- **Every displayed figure ties to source.** `trace.py drug` + `trace.py unhoused` reconcile all
  settled months at **0.00% drift**; `validate_build.py`, `parity.mjs`, and e2e (drug/unhoused/
  homepage) all green.
- **Recency is fully data-driven.** "Data current to…", evaluated-month, and settled/partial-month
  shading all render from `PROV.generated` / `AGG.latest_settled_month` / `AGG.latest_complete_month`
  — they update automatically, nothing hardcoded.
- **KR checklist headers** are qualitative (↓ Reduce / ↑ Increase) — no baked targets to go stale.
- **Homepage** carries no hardcoded drug/unhoused figures; it reads each `aggregates.json` live.
- **Source links** are dataset-level (`/d/<id>`) and stable; provenance queries use fixed
  `>= '2023-01-01'` windows, so they stay round-trip verifiable across refreshes.
- **Routing caveats spot-checked live and still accurate:** Sit/Lie "~87%" (actual 87.0%),
  Homeless-Complaint "~84%" (actual 84.1%).

## Findings

| # | finding | dimension | severity | status |
|---|---------|-----------|----------|--------|
| 1 | Needles caveat "fell **~19%** year-over-year" is now **−15.2%** after the refresh | recency/accuracy | Medium | **Resolved — 1(A)** |
| 2 | HSOC caveat "**~75%** of it is the same records" is now **68.0%** | recency/accuracy | Medium | **Resolved — 2(A)** |
| 3 | Paraphernalia caveat "this category **tripled**" is now ~3.7–4.9× (still true, conservative) | accuracy | Low | **Left as-is (decision)** |

**Decisions applied 2026-08-06:** chose the durable option for #1 and #2 — dropped the driftable
numbers from `signals.py`, re-ran `03_rollup.py` for both dashboards, re-validated (validate_build +
parity + e2e all green; no stale figures remain in baked data). #3 left as "tripled" (still true).
- Needles caveat now: *"needle reports have fallen year-over-year (and ~4× since 2018)…"*
- HSOC caveat now: *"…so the majority of it is the same records already counted…"*

---

### Finding 1 — Needles YoY figure drifted (Medium)
**Location:** [drug/build/signals.py:191](../drug/build/signals.py#L191) → baked into `drug/data/provenance.json` `needles.caveat`, rendered in the drug methodology.
**Problem:** Caveat reads "needle reports fell **~19%** year-over-year." That was a trailing-12
YoY that was correct through 2026-06 (−19.4%). The refresh added 2026-07; the window shifted and it
is now **−15.2%** (trailing-12 to 2026-07). Calendar-year 2025 vs 2024 is −10.4%.
**Why it misleads:** States a specific decline that no longer matches the data — a skeptic re-running
the series gets ~15%, not ~19%. It will keep drifting every refresh because it's hand-typed.
**Proposed change (pick one):**
- **(A, durable — recommended)** Drop the exact number: *"needle reports have fallen year-over-year
  (and ~4× since 2018)…"* The precise % isn't load-bearing here — the caveat exists to justify
  *excluding* needles from the trend, not to report a headline. Removes the re-drift for good.
- **(B)** Update `~19%` → `~15%`. Accurate today, but drifts again next refresh.
- **(C, most robust)** Compute the trailing-12 YoY in `signals.py` from the needles series so it's
  always current. More code; kills the drift permanently.

*Note:* "~4× since 2018" can't be checked from the dashboard's own data (history starts 2023) — it's
long-run external context, unaffected by this refresh. Leaving as-is.

### Finding 2 — HSOC overlap figure drifted (Medium)
**Location:** [unhoused/build/signals.py:178](../unhoused/build/signals.py#L178) → baked into `unhoused/data/provenance.json` `hsoc.caveat`.
**Problem:** Caveat reads "**~75%** of it is the same records already counted in Sit/Lie and Homeless
Complaint." Live check: 37,650 / 55,364 = **68.0%**. The caveat itself explains the mechanism —
HSOC "rises as the program scales… regardless of type" — so as HSOC expands to other call types, the
overlap share naturally falls. Real, explainable drift, but the stated number is now stale.
**Why it misleads:** Overstates the double-count overlap by ~7 points.
**Proposed change (pick one):**
- **(A, durable — recommended)** Soften to "**the majority** of it is the same records already
  counted…" — preserves the load-bearing point (NEVER sum it) without a driftable number.
- **(B)** Update `~75%` → `~68%`. Drifts again next refresh.
- **(C)** Compute the overlap share at build time.

### Finding 3 — Paraphernalia "tripled" (Low, optional)
**Location:** [drug/build/signals.py:160](../drug/build/signals.py#L160).
**Problem:** "this category **tripled** while dealer arrests fell." Still **true** — paraphernalia
838 (CY2023) → 3,061 (CY2025) = 3.65×, trailing-12 4,088 = 4.9× vs 2023; dealer arrests 876 → 619,
fell. The claim is now conservative.
**Why it (barely) matters:** Understates the actual change; not inaccurate.
**Proposed change (optional):** "more than tripled" / "roughly quadrupled," or leave as-is.

---

## Recommendation
Apply **1(A)** and **2(A)** — drop the two driftable numbers from the caveats (they aren't
load-bearing and re-break every refresh), then re-run `03_rollup.py` for both dashboards to re-bake
provenance, and re-validate. Finding 3 is optional polish. If you prefer keeping precise numbers,
1(B)/2(B) update them for today; 1(C)/2(C) auto-compute them permanently.

**Nothing else in either dashboard needs a data-accuracy change** — all shown figures tie to source.
