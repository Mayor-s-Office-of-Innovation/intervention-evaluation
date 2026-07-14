# Plan — intervention form UX fixes (2026-07-14)

Three fixes requested against the `./hypothesis/` form + the homepage table.

## 1. District pre-populates from where you came from

- **Homepage** ([js/app.js](../js/app.js)): the static "Add intervention" tool card links to
  `./hypothesis/`. Update its href to `./hypothesis/?district=<currentDistrict>`
  and refresh it whenever the district tab changes (`updateAddLink()` in
  `render()`).
- **Form** ([hypothesis/js/app.js](js/app.js)): `readParams()` reads `?district=` and sets
  `#in-district`. A district-only link must **not** auto-run an analysis — only
  a real shared report (has `dp`/`lat`/`lng`/`from`/`to`) should. `readParams`
  returns an "has analysis params" flag for the `run(true)` decision.

## 2. Submitting shows results inline (no redirect home)

[hypothesis/js/app.js](js/app.js) `handleSubmit`, create branch: instead of
`alert()` + `window.location.href = '../'`, capture the new `id` from
`createFullIntervention`, switch the page into the saved/edit state
(`editId = id`, titles → "Edit intervention", button → "Update intervention"),
then `run(true)` to render the per-lever analysis and scroll to it. Confirmation
shown inline in the share bar's status line. The record is already persisted, so
it also appears on the homepage.

## 3. Clicking an intervention row opens its results (not Edit)

- **New `?view=ID` mode** in [hypothesis/js/app.js](js/app.js): refactor
  `loadEditRecord` → `loadRecord(id, mode)`. Both modes load the record, populate
  fields, resolve levers, set pin/radius/date. `edit` mode sets `editId` +
  "Update" button (unchanged). `view` mode sets a `viewId`, titles → "Intervention
  results", primary button → "Edit intervention" (navigates to `?edit=ID`), and
  `run(true)` to scroll straight to the live analysis. View mode reconstructs
  from the record's structured fields (levers/lat/lng/radius), so it doesn't
  depend on a stored share URL.
- **Homepage** ([js/app.js](../js/app.js)): rows get `data-href` =
  `./hypothesis/?view=<id>` (or the saved `eval_link` when there's no id). The
  Intervention-name cell becomes a real link (keyboard/a11y); the whole row is
  click-navigable (handler ignores clicks on `a`/`button`, so Edit/Close still
  work). Explicit Edit action stays.

## Out of scope
- Reworking the Save button / KV schema.
- Homepage lever-badge colors for the newly added levers (cosmetic).

## Verify
`node --check` on both `app.js` files; then run the app: (a) homepage → Add
intervention prefills the viewed district; (b) submit a new intervention → stays
on page, results render + scroll; (c) click a homepage row → lands on that
intervention's results.
