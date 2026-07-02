# Phase 3 — Per-district curated interventions table

**Parent:** [list interventions by district (#25)](plan-interventions-by-district.md).

## Goal
Fill in the **curated interventions table** half of the mockup — the per-district table with the
columns the saved hypotheses can't supply (tactics, owner, agencies, status) and an "Add intervention"
flow.

## Background
The "Interventions" content tab already renders `data/interventions.tsv` per district, and the TSV
schema is exactly the mockup (`district, intervention, target_kr, tactics, owner, agencies, status,
start_date, impact, last_evaluated, eval_link`). It's currently **empty**. These are manually-tracked
"official" interventions — distinct from the auto-saved hypotheses (Phase 1 list), though a saved
hypothesis can be **promoted** into a curated row.

## Scope
- [ ] **Decide the store for curated interventions**: keep the static `interventions.tsv` (commit-time
      curation, no backend), or move curated rows into the Worker/KV so they can be added in-app.
      (Open question — see below.)
- [ ] **"Add intervention" UI**: a form to create a curated intervention with all columns, scoped to a
      district. If KV-backed, this is a new write path (reuse the public-write + city-email model, or
      gate it — see auth question).
- [ ] **Promote a saved hypothesis → curated intervention**: prefill the form from a saved record
      (name, target KR, started, district, eval_link) so curation just adds the human fields.
- [ ] Render the table per district with the mockup columns (minus `last_evaluated`, Phase 4); empty
      state per district.

## Acceptance criteria
- An official intervention can be added for a district and shows in that district's table.
- A saved hypothesis can be promoted into a curated row without re-typing the URL-derived fields.
- The table is per-district and matches the mockup layout (sans Last evaluated).

## Open questions
- **Store:** static TSV (PR-based curation) vs KV (in-app add)? KV enables the "Add intervention"
  button but needs a write/edit path; TSV is simpler but edits go through git.
- **Auth:** curated edits are higher-stakes than public hypothesis saves — gate "Add/edit" (shared
  secret / Cloudflare Access) or keep the recorded-city-email model?

## Out of scope
Last evaluated + staleness (Phase 4).
