# Plan — Kill layout shift (CLS) on the homepage

**Status:** homepage DONE (2026-07-23) · **Scope:** `index.html`, `styles.css`, `js/app.js` (homepage only; other dashboards later)

## Outcome (homepage)

Implemented all three changes. Verified with Playwright under network throttling +
per-region measurement: first-render → settled card shift = **0px** (reserved
min-height absorbs the async saved rows); styled-skeleton → real shift = **~7px**
(imperceptible; from OKR card / tab approximation). Regression test added:
`homepage/tests/e2e.spec.js` → "the tool cards do not shift when saved interventions
load in". All 4 homepage tests pass.

Calibration notes for the follow-up dashboards:
- Reservation must sit on a container present in **every** render state. On the
  homepage the table wrap doesn't exist in the empty state, so min-height went on
  `.section-interventions` (22rem), not `.intervention-table-wrap`.
- Skeleton OKR card needed `min-height: 17.5rem` to match the tallest real card
  (ticker header + 3 KR rows).
- `.okr-card` selector in tests also matches the skeleton placeholder — key waits off
  `.districts-skeleton` being gone.


## Problem

The districts block is rendered by JS into an **empty** `#districts-container`
(`index.html`), which sits *above* the two static tool cards ("Add intervention",
"Explore reports"). Empty container = 0 height, so on first paint the tool cards sit
directly under the "Districts" heading, then get shoved down when content pops in.

Two distinct shifts:

1. **Big shift.** `init()` (`js/app.js`) gates the first `render()` behind
   `Promise.all([fetch TSV, loadAggregates, loadEmergingSignals])`.
   `loadEmergingSignals()` fires **live Socrata queries** for all 4 districts, so the
   whole block (tabs + 3 OKR cards + interventions table) waits on the slowest live
   query, then appears at once.
2. **Smaller shift.** `loadSaved()` is fire-and-forget and calls `render()` *again*
   when the Worker responds, appending saved rows → a second downward shove of
   everything below (tool cards + footer).

## Decisions (locked)

- **Reserve space with a full skeleton** baked into the HTML.
- **Reserve typical height** for the interventions table (min-height for ~N rows),
  rather than a fixed-height scroll region.

## Approach

Three independent changes; together they target near-zero CLS.

### 1. Full skeleton in `#districts-container` (Lever A)

Bake placeholder markup into `index.html` inside `#districts-container`, reusing the
real class names so heights match on swap:

- `.district-tabs` with 4 placeholder tabs
- `.section-okrs` → real `<h2 class="section-label">OKRs</h2>` + `.okr-grid` with **3**
  `.okr-card` skeletons (eyebrow bar + title bar + 2–3 ticker rows as shimmer blocks)
- `.section-divider`
- `.section-interventions` → real `<h2>Interventions</h2>` + a scope-line placeholder +
  a skeleton table (~N shimmer rows)

The skeleton is `aria-hidden="true"` and the container gets `aria-busy="true"` until
the first real `render()`. `render()` already does `container.innerHTML = …`, so it
overwrites the skeleton with no extra teardown code.

New CSS: a `.skeleton` shimmer utility (subtle pulse; respects
`prefers-reduced-motion`), light + dark variants (listen to existing `wa-dark`/`wa-light`).

### 2. Decouple slow network from first paint (Lever B)

In `init()`:

- Gate the first `render()` on **local files only**: `interventions.tsv` +
  `loadAggregates()` (both local/fast).
- Remove `loadEmergingSignals()` from the gating `Promise.all`. Fire it *after* first
  render; re-render (or update badges) when it resolves. The emerging KR badge already
  renders a fixed-size `—` placeholder, so filling it later changes text, not layout →
  no shift.
- `loadSaved()` stays fire-and-forget (preserves Worker-outage resilience — do **not**
  re-couple).

### 3. Reserve typical table height (shift #2)

Add a `min-height` to `.section-interventions` (or `.intervention-table-wrap`) sized
for ~N typical rows so the saved-rows arrival doesn't push the footer in the common
case. Exact value measured against the real rendered table during implementation
(row height × typical curated+saved count). Note: extreme row counts still shift a
little — accepted tradeoff of "reserve typical" vs. a scroll region.

## Verification

- Manual: throttle network, hard reload, watch that tool cards + footer stay put.
- Playwright: `homepage/` config — assert `#districts-container` has non-zero height
  before app JS mutates it (skeleton present), and assert tool-card top offset is
  stable across the emerging-signals + saved re-renders (optional CLS guard).
- Confirm skeleton is `aria-hidden` and reduced-motion disables the shimmer.

## Out of scope (follow-ups)

- Same treatment on `drug/`, `unhoused/`, `theft/`, `districts/` dashboards.
