# List interventions by district (issue #25) — overview

> When interventions are saved, identify their district, store it, and list saved interventions by
> district on the homepage. Builds on [plan-saved-interventions.md](plan-saved-interventions.md)
> (the Cloudflare Worker + KV that already saves hypothesis URLs).

This is the parent/index. Each phase has its own issue-ready doc:

| Phase | Doc | Ships |
|-------|-----|-------|
| 1 | [district-aware saved list](plan-interventions-by-district-phase1.md) | now (this issue) |
| 2 | [Impact field](plan-interventions-by-district-phase2.md) | next |
| 3 | [curated interventions table](plan-interventions-by-district-phase3.md) | later |
| 4 | [Last evaluated + staleness](plan-interventions-by-district-phase4.md) | deferred (needs a refresh process) |

## What already exists (don't rebuild)

The homepage already has the pieces the mockup shows:
- **District tabs** (Northern / Central / Mission / Tenderloin) + content tabs, rendered by `js/app.js`.
- **A per-district curated Interventions *table*** — the "Interventions" tab renders
  `data/interventions.tsv`, whose schema is exactly the mockup (`district, intervention, target_kr,
  tactics, owner, agencies, status, start_date, impact, last_evaluated, eval_link`). **It's currently
  empty** → the manual-curation surface (Phase 3).
- **The saved-evaluations *list*** — `js/saved-interventions.js` renders the KV-backed saved hypotheses
  globally; this issue makes it **district-aware** (Phase 1).

The mockup is **both** sections, kept distinct (locked decision):
- **Table** = curated/official interventions (all columns, "Add intervention") → Phase 3.
- **List** = saved hypotheses (KV), filtered by district, showing the URL-derivable fields → Phase 1.

## What a saved hypothesis gives us

The saved URL is the record. Phase split follows what's derivable from it:

| URL param | Field | Phase |
|-----------|-------|-------|
| `what` | Intervention name | 1 |
| `dp` | Target KR (datapoint → label) | 1 |
| `date` | Started | 1 |
| `lat`/`lng` | District (point-in-polygon) | 1 |
| — | Impact (computed %) | 2 |
| — | Tactics / Owner / Agencies / Status | 3 (manual curation) |
| — | Last evaluated | 4 (needs a re-eval process) |

## District derivation (shared)
The pin's `lat`/`lng` is in every saved URL, so the **Worker computes the district** via point-in-
polygon (reusing the build's ray-casting + the 4-district geojson) and stores it on the record — no
client change needed. Pins outside the 4 target districts → `"Other"`.
