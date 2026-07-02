# Phase 4 — Last evaluated + staleness

**Parent:** [list interventions by district (#25)](plan-interventions-by-district.md) ·
relates to [Phase 2 (Impact)](plan-interventions-by-district-phase2.md).

## Goal
Show **Last evaluated** per intervention and flag stale ones — the final mockup column.

## Blocked on
A **regular re-evaluation / data-refresh process** behind the tools. Impact (Phase 2) is captured once
at save and drifts as new data arrives; "Last evaluated" only means something if something re-runs the
saved hypothesis against fresh data on a cadence and re-stamps it. We don't have that process yet, so
this phase is intentionally deferred until we do.

## Scope (sketch — refine once the refresh process exists)
- [ ] A scheduled job (e.g. Cloudflare Cron Trigger on the Worker, or a GitHub Action) that, per saved
      intervention, re-runs its hypothesis query, recomputes impact, and writes `last_evaluated` +
      refreshed `impact` back to the record.
- [ ] **Stale flag**: mark an intervention "stale" when `now - last_evaluated` exceeds a threshold
      (the existing table renderer already has a `stale` affordance to reuse).
- [ ] Homepage: render **Last evaluated** (with the stale flag) on the list/table.

## Acceptance criteria
- Each evaluated intervention shows a real, recent `last_evaluated` date.
- Interventions past the staleness threshold are visibly flagged.
- Impact shown is the most recent re-evaluation, not the save-time snapshot.

## Open questions
- Cadence + staleness threshold (weekly? monthly?).
- Where the re-eval runs (Worker Cron vs Action) and how it reaches Socrata + recomputes with the same
  logic as the tool (`analyze.js`) without duplicating it.
