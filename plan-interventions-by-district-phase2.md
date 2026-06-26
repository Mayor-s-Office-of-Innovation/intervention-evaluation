# Phase 2 — Saved interventions: Impact field

**Parent:** [list interventions by district (#25)](plan-interventions-by-district.md) ·
depends on [Phase 1](plan-interventions-by-district-phase1.md).

## Goal
Show an **Impact** value (the before/after % change the hypothesis tool computes) for each saved
intervention.

## Background
Impact is **not** in the saved URL — it's computed live by the tool from Socrata data
(`hypothesis/js/analyze.js` `analyzeWindow` → `w.pct`). So it must be captured at save time and stored,
and it is a point-in-time snapshot (it will drift until re-evaluated — see Phase 4).

## Scope
- [ ] **Save flow (`hypothesis/js/save.js`)**: include the current computed impact (`pct`, direction,
      and the window it was computed over) in the `POST` body alongside `url` + `email`.
- [ ] **Worker**: accept and store `impact` on the record; add it to the public projection. Validate
      it's a number in a sane range; treat missing as null (older records).
- [ ] **Homepage list**: render an **Impact** badge (↑/↓ + %, goal-colored like the OKR tickers),
      with an "as of <save date>" affordance so it's clearly a snapshot, not live.
- [ ] Backfill: existing Phase-1 records have no impact → render "—".

## Acceptance criteria
- Saving a report stores its computed impact; the saved list shows it as a colored badge.
- Records saved before this phase show "—" (no crash).
- The badge is visibly time-stamped / marked as a snapshot (sets up the Phase 4 staleness story).

## Out of scope
Re-evaluating impact on a schedule and the stale flag (Phase 4); curated table fields (Phase 3).
