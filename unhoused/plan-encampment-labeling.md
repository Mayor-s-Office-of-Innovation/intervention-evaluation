# Plan — make the "encampment" headline honest & explicit

## What actually happened (corrected — per 311 data analyst, Jul 2026)

This is **not** a "reroute" or a retired category, as earlier drafts assumed. Around May 2025, SF's **Department of Emergency Management and 311 deliberately split** a single overloaded "Encampment" request into two, because the public had been filing reports about lone individuals under the encampment process. Separating them improves response *and* analytics. It went live **late June / July 2025**.

**311's definitions:**
- **Encampment** — a more permanent situation: tents, structures, tarps, mattresses, or many large items.
- **Unhoused individual concern** — just a person, or a person with a few small items.

**Data consequences:**
- True encampments stay in `service_name IN ('Encampment','Encampments')` — still ~3,000–3,400/mo citywide; the category was *refined*, not retired.
- Individual concerns now land in `service_name='General Request' AND service_subtype='homelessness_and_supportive_housing'` (~2,600/mo; was ~50–100/mo before mid-2025).
- **Post-July-2025, the Encampment category is a *cleaner* count of actual encampments than ever** (misfiled individuals removed).
- **Pre-July-2025 the two cannot be separated** — everything was "Encampment" — so a like-for-like historical trend needs the union.
- The individual bucket's rise (~+2,500/mo) exceeds the encampment YoY drop (~−1,800/mo), so the split also surfaced net-new individual reports; the union total rose across the change (a reporting-quality effect, not a real-world jump).

## Decision (locked with user)

- **New label for the combined headline: "311 encampment and unhoused reports."**
- Footnote must carry **311's definitions + the exact queries + the reasoning** for the combination (below).

## The label & footnote

