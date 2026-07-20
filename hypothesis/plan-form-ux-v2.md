# Plan — intervention form UX v2

## Context

Adding/reading interventions via the `./hypothesis/` tool is currently awkward:

1. **The form is one long flat stack of ~17 fields** ([hypothesis/index.html](hypothesis/index.html)), with no distinction between the few fields that matter and the many optional ones. The three hard-required fields (title, district, your name) are even scattered — name sits alone at the very bottom.
2. **Clicking an intervention on the homepage opens an editable form, not a read-only view.** Two causes: (a) a routing bug where `viewHref` prefers the saved `eval_link` (a shared *analysis* link that opens the editable Add form) over the `?view=ID` path; and (b) even `?view=ID` mode just loads the record into live, editable inputs and relabels the button — it never presents a genuine read-only view.
3. **The homepage list is filtered by district, but that isn't obvious** — the district pills are at the top of the page and the list is far below, with only a subtle "Central — 5 interventions" header.

Decisions from the user:
- **Required tier**: promote **levers** and **map location** to required, alongside title/district/name.
- **Read-only view**: a *massively simplified* view — show only fields that were filled in, nothing editable, **no Edit button**.
- **Inline editing on the homepage (original ask #3)**: deferred — explore/prototype later, not in this plan.

Per repo convention, on implementation this plan is also copied to an in-repo sibling `hypothesis/plan-form-ux-v2.md`.

---

## Change 1 — Group required vs. optional fields

**File:** [hypothesis/index.html](hypothesis/index.html) (markup only) + a little [hypothesis/styles.css](hypothesis/styles.css).

Split the single `#input-panel` field stack into two labelled groups inside the same card (keeps all field IDs and every JS binding unchanged):

- **Required section** (top): Intervention title (`in-what`), District (`in-district`), Your name (`in-submitter`), Levers (`in-expect` + its `#expect-desc` hint), and the Location block (`#picker-map`, `#coords-readout`) + radius slider (`#radius-slider`). These are what make a saveable, analyzable intervention.
- **Optional details section** (below, under a heading/divider): description, evidence, tactics, owner/agencies, status, dates, roadblock, outcomes, notes, related documents/links.

Implementation notes:
- Add `<h3 class="form-section__title">Required</h3>` / `Optional details` subheadings (reuse the muted-uppercase treatment of `.section-label` / `.field-label`; add one small `.form-section__title` rule + a divider).
- Mark levers as visually required (add `required`-style asterisk in its label) — but note `wa-select` required validation isn't currently enforced in JS.
- **Enforce the new required fields in JS**: extend the validation block in `handleSubmit` ([hypothesis/js/app.js:204-217](hypothesis/js/app.js#L204)) to also reject submit when no lever is selected (`getSelectedLevers().length === 0`) and when no pin was placed (`!locSet`). Show the same `alert(...)` + focus pattern already used for title/name, and surface a message for location (focus the map container / scroll to it).

Out of scope: reordering the results/methodology sections; changing the save dialog.

---

## Change 2 — Real read-only view on row click

**Goal:** clicking a row lands on a clean, read-only summary (only filled fields) + the live impact analysis. No form, no Edit button.

### 2a. Fix homepage routing — [js/app.js](js/app.js)
- Change `viewHref` ([js/app.js:291](js/app.js#L291)) to prefer the record's own view page: `i.id ? ./hypothesis/?view=<id> : i.eval_link`. This makes clicks land in view mode for every saved record (the `eval_link` fallback stays only for curated rows that have no `id`).
- Leave the explicit **Edit** action link in `renderActions` ([js/app.js:330](js/app.js#L330)) as-is — that's still the intended path to edit.

### 2b. Make `?view=ID` render read-only — [hypothesis/js/app.js](hypothesis/js/app.js) + [hypothesis/index.html](hypothesis/index.html) + CSS
In `loadRecord(id, 'view')` ([hypothesis/js/app.js:181-189](hypothesis/js/app.js#L181)):
- **Hide the entire editable form**: `$('input-panel').hidden = true` instead of populating/relabeling it. (Fields still get read into `editRecord`/`dps`/`loc`/`radius` so `run()` works — we just don't show the form.)
- **Render a read-only details card** into a new `#view-details` container (added to `index.html`, `hidden` by default, shown only in view mode). Build it from `editRecord` as a definition list, **emitting only fields that have a non-empty value**. A small `viewFields` array of `{key, label, format}` drives it (title, district, status→`STATUS_LABELS`, levers→badges, owner, agencies, start/end date, tactics, evidence, description, roadblock, outcomes, notes, links→clickable chips, submitted-by, last-edited, location/radius readout). Reuse `escHtml`, `fmtNice`, `renderLinksPreview`-style chip markup.
- **No Edit button**: hide `#run-btn` (and skip the view-mode branch in `handleSubmit`). Keep `run(true)` so the analysis window + per-lever panels + map still render below the summary.
- Header text: keep page title "Intervention results" / details subtitle.

CSS: add a `.view-details` definition-list style (label/value rows, reuse `--muted`, existing `.link-chip`, `.status-badge` patterns) in [hypothesis/styles.css](hypothesis/styles.css).

Edge cases: a curated row with only an `eval_link` and no `id` still uses the old shared-link path (unchanged). A record missing lat/lng still renders details; analysis falls back to the default pin as today.

---

## Change 3 — Make district filtering obvious above the list

**File:** [js/app.js](js/app.js) `renderInterventions()` head ([js/app.js:399-402](js/app.js#L399)) + [styles.css](styles.css).

Replace the plain "Interventions" `section-label` + subtle head with an explicit, visually-scoped banner directly above the table, e.g.:

> **Interventions in `Central`** · showing N (X open · Y closed) — *use the district tabs above to switch*

- Style it to visually tie to the active district (reuse the district color dot used by `.district-tab__dot` / the `kr-badge` color convention) so it reads as "this list is filtered."
- Keep the existing open/closed counts and the "View closed" toggle.
- Small `.interventions-head` / new `.interventions-scope` CSS tweak; no data-flow changes.

---

## Deferred (not in this plan)
- Homepage inline editing (original ask #3) — to be prototyped separately (quick-edit key fields vs. drawer editor).

---

## Verification
- `node --check hypothesis/js/app.js && node --check js/app.js` after edits.
- Run the app (static server at repo root, e.g. `npx http-server` / existing dev command) and in the browser:
  1. **Form grouping**: open `./hypothesis/` — required section shows title/district/name/levers/location up top, optional details below. Try to submit with no lever and no pin → blocked with a clear message; add both → saves.
  2. **Read-only view**: from the homepage, click an intervention *row* → lands on `?view=ID`, shows a clean details summary (only filled fields), no editable inputs, no Edit button, with live analysis below. Click the explicit **Edit** action → still opens the editable `?edit=ID` form.
  3. **District scope**: switch district pills at top → the banner above the list updates to name the active district and its counts; verify it's clearly legible without scrolling logic changes.
- Confirm an intervention with sparse data (only title/district/name/lever/pin) renders a view page with just those fields and no empty rows.
