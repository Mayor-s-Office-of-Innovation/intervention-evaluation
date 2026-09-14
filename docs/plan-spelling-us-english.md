# Plan — Normalize British spellings to US English in visible text

**Status:** 🟡 Proposed · **Drafted:** 2026-09-14 · **Updated:** 2026-09-14 (stops page re-audited after copy changes)
**Scope:** Visible text only (page copy, legends, aria-labels).
Code identifiers (CSS classes, JS variables, element IDs, config keys
like `colourBy`, `#colour-by`, `g.neighbour_m`) are deliberately out
of scope — renaming them touches tests (stops/tests/e2e.spec.js
references `#colour-by`) and stylesheets.

## 1. Findings

### index.html (homepage)
| Line | Location | Current | Fix |
|---|---|---|---|
| 141 | Bus stops tool card | neighbours | neighbors |

### stops/index.html (static HTML)
| Line | Location | Current | Fix |
|---|---|---|---|
| 64 | header sub | neighbours | neighbors |
| 77 | fieldset legend | Colour | Color |
| 91 | map legend hint | colour | color |

### stops/js/app.js (JS-rendered visible text)
| Line | Location | Current | Fix |
|---|---|---|---|
| 264 | signal legend (`sig__leg`) | neighbours, mean | neighbors, mean |
| 338 | sparkline aria-label | neighbours | neighbors |
| 406 | methodology (Geometry) | Neighbours | Neighbors |
| 409 | methodology (Cost side) | metres | meters |

*Note:* the stop card was reworked — the old `sig__cmp` "Neighbours (nearest N…)"
comparison line and the separate `cmp-legend` chart legend are gone, replaced by
the single `sig__leg` definition list (line 264) whose neighbour row now reads
"neighbours, mean (nearest N stops with no shelter)" or the fallback
"no stop without a shelter within 400 m". Line numbers below it shifted
accordingly (old 334→338, old 402→406, old 405→409).

### districts/js/app.js (JS-rendered visible text)
| Line | Location | Current | Fix |
|---|---|---|---|
| 241 | time-window note | summarise | summarize |

### Pages with no visible-text findings
- theft/ — clean (only `aria-labelledby` attribute matches)
- unhoused/ — clean
- drug/ — clean

## 2. Implementation steps
1. `index.html:141` — neighbours → neighbors
2. `stops/index.html` — lines 64, 77, 91
3. `stops/js/app.js` — lines 264, 338, 406, 409
   (line 407's `g.neighbour_m` config key untouched)
4. `districts/js/app.js:241` — summarise → summarize

## 3. Verification
- Re-run the grep sweep across the audited files — expect zero
  visible-text hits
- `npx playwright test stops/tests/e2e.spec.js` to confirm
  nothing broke

## 4. Follow-up (flagged, not fixed here)
- Code identifiers: `colourBy`, `#colour-by`, `.finder__colour`,
  `g.neighbour_m`, `s.neighbours`, `nbSer`
- British spellings in code comments (shared/chart.js, stops/js/app.js)