### Label
Replace **"Encampments"** with **"311 encampment and unhoused reports"** everywhere the combined 311 union is shown as the headline ([unhoused/js/app.js:163](js/app.js#L163); citywide strip; chart title; methodology).

### Footnote copy (final draft)

> **What "311 encampment and unhoused reports" counts, and why it's combined**
>
> In mid-2025, SF's Department of Emergency Management and 311 deliberately split what had been a single "Encampment" request, because the public was filing reports about lone individuals under the encampment process. Separating them improves both response and analytics — you can now tell encampment concerns from individual concerns. The change went live around late June/July 2025.
>
> **311's definitions:**
> - **Encampment** — a more permanent situation: tents, structures, tarps, mattresses, or many large items.
> - **Unhoused individual concern** — just a person, or a person with a few small items.
>
> **Why this number combines them:** before the mid-2025 split, both were filed as "Encampment," so the two can't be separated in the historical record. To show a trend that stays comparable across the change, we union both report types. Read the combined figure as *"community 311 reports of unhoused presence,"* not as confirmed encampments. For the tents/structures signal on its own — cleaner from July 2025 forward — use the **Encampment only** view.
>
> **The exact queries (SF 311, dataset `vw6y-z8j6`):**
> - Encampments: `service_name IN ('Encampment','Encampments')`
> - Unhoused individuals: `service_name='General Request' AND lower(service_subtype) LIKE '%homeless%'`
> - Combined (this number): the two unioned, deduped on `service_request_id`.
>
> Runnable versions of each are linked in the methodology below.

## Changes on the unhoused dashboard

1. **Relabel the headline** to "311 encampment and unhoused reports" — [js/app.js:163](js/app.js#L163), and use it as the one canonical name (card, citywide strip [js/app.js:181](js/app.js#L181), chart, methodology [js/app.js:517](js/app.js#L517)).
2. **Persistent component breakdown at the number:** `= 565 encampment + 583 unhoused individual` (pulled from baked series, stays in sync).
3. **Footnote + ⓘ affordance** next to the headline opening the copy above; full text also in methodology.
4. **Reframe the `encOnly` toggle** as "Combined (continuous)" vs "Encampment only (tents/structures)"; when "only" is active, note it's the *cleaner* post-July-2025 encampment measure and that the pre-2025 portion still includes individuals.
5. **Fix the stale break annotation** — the 2025-06 chart marker and `signals.py` break `detail` still say "SF retired the dedicated Encampment category." Rewrite to the split story. (Requires a rebuild to re-bake `aggregates.json`/`provenance.json`.)
6. **Aggregate honesty** ([js/app.js:131](js/app.js#L131)): 311 and 911 are different units, no cross-dedup, 311 dominates — label as "total community reports across both channels," never a count of distinct situations.

## Other surfaces affected — YES, the homepage and more

Searched the repo; the same union / old framing appears in four other places:

| Surface | What's there | Needed |
|---|---|---|
| **Homepage** [js/app.js:27](../js/app.js#L27) | OKR card KR labeled `'Encampment reports'`, pulls the union from unhoused aggregates | Relabel KR to match ("311 encampment & unhoused reports"); update label→dashboard map [js/app.js:83](../js/app.js#L83) |
| **districts** dashboard [build/signals.py:48](../districts/build/signals.py#L48) | Same union, label "Encampment & homelessness reports", break `detail` says "SF retired the dedicated Encampment category" (wrong) | Same relabel + corrected break copy; rebuild to re-bake its provenance/breaks |
| **okr-map** [js/app.js:9](../okr-map/js/app.js#L9) | KR text "Reduce encampments" linking to unhoused | Low touch; align wording only if we rename the objective |

`theft/index.html` and `docs/spec-interventions-flow.html` mention encampments only incidentally (nav/cross-links) — no change.

**Hypothesis tool is explicitly deferred — see the section below.**

## ⏸ DEFERRED — hypothesis tool (do NOT touch in this pass)

Per user, all hypothesis-tool work is held for a later, separate effort. Captured here so it isn't lost:

- **`homeless_presence` undercount (genuine bug)** — [hypothesis/js/datapoints.js:228](../hypothesis/js/datapoints.js#L228) uses the naive `service_name IN ('Encampment','Encampments')` for its 311 component, so since the mid-2025 split it *undercounts* unhoused presence by ~2,600/mo (the split-out individuals are excluded). Fix = union the individuals in. **Real bug, but deferred.**
- **`encampments` datapoint framing** — [hypothesis/js/datapoints.js:276](../hypothesis/js/datapoints.js#L276) unions both and its description still says "rerouted… artificial drop" (the old, wrong story). Needs the corrected split copy.
- **Design question (deferred):** should the "Reduce encampments" KPI track the *clean* encampment-only signal (true tents/structures, cleaner from July 2025) instead of the union? It's the one place the objective is literally "encampments."
- Also revisit `hypothesis/plan-one-pager.md` if any of its cited encampment framing depends on the old story.

## Open decisions for you (+ Bryan)
1. **Scope (non-hypothesis):** just the unhoused dashboard now, or the homepage + districts in the same pass?
2. **Explanation mechanism:** inline expandable ⓘ (my lean), modal, or jump-to-methodology.

## Verification
- Breakdown numbers tie to `provenance.json` `break_audit` + live portal (confirmed: Northern Jun-2026 union 1,146 / encampment 560).
- Playwright + `validation/trace.py` pass; add an assertion the headline label is no longer bare "Encampments"; re-run `trace.py` after any rebuild.
- Light/dark (themechange) + keyboard-reachable ⓘ/toggle (WCAG AA).

## Rollout
1. unhoused relabel (#1) + breakdown (#2) — settles the colleague's objection.
2. Footnote + ⓘ (#3), toggle reframe (#4).
3. Rebuild for corrected break copy (#5) + aggregate caveat (#6).
4. Cross-surface pass (homepage, districts) — pending scope decision. Hypothesis tool deferred (see ⏸ section).
