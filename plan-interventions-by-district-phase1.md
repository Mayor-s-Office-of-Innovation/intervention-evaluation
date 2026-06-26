# Phase 1 — Saved interventions: district-aware list

**Parent:** [list interventions by district (#25)](plan-interventions-by-district.md) ·
builds on [saved-interventions](plan-saved-interventions.md) (Cloudflare Worker + KV).

## Goal
When a hypothesis is saved, determine and store its **district**, and make the homepage's saved-
evaluations list **filter by the selected district**, showing every field we can derive from the saved
URL (name, Target KR, Started).

## Background
A saved record today is just the hypothesis URL + email. The URL carries `what` (name), `dp`
(→ Target KR), `date` (→ Started), and `lat`/`lng` (→ district). The homepage already has district
tabs (Northern / Central / Mission / Tenderloin) and a global saved-evaluations list; this scopes the
list to the active district and enriches each row.

## Scope

### Worker (`interventions-api/`)
- [ ] Embed the 4-target-district polygons (`drug/data/police_districts.geojson`, ~61 KB) and add a
      `districtFor(lat, lng)` helper — port the build's verified ray-casting (`build/02_assign.py`
      `point_in_ring`). A pin outside the 4 → `"Other"`.
- [ ] On `POST`, parse `lat`/`lng` from the saved URL, compute `district`, store it on the KV record.
- [ ] Add `district` and `dp` to the public `publicItem` projection (still **no email**).
- [ ] Backfill the existing record(s): regenerate `seed.json` to include `district` + `dp` (Hayes →
      `Northern`) and `kv bulk put --remote`.

### Homepage (`js/app.js` + `js/saved-interventions.js`)
- [ ] `app.js` dispatches a `districtchange` CustomEvent (with the selected district) on tab change.
- [ ] `saved-interventions.js` fetches once, filters items by the active district, re-renders on
      `districtchange`. Enrich each row: **name · Target KR · Started · open-link**
      (a `dp`→label lookup lives in the client). Per-district empty state.
- [ ] Keep the progressive-enhancement fallback; extend the homepage e2e stub to include `district`.

### Tests
- [ ] Unit `districtFor` (a Tenderloin point → `"Tenderloin"`; an out-of-area point → `"Other"`).
- [ ] Homepage e2e: switching district re-filters the saved list.

## Acceptance criteria
- A new save lands under the correct district tab automatically (derived from its pin), with no manual
  district entry.
- The saved list shows only the active district's items, each with name, Target KR, and Started date,
  plus a link that reopens the evaluation.
- `email` never appears in the API response. CI stays green (hermetic e2e).

## Out of scope (later phases)
Impact (Phase 2), curated table / owner·agencies·tactics·status (Phase 3), Last evaluated (Phase 4).